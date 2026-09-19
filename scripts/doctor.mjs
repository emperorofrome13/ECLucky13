// EC12 doctor: checks the environment and reports actionable problems. Never masks failures.
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const results = [];
const ok = (n, d = '') => results.push(['OK', n, d]);
const warn = (n, d = '') => results.push(['WARN', n, d]);
const fail = (n, d = '') => results.push(['FAIL', n, d]);

const major = Number(process.versions.node.split('.')[0]);
if (major >= 18) ok('node', process.versions.node); else fail('node', `need >=18, have ${process.versions.node}`);

if (existsSync(path.join(root, 'node_modules', 'next'))) ok('dependencies', 'next present'); else fail('dependencies', 'run npm install');

if (existsSync(path.join(root, 'next.config.js'))) ok('next.config.js');
else warn('next.config.js missing');

try { mkdirSync(path.join(root, 'data'), { recursive: true }); ok('data dir'); } catch (e) { fail('data dir', String(e?.message || e)); }

try { mkdirSync(path.join(root, 'workspaces'), { recursive: true }); ok('workspaces dir'); } catch (e) { fail('workspaces dir', String(e?.message || e)); }

const mcpTargets = [
  ['Ponytail MCP', path.join(root, 'vendor', 'ponytail', 'ponytail-mcp', 'node_modules', '@modelcontextprotocol', 'sdk')],
  ['CodeGraph MCP', path.join(root, 'vendor', 'codegraph', 'node_modules', '@colbymchenry', `codegraph-${process.platform}-${process.arch}`, 'lib', 'dist', 'bin', 'codegraph.js')],
];
for (const [name, entry] of mcpTargets) {
  if (existsSync(entry)) ok(name, 'installed');
  else warn(name, 'not installed — run: npm run install:mcp (its tool is withheld from the model until then)');
}

function probe(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    let done = false;
    const fin = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeout);
    s.on('connect', () => fin(true));
    s.on('error', () => fin(false));
    s.on('timeout', () => fin(false));
  });
}

const lm = await probe(1234);
if (lm) ok('LM Studio (1234)', 'reachable'); else warn('LM Studio (1234)', 'not reachable — start LM Studio if you use it');
const app = await probe(3000);
if (app) warn('port 3000', 'already in use — another dev server is running'); else ok('port 3000', 'free');

let playwright = false;
try { const { createRequire } = await import('node:module'); const req = createRequire(import.meta.url); req.resolve('playwright-core'); playwright = true; } catch { /* no */ }
if (playwright) {
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pw = req('playwright-core');
    const exe = pw.chromium?.executablePath?.();
    if (exe && existsSync(exe)) ok('browser', 'chromium available'); else warn('browser', 'playwright-core present but no browser binary');
  } catch { warn('browser', 'could not query chromium'); }
} else warn('browser', 'playwright-core not installed — web verification will be unavailable, not passed');

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\nEC12 doctor\n==========');
for (const [level, name, detail] of results) console.log(`${pad(level, 5)} ${pad(name, 24)} ${detail}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length} checks · ${failed} failing\n`);
process.exit(failed > 0 ? 1 : 0);
