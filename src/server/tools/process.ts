// One process service for tools, terminal, and verification. Streams stdout/stderr, captures full
// output to an artifact, returns exit code + termination reason, and kills the whole process tree on
// cancel/timeout. This is NOT a sandbox: commands run with the user's OS privileges.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { artifactFile, createOutputCapture, currentOutputCapture, outputStream, type OutputArtifact } from '../output-artifacts';

export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  terminationReason: 'exited' | 'timeout' | 'cancelled' | 'spawn-error';
  artifactPath?: string;
  artifact?: OutputArtifact;
  artifactError?: string;
  spawned: boolean;
}

export interface ProcessOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  label?: string;
  maxPreviewChars?: number;
  onSpawn?: (pid: number) => void;
  artifactPath?: string;
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
}

export function runProcess(opts: ProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  const configured = opts.maxPreviewChars ?? 200_000;
  const cap = configured > 0 ? configured : Infinity;
  return new Promise<ProcessResult>((resolve) => {
    let stdout = '', stderr = '';
    let timedOut = false, cancelled = false, settled = false, spawnFailed = false;
    let child: ChildProcess;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let capture;
    try {
      capture = currentOutputCapture() || createOutputCapture({ runId: 'process_' + randomUUID(), sessionId: 'process' }, '', opts.label || 'process', Object.entries(opts.env || {}).filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)).map(([, value]) => value));
    } catch {
      resolve({ exitCode: null, signal: null, stdout: '', stderr: 'Process not started: output archive unavailable.', durationMs: Date.now() - started, timedOut, cancelled, terminationReason: 'spawn-error', spawned: false, artifactError: 'Output archive unavailable.' });
      return;
    }
    const out = outputStream('stdout', capture), err = outputStream('stderr', capture);
    let artifactError: string | undefined;
    const deliver = (channel: 'stdout' | 'stderr', text: string) => {
      if (!text) return;
      if (channel === 'stdout') { stdout = (stdout + text).slice(0, cap); opts.onStdout?.(text); }
      else { stderr = (stderr + text).slice(0, cap); opts.onStderr?.(text); }
    };
    const archiveFailure = () => { artifactError = 'Output archive write failed; full output may be incomplete.'; if (child) killTree(child); };
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
      try { deliver('stdout', out.end()); deliver('stderr', err.end()); } catch { archiveFailure(); }
      const reason = spawnFailed ? 'spawn-error' : cancelled ? 'cancelled' : timedOut ? 'timeout' : 'exited';
      try { capture.append('process.finished', { exitCode, signal, terminationReason: reason, artifactError }); } catch { archiveFailure(); }
      if (artifactError) stderr += '\n' + artifactError;
      resolve({ exitCode: artifactError ? null : exitCode, signal, stdout, stderr, durationMs: Date.now() - started, timedOut, cancelled, terminationReason: reason, artifactPath: artifactFile(capture.artifact.runId, capture.artifact.artifactId), artifact: capture.artifact, artifactError, spawned: !!child?.pid });
    };
    try {
      const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(opts.command);
      child = spawn(isCmd ? 'cmd.exe' : opts.command, isCmd ? ['/d', '/s', '/c', opts.command, ...(opts.args || [])] : (opts.args || []), {
        cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, windowsHide: true, detached: process.platform !== 'win32',
      });
    } catch {
      spawnFailed = true;
      finish(null, null);
      return;
    }
    if (child.pid) opts.onSpawn?.(child.pid);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) => { try { deliver('stdout', out.push(text)); } catch { archiveFailure(); } });
    child.stderr?.on('data', (text: string) => { try { deliver('stderr', err.push(text)); } catch { archiveFailure(); } });
    child.on('error', () => { spawnFailed = true; });
    child.on('close', finish);
    if (opts.timeoutMs) timer = setTimeout(() => { timedOut = true; killTree(child); }, opts.timeoutMs);
    if (opts.signal) {
      onAbort = () => { cancelled = true; killTree(child); };
      if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Resolve the shell EC12 runs commands in. Windows keeps Windows PowerShell exactly as before;
 * elsewhere PowerShell 7 (`pwsh`) is used when present, otherwise the platform's POSIX shell, so
 * the agent and its tests are runnable on a non-Windows machine instead of failing to spawn. */
let cachedShell: { kind: 'powershell' | 'pwsh' | 'posix'; command: string } | null = null;
export function resolveShell(): { kind: 'powershell' | 'pwsh' | 'posix'; command: string } {
  if (cachedShell) return cachedShell;
  if (process.platform === 'win32') return (cachedShell = { kind: 'powershell', command: 'powershell.exe' });
  const probe = (command: string) => {
    try { return spawnSync(command, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 10000 }).status === 0; }
    catch { return false; }
  };
  if (probe('pwsh')) return (cachedShell = { kind: 'pwsh', command: 'pwsh' });
  return (cachedShell = { kind: 'posix', command: process.env.SHELL || '/bin/bash' });
}

/** Run a shell script. On PowerShell this uses EncodedCommand (no nested-quote/`&&` pitfalls). */
export function runPowerShell(script: string, cwd: string, opts: Partial<ProcessOptions> = {}): Promise<ProcessResult> {
  const shell = resolveShell();
  if (shell.kind === 'posix') {
    // No PowerShell available: run the script through the POSIX shell rather than failing to spawn.
    return runProcess({ command: shell.command, args: ['-c', script], cwd, label: opts.label || 'sh', ...opts });
  }
  const prelude = process.platform === 'win32'
    ? "$ErrorActionPreference = 'Stop'; function npm { & npm.cmd @args }; function npx { & npx.cmd @args }; "
    : "$ErrorActionPreference = 'Stop'; ";
  const b64 = Buffer.from(prelude + script, 'utf16le').toString('base64');
  return runProcess({ command: shell.command, args: ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', b64], cwd, label: opts.label || 'ps', ...opts });
}

/** Resolve a package-manager executable for the current OS. */
export function pmCommand(name: 'npm' | 'npx' | 'pnpm' | 'yarn'): string {
  return process.platform === 'win32' ? name + '.cmd' : name;
}
