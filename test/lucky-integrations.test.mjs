import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callMcpTool, McpStdioClient } from '../src/server/mcp-stdio.ts';

const root = path.resolve('test-output/lucky-integrations');
process.env.EC12_DATA_DIR = path.join(root, 'data');
fs.mkdirSync(root, { recursive: true });
const fixture = path.join(root, 'mcp-fixture.mjs');
fs.writeFileSync(fixture, `import readline from 'node:readline';
const input = readline.createInterface({input:process.stdin});
let initialized = false;
input.on('line', line => {
 const m = JSON.parse(line);
 if (m.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:process.env.BAD_PROTOCOL ? 'unsupported' : '2025-06-18',capabilities:{tools:{}}}})+'\\n');
 if (m.method === 'notifications/initialized') initialized = true;
 if (m.method === 'tools/call') {
  if (!initialized) process.exit(4);
  if (m.params.name === 'silent') return;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'verified reply'}]}})+'\\n', () => { if(m.params.name === 'exit') process.exit(0); });
 }
});
input.on('close',()=>process.exit(0));
`);
const base = { label: 'Fixture', command: process.execPath, args: [fixture], cwd: root, arguments: {}, timeoutMs: 2000, shutdownGraceMs: 100 };

test('MCP drains a final tool response before child close', async () => {
 const result = await callMcpTool({ ...base, tool: 'exit' });
 assert.equal(result.ok, true, result.error);
 assert.equal(result.output, 'verified reply');
});
test('MCP rejects unsupported initialization protocol', async () => {
 const result = await callMcpTool({ ...base, tool: 'reply', env: { BAD_PROTOCOL: '1' } });
 assert.equal(result.ok, false);
 assert.match(result.error, /Unsupported MCP protocol/);
});
test('MCP cancellation cleans up without waiting for response deadline', async () => {
 const client = new McpStdioClient({ ...base, timeoutMs: 60000 });
 await client.initialize();
 const controller = new AbortController();
 const start = Date.now();
 const pending = client.tool('silent', {}, controller.signal);
 setTimeout(() => controller.abort(), 30);
 const result = await pending;
 await client.close();
 assert.equal(result.ok, false);
 assert.match(result.error, /cancelled/);
 assert.ok(Date.now() - start < 3000);
 assert.equal(client.alive, false);
});
test('actual installed Ponytail returns meaningful rules', async () => {
 const { ponytailInstructions, ponytailMcpInstalled } = await import('../src/server/ponytail-mcp.ts');
 assert.equal(ponytailMcpInstalled(), true);
 const result = await ponytailInstructions('full');
 assert.equal(result.ok, true, result.error);
 assert.match(result.output, /YAGNI|smallest correct/i);
});
test('read_file paging covers offsets, limits, and long-line continuation', async () => {
 const { executeTool } = await import('../src/server/tools/registry.ts');
 const dir = fs.mkdtempSync(path.join(root, 'read-'));
 const file = path.join(dir, 'big.txt');
 fs.writeFileSync(file, Array.from({ length: 30 }, (_, i) => `line${i + 1} ` + 'x'.repeat(5)).join('\n'));
 const env = { workspacePath: dir, runId: 't', sessionId: 't', reviewMode: false };
 const limits = { toolOutputMaxChars: 0, readFileMaxChars: 0, searchOutputMaxChars: 0, webTimeoutMs: 0, context7TimeoutMs: 0 };
 const page = await executeTool({ env, mode: 'ask', contextTools: limits }, 'read_file', { path: 'big.txt', offset: 2, limit: 3 });
 assert.match(page.result.output, /2: line2/);
 assert.match(page.result.output, /4: line4/);
 assert.ok(!page.result.output.includes('line5 '));
 assert.match(page.result.output, /more content: offset 5/);
 const tail = await executeTool({ env, mode: 'ask', contextTools: limits }, 'read_file', { path: 'big.txt', offset: 30 });
 assert.ok(tail.result.ok);
});
test('search_files advances by emitted matches and reports unreadable roots', async () => {
 const { searchFiles } = await import('../src/server/tools/registry.ts');
 const dir = fs.mkdtempSync(path.join(root, 'search-'));
 for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), `needle line\nsecond needle\n`);
 const page1 = await searchFiles(dir, { query: 'needle', limit: 10 });
 assert.equal(page1.ok, true);
 assert.ok(/use offset 10/.test(page1.output), page1.output);
 const bad = await searchFiles(path.join(dir, 'missing-dir'), { query: 'needle' });
 assert.equal(bad.ok, false);
 assert.match(bad.error, /unreadable/);
 const asFile = await searchFiles(path.join(dir, 'f0.txt'), { query: 'needle' });
 assert.ok(asFile.ok && /f0\.txt:2/.test(asFile.output), asFile.output);
});
test('web_search failures are errors, not empty results', async () => {
 const { executeTool } = await import('../src/server/tools/registry.ts');
 const dir = fs.mkdtempSync(path.join(root, 'web-'));
 const env = { workspacePath: dir, runId: 't', sessionId: 't', reviewMode: false };
 const result = await executeTool({ env, mode: 'ask', contextTools: { search: true, webTimeoutMs: 1 } }, 'web_search', { query: 'anything' });
 assert.equal(result.result.ok, false);
 assert.match(result.result.error, /web_search failed|Search/);
});
test('actual CodeGraph Settings actions index, query, refresh and stop an isolated workspace', { timeout: 180000 }, async () => {
 const { registerWorkspace } = await import('../src/server/workspace/path-policy.ts');
 const { POST } = await import('../src/app/api/context-tools/route.ts');
 const { GET } = await import('../src/app/api/integrations/route.ts');
 const graph = await import('../src/server/codegraph-mcp.ts');
 const dir = fs.mkdtempSync(path.join(root, 'graph-'));
 fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'lucky-fixture', type: 'module' }));
 fs.writeFileSync(path.join(dir, 'math.ts'), 'export function luckyAdd(a: number, b: number) { return a + b; }\n');
 fs.writeFileSync(path.join(dir, 'main.ts'), "import { luckyAdd } from './math';\nexport function main() { return luckyAdd(13, 7); }\n");
 const ws = registerWorkspace(dir);
 const request = async (action) => (await POST(new Request('http://localhost/api/context-tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost' }, body: JSON.stringify({ tool: 'codegraph', action, workspaceId: ws.id }) }))).json();
 try {
  assert.equal((await request('test')).ok, false);
  assert.equal(fs.existsSync(path.join(dir, '.codegraph')), false);
  const indexed = await request('index');
  assert.equal(indexed.ok, true, JSON.stringify(indexed));
  const otherBundle = await import('../src/server/codegraph-mcp.ts?bundle=integration-test');
  assert.equal(otherBundle.codegraphHealth(dir).status, 'ready');
  const result = await otherBundle.codegraphExplore(dir, 'luckyAdd');
  assert.equal(result.ok, true, result.error);
  assert.match(result.output, /luckyAdd|math\.ts/);
  assert.equal((await request('test')).ok, true);
  const status = await (await GET(new Request('http://localhost/api/integrations?workspaceId=' + ws.id, { headers: { Host: 'localhost' } }))).json();
  assert.equal(status.details.codegraph.status, 'ready');
  assert.ok(status.details.codegraph.actions.includes('refresh'));
  fs.writeFileSync(path.join(dir, 'math.ts'), 'export function luckyMultiply(a: number, b: number) { return a * b; }\n');
  assert.equal((await request('refresh')).ok, true);
  const refreshed = await graph.codegraphExplore(dir, 'luckyMultiply');
  assert.equal(refreshed.ok, true, refreshed.error);
  assert.match(refreshed.output, /luckyMultiply/);
  console.log('CodeGraph: indexed fixture, queried luckyAdd, refreshed and queried luckyMultiply; cross-bundle status ready');
 } finally {
  await graph.shutdownCodegraph(dir);
  assert.notEqual(graph.codegraphHealth(dir).status, 'ready');
  assert.equal(globalThis.luckyCodegraphs.size, 0);
 }
});
test('configured output limits include zero/unlimited and long-line continuation', async () => {
 const { executeTool, searchFiles } = await import('../src/server/tools/registry.ts');
 const dir = fs.mkdtempSync(path.join(root, 'limits-'));
 const text = 'x'.repeat(30000);
 fs.writeFileSync(path.join(dir, 'long.txt'), text);
 const env = { workspacePath: dir, runId: 'limits', sessionId: 'limits', reviewMode: false };
 const ctx = { env, mode: 'ask', contextTools: { readFileMaxChars: 0, toolOutputMaxChars: 0 } };
 const full = await executeTool(ctx, 'read_file', { path: 'long.txt' });
 assert.ok(full.result.output.endsWith(text));
 const small = await executeTool({ ...ctx, contextTools: { readFileMaxChars: 12 } }, 'read_file', { path: 'long.txt', offset: 1 });
 assert.match(small.result.output, /character_offset 12/);
 const next = await executeTool({ ...ctx, contextTools: { readFileMaxChars: 12 } }, 'read_file', { path: 'long.txt', offset: 1, character_offset: 12 });
 assert.match(next.result.output, /character_offset 24/);
 const capped = await executeTool({ ...ctx, contextTools: { toolOutputMaxChars: 8 } }, 'todo', { steps: ['abcdefghijklm'] });
 assert.match(capped.result.output, /truncated at 8/);
 const uncapped = await executeTool(ctx, 'todo', { steps: [text] });
 assert.ok(uncapped.result.output.endsWith(text));
 fs.writeFileSync(path.join(dir, 'matches.txt'), Array.from({ length: 10 }, (_, i) => 'needle ' + i).join('\n'));
 const page = await searchFiles(dir, { path: 'matches.txt', query: 'needle', limit: 2, offset: 3 }, undefined, 0);
 assert.match(page.output, /matches.txt:4: needle 3/);
 assert.match(page.output, /use offset 5/);
 const shell = await executeTool({ ...ctx, mode: 'code', contextTools: { shellOutputMaxChars: 0 } }, 'shell_command', { command: "[Console]::Write('z' * 10000)", yield_ms: 10000 });
 assert.equal(shell.result.exitCode, 0, shell.result.error);
 assert.ok(shell.result.output.includes('z'.repeat(10000)));
});
test('actual RTK test verifies a supported rewrite and executes it locally', async () => {
 const { POST } = await import('../src/app/api/context-tools/route.ts');
 const { executeTool } = await import('../src/server/tools/registry.ts');
 const response = await (await POST(new Request('http://localhost/api/context-tools', { method: 'POST', headers: { Host: 'localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'rtk' }) }))).json();
 assert.equal(response.ok, true, JSON.stringify(response));
 assert.match(response.output, /rtk git status/);
 const dir = fs.mkdtempSync(path.join(root, 'rtk-'));
 fs.writeFileSync(path.join(dir, 'rtk-fixture.txt'), 'RTK_LOCAL_VERIFIED');
 const execution = await executeTool({ env: { workspacePath: dir, runId: 'rtk', sessionId: 'rtk', reviewMode: false }, mode: 'code', contextTools: { rtk: true } }, 'shell_command', { command: 'cat rtk-fixture.txt', yield_ms: 10000 });
 assert.equal(execution.result.exitCode, 0, execution.result.error);
 assert.match(execution.result.output, /RTK_LOCAL_VERIFIED/);
 assert.match(execution.result.output, /RTK rewrote/);
 console.log(response.output + '; executed rewritten cat on isolated fixture');
});
test('Context7 negotiates discovered schemas and passes resolver query', async () => {
 const http = await import('node:http');
 const { context7Docs } = await import('../src/server/context7.ts');
 const calls = [];
 const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const msg = JSON.parse(raw); calls.push(msg);
  if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} } };
  if (msg.method === 'tools/list') result = { tools: [
   { name: 'resolve-library-id', inputSchema: { properties: { libraryName: {}, query: {} }, required: ['libraryName', 'query'] } },
   { name: 'query-docs', inputSchema: { properties: { libraryId: {}, query: {} }, required: ['libraryId', 'query'] } }
  ] };
  if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: msg.params.name === 'resolve-library-id' ? 'Library ID: /vercel/next.js' : 'Use export async function GET() to handle requests.' }] };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  const result = await context7Docs('route handler', 'Next.js', undefined, '', { endpoint: 'http://127.0.0.1:' + server.address().port, timeoutMs: 2000 });
  assert.equal(result.ok, true, result.error);
  assert.match(result.output, /function GET/);
  assert.equal(calls.find(c => c.params?.name === 'resolve-library-id').params.arguments.query, 'route handler');
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('skill reads remain usable inside their configured directory', async () => {
 const { readSkill } = await import('../src/server/prompt-files.ts');
 const dir = fs.mkdtempSync(path.join(root, 'skills-'));
 const skill = path.join(dir, 'lucky-local-skill'); fs.mkdirSync(skill);
 fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Lucky local skill\nUse the local fixture.');
 fs.writeFileSync(path.join(skill, 'example.txt'), 'LOCAL_SKILL_OK');
 const before = process.env.EC12_SKILLS_DIR;
 process.env.EC12_SKILLS_DIR = dir;
 try { assert.equal(readSkill('lucky-local-skill', 'example.txt').content, 'LOCAL_SKILL_OK'); }
 finally { if (before === undefined) delete process.env.EC12_SKILLS_DIR; else process.env.EC12_SKILLS_DIR = before; }
});
test('MCP deadline kills its silent child before close resolves', async () => {
 const client = new McpStdioClient({ ...base, timeoutMs: 50 });
 const pid = client.child.pid;
 const response = await client.tool('silent', {});
 assert.equal(response.ok, false);
 await client.close();
 assert.throws(() => process.kill(pid, 0));
});
test('context7 passes the query argument required by the resolver', async () => {
 const { context7LibraryId } = await import('../src/server/context7.ts');
 assert.equal(context7LibraryId('Available Libraries:\n\n- Library ID: /vercel/next.js\n- Name: Next.js', 'Next.js'), '/vercel/next.js');
});

