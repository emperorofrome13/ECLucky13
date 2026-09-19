#!/usr/bin/env node
// Install the MCP servers EC12 talks to, under vendor/.
//
// These are third-party servers, not EC12 code, which is why they are not committed: CodeGraph
// ships a platform-specific native bundle and Ponytail is installed from its own repository. Until
// they exist on disk, EC12 drops their tools from the model's schema (see RunManager), so the agent
// never spends a turn calling something that cannot answer.
//
//   node scripts/install-mcp.mjs            # both
//   node scripts/install-mcp.mjs ponytail   # one
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const TARGETS = {
  codegraph: {
    dir: path.join(root, 'vendor', 'codegraph'),
    spec: '@colbymchenry/codegraph',
    check: () => fs.existsSync(path.join(root, 'vendor', 'codegraph', 'node_modules', '@colbymchenry', `codegraph-${process.platform}-${process.arch}`, 'lib', 'dist', 'bin', 'codegraph.js')),
    note: 'CodeGraph installs a platform-specific runtime bundle; it must be installed on the machine that runs EC12.',
  },
  ponytail: {
    dir: path.join(root, 'vendor', 'ponytail', 'ponytail-mcp'),
    spec: 'github:DietrichGebert/ponytail',
    check: () => ['package.json', 'hooks/ponytail-instructions.js', 'hooks/ponytail-config.js', 'ponytail-mcp/index.js', 'ponytail-mcp/instructions.js', 'ponytail-mcp/node_modules/@modelcontextprotocol/sdk', 'ponytail-mcp/node_modules/zod'].every((file) => fs.existsSync(path.join(root, 'vendor', 'ponytail', file))),
    note: 'Ponytail is installed from its repository; git must be available on PATH.',
  },
};

function run(args, cwd) {
  const r = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', npm, ...args], { cwd, stdio: 'inherit', windowsHide: true })
    : spawnSync(npm, args, { cwd, stdio: 'inherit' });
  if (r.error) console.error(r.error.message);
  return r.status === 0;
}

function install(name) {
  const target = TARGETS[name];
  process.stdout.write(`\n== ${name} ==\n${target.note}\n`);
  if (name === 'ponytail' && !fs.existsSync(path.join(target.dir, 'index.js'))) {
    const vendor = path.join(root, 'vendor');
    fs.mkdirSync(vendor, { recursive: true });
    const staging = fs.mkdtempSync(path.join(vendor, '.ponytail-install-'));
    try {
      const checkout = path.join(staging, 'repo');
      const result = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/DietrichGebert/ponytail.git', checkout], { stdio: 'inherit', windowsHide: true });
      if (result.error || result.status !== 0) throw result.error || new Error('Ponytail checkout failed.');
      if (!fs.existsSync(path.join(checkout, 'ponytail-mcp', 'index.js'))) throw new Error('Ponytail checkout has no MCP entry point.');
      fs.cpSync(checkout, path.dirname(target.dir), { recursive: true, filter: (file) => path.basename(file) !== '.git' });
    } catch (error) {
      console.error(error.message);
      return false;
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  fs.mkdirSync(target.dir, { recursive: true });
  const manifest = path.join(target.dir, 'package.json');
  if (!fs.existsSync(manifest)) {
    fs.writeFileSync(manifest, JSON.stringify({ name: `ec12-vendor-${name}`, private: true, version: '1.0.0' }, null, 2));
  }
  if (!run(['install', ...(name === 'ponytail' ? [] : [target.spec]), '--no-audit', '--no-fund'], target.dir)) {
    process.stdout.write(`FAILED: npm could not install ${target.spec}.\n`);
    return false;
  }
  const ok = target.check();
  process.stdout.write(ok ? `OK: ${name} MCP is installed and EC12 will offer its tool.\n` : `INSTALLED BUT NOT USABLE: ${name} did not produce the expected server entry point.\n`);
  return ok;
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const names = requested.length ? requested : Object.keys(TARGETS);
let failures = 0;
for (const name of names) {
  if (!TARGETS[name]) { process.stdout.write(`Unknown MCP "${name}". Known: ${Object.keys(TARGETS).join(', ')}\n`); failures++; continue; }
  if (!install(name)) failures++;
}
process.stdout.write(`\n${names.length - failures}/${names.length} MCP server(s) ready. Verify from Settings > Tools > Test.\n`);
process.exit(failures ? 1 : 0);
