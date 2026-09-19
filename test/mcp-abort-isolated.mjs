import assert from 'node:assert/strict';
import { McpStdioClient } from '../src/server/mcp-stdio.ts';

const source = `
const readline = require('node:readline');
const input = readline.createInterface({ input: process.stdin });
setInterval(() => {}, 1000);
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, pid: process.pid } }) + '\\n');
});
`;
const client = new McpStdioClient({
  label: 'Isolated abort fixture',
  command: process.execPath,
  args: ['-e', source],
  cwd: process.cwd(),
  env: {},
  timeoutMs: 0,
  maxFrameBytes: 4194304,
  stderrMaxChars: 8000,
  shutdownGraceMs: 0,
});
const watchdog = setTimeout(() => {
  console.error('FAIL: isolated abort check exceeded five seconds.');
  process.exit(1);
}, 5000);
let pid;
try {
  ({ pid } = await client.initialize());
  assert.ok(Number.isInteger(pid));
  const controller = new AbortController();
  const pending = client.request('tools/call', { name: 'silent', arguments: {} }, controller.signal);
  const rejected = assert.rejects(pending, /cancelled/i);
  const start = performance.now();
  controller.abort();
  await rejected;
  await client.close();
  let alive = true;
  while (performance.now() - start < 1000) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const elapsed = Math.round(performance.now() - start);
  assert.equal(alive, false, `Child ${pid} remained alive after ${elapsed}ms.`);
  assert.ok(elapsed < 1000, `Child exit took ${elapsed}ms, exceeding one second.`);
  console.log(`PASS: child ${pid} exited ${elapsed}ms after abort; timeoutMs=0, shutdownGraceMs=0.`);
} finally {
  clearTimeout(watchdog);
  if (pid) { try { process.kill(pid); } catch {} }
}
