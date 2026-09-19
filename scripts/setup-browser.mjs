// Installs a runnable Chromium for EC12's browser verification (browser smoke check).
// Without this, browser checks report "unavailable" — never "passed".
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules', 'playwright-core', 'cli.js');

console.log('[ec12] installing chromium for browser verification (this downloads ~170MB once)…');
const child = spawn(process.execPath, [cli, 'install', 'chromium'], { cwd: root, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => {
  console.log(code === 0 ? '[ec12] chromium installed.' : `[ec12] install failed (exit ${code}). Browser checks will report unavailable.`);
  process.exit(code ?? 1);
});
