// Shell snippets in the syntax of whichever shell EC12 resolved on this machine.
//
// The managed-shell tests used to be written in PowerShell only, so on any non-Windows machine they
// failed to spawn and their assertions were rewritten to expect that failure — which meant the
// behaviour they exist to protect (yielding a process id, real exit codes, Stop, tail-capping) was
// verified on Windows alone. These helpers keep one set of tests meaningful on every platform.
import { resolveShell } from '../src/server/tools/process.ts';

const powershell = resolveShell().kind !== 'posix';

export const shellKind = powershell ? 'powershell' : 'posix';

export const echo = (text) => (powershell ? `Write-Output '${text}'` : `echo '${text}'`);
export const sleepSeconds = (n) => (powershell ? `Start-Sleep -Seconds ${n}` : `sleep ${n}`);
export const exitCode = (n) => `exit ${n}`;
export const sequence = (...parts) => parts.join('; ');

/** Write `chars` bytes of `fill` to stdout using node, so the command text needs no shell quoting. */
export function bulkOutput(scriptPath, fill, chars) {
  return { script: `process.stdout.write(${JSON.stringify(fill)}.repeat(${chars}));\n`, command: `node ${scriptPath}` };
}

/** Create a file from the shell, to prove shell-created changes are reconciled into the journal. */
export const createFile = (name, content) => (powershell
  ? `Set-Content -Path ${name} -Value '${content}'`
  : `printf '%s' '${content}' > ${name}`);
