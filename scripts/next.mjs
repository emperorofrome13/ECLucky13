// Cross-platform launcher: sets a separate dist dir so `build`/`start` never touch the
// `.next` a running `dev` server is using. No env var for the user to remember.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'dev';
const port = process.env.PORT || '3313';

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
if (!existsSync(nextBin)) {
  console.error('[eclucky13] next is not installed. Run: npm install');
  process.exit(1);
}

const distDir = mode === 'dev' ? '.next' : '.next-build';
const args = [nextBin, mode];
if (mode === 'dev' || mode === 'start') args.push('-H', '127.0.0.1', '-p', port);

console.log(`[eclucky13] next ${mode} (distDir=${distDir}${mode === 'dev' ? '' : ', isolated from dev'})`);
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production', EC12_DIST_DIR: distDir },
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

