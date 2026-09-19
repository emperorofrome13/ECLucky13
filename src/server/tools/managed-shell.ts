import { randomUUID } from 'node:crypto';
import { currentOutputCapture, createOutputCapture, withOutputCapture, artifactFile, readArchivedProcessOutput, type OutputArtifact } from '../output-artifacts';
import { runPowerShell, type ProcessResult } from './process';
import { dataDir, readJson, writeJsonAtomic, validPersistentId } from '../store';
import { snapshotWorkspace, reconcileShellChanges, type JournalEnv } from '../workspace/change-journal';
import type { ToolResult } from '@/shared/contracts';

interface Job {
  id: string; env: JournalEnv; command: string; started: number;
  output: string; delivered: number; controller: AbortController; completion: Promise<void>;
  artifactPath?: string; artifact?: OutputArtifact; result?: ProcessResult; changeId?: string; note?: string; changes: string[];
}
const shared = globalThis as typeof globalThis & { ec12ShellJobs?: Map<string, Job> };
const jobs = shared.ec12ShellJobs ??= new Map<string, Job>();

const SHELL_OUTPUT_DEFAULT = 8000;
const RING_BUFFER_CHARS = 200000;

function savedJob(id: string): Job | undefined {
  if (!validPersistentId(id)) return undefined;
  return readJson<Job | undefined>(dataDir('shell-jobs', id + '.json'), undefined);
}

function persistJob(job: Job) {
  writeJsonAtomic(dataDir('shell-jobs', job.id + '.json'), { id: job.id, env: job.env, artifact: job.artifact, artifactPath: job.artifactPath, started: job.started, result: job.result ? { ...job.result, stdout: '', stderr: '' } : undefined, changes: job.changes, changeId: job.changeId, note: job.note });
}

export function fullShellOutput(env: JournalEnv, id: string): { ok: boolean; output?: string; error?: string; changes: string[] } {
  const job = jobs.get(id) || savedJob(id);
  if (!job || job.env.sessionId !== env.sessionId || job.env.workspacePath !== env.workspacePath) return { ok: false, error: 'Process not found in this session.', changes: [] };
  if (!job.artifact) return { ok: false, error: 'Full output artifact is unavailable for this legacy process.', changes: job.changes };
  try {
    const status = job.result ? 'exited with code ' + job.result.exitCode : jobs.has(id) ? 'still running' : 'unknown after server restart';
    return { ok: true, output: `Process ${job.id}\nStatus: ${status}\n\n` + readArchivedProcessOutput(job.artifact), changes: job.changes };
  } catch { return { ok: false, error: 'Full output artifact could not be read.', changes: job.changes }; }
}

async function observe(job: Job, waitMs: number, outputMaxChars = SHELL_OUTPUT_DEFAULT) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([job.completion, new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, Math.min(10000, waitMs))); })]);
  if (timer) clearTimeout(timer);
  const r = job.result;
  const status = r
    ? `Command ${r.cancelled ? 'cancelled' : 'exited'}; exit code ${r.exitCode}.`
    : `Command is STILL RUNNING. Process ID: ${job.id}. This is not an exit or a successful check. Use shell_process with this process_id to read output, wait, or stop it. For a server, check its readiness separately and continue other work; for builds/tests, wait for the exit code before claiming success.`;
  const cap = outputMaxChars > 0 ? outputMaxChars : Infinity;
  const pending = job.output.length - job.delivered;
  let shown: string;
  if (pending <= 0) {
    shown = job.delivered > 0 ? '(no new output since the last poll; earlier output was already delivered)' : '(no output yet)';
  } else {
    const firstDelivery = job.delivered === 0;
    const delta = job.output.slice(job.delivered);
    job.delivered = job.output.length;
    shown = delta.length > cap
      ? (firstDelivery
        ? `…[early output omitted; the full log streams into ${job.artifactPath ? 'the run artifact' : 'the activity event log'}]\n` + delta.slice(-cap)
        : `[${delta.length - cap} characters of this new output omitted; the full log streams into ${job.artifactPath ? 'the run artifact' : 'the activity event log'}]\n` + delta.slice(-cap))
      : delta;
  }
  const result: ToolResult = {
    ok: r ? r.exitCode === 0 && !r.cancelled : true,
    output: status + '\n' + shown + (job.note || ''),
    exitCode: r?.exitCode ?? null, durationMs: Date.now() - job.started,
    artifactPath: job.artifactPath,
    error: r && (r.exitCode !== 0 || r.cancelled) ? (r.cancelled ? 'Command cancelled.' : r.stderr || r.stdout || 'Command failed.') : undefined,
  };
  return { result, changeId: job.changeId, artifact: job.artifact };
}

export async function startShell(env: JournalEnv, command: string, signal?: AbortSignal, yieldMs = 1000, outputMaxChars = SHELL_OUTPUT_DEFAULT) {
  const before = snapshotWorkspace(env.workspacePath);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const job: Job = { id: 'proc_' + randomUUID(), env, command, started: Date.now(), output: '', delivered: 0, controller, completion: Promise.resolve(), changes: [] };
  jobs.set(job.id, job);
  const capture = currentOutputCapture() || createOutputCapture(env, '', 'shell_command');
  job.artifact = capture.artifact;
  job.artifactPath = artifactFile(capture.artifact.runId, capture.artifact.artifactId);
  persistJob(job);
  const append = (text: string) => {
    const combined = job.output + text;
    const dropped = Math.max(0, combined.length - RING_BUFFER_CHARS);
    job.output = combined.slice(-RING_BUFFER_CHARS);
    job.delivered = Math.max(0, job.delivered - dropped);
  };
  job.completion = withOutputCapture(capture, async () => {
    const r = await runPowerShell(command, env.workspacePath, { signal: controller.signal, timeoutMs: 0, label: job.id, onStdout: append, onStderr: append, artifactPath: job.artifactPath });
    try {
      const rec = await reconcileShellChanges(env, before, 'shell_command:' + command.slice(0, 60));
      job.changeId = rec.changes[0]?.changeId;
      job.changes = rec.changes.map((change: any) => change.changeId);
      if (rec.changes.length) job.note = `\n[${rec.changes.length} workspace file changes recorded in Changes]`;
    } catch { job.note = '\n[Workspace change reconciliation was unavailable.]'; }
    job.result = r;
    signal?.removeEventListener('abort', abort);
    try { persistJob(job); }
    catch { job.note = (job.note || '') + '\n[Process metadata could not be persisted; full output archive may still be available.]'; }
    jobs.delete(job.id);
  });
  return observe(job, yieldMs, outputMaxChars);
}

export async function inspectShell(env: JournalEnv, id: string, stop: boolean, waitMs = 1000, signal?: AbortSignal, outputMaxChars = SHELL_OUTPUT_DEFAULT) {
  const job = jobs.get(id);
  if (!job) {
    const saved = savedJob(id);
    if (saved && saved.env.sessionId === env.sessionId && saved.env.workspacePath === env.workspacePath) {
      return { result: { ok: saved.result?.exitCode === 0, output: saved.result ? `Command exited; exit code ${saved.result.exitCode}. Full output: ${saved.artifact?.downloadUrl || 'unavailable'}` : 'Process status unknown after server restart; cannot wait or stop this handle. Use read_full for retained output.', exitCode: saved.result?.exitCode ?? null, error: saved.result ? saved.result.artifactError : 'Process handle unavailable after restart.' }, artifact: saved.artifact, changeId: saved.changeId };
    }
  }
  if (!job || job.env.sessionId !== env.sessionId || job.env.workspacePath !== env.workspacePath) return { result: { ok: false, output: '', error: 'Process not found in this session. Process handles do not survive an EC12 server restart.' } };
  const abort = () => job.controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (stop || signal?.aborted) abort();
  try { return await observe(job, waitMs, outputMaxChars); }
  finally { signal?.removeEventListener('abort', abort); }
}
