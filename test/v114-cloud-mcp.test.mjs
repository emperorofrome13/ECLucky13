// v1.14 regressions: the cloud token diet, the bounded output budget, the incremental event log,
// and the MCP handshake. Each test pins a defect that was observed in v1.13, not a hypothetical.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cm = await import('../src/server/agent/context-manager.ts');
const manager = await import('../src/server/runs/manager.ts');
const registry = await import('../src/server/tools/registry.ts');
const mcp = await import('../src/server/mcp-stdio.ts');

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-v114-'));

function conversationWithReasoning() {
  const c = cm.newConversation();
  c.messages.push(
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, reasoning_content: 'TOOL_TURN_REASONING', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'a.txt' },
    { role: 'assistant', content: 'here is the answer', reasoning_content: 'TEXT_TURN_REASONING' },
  );
  return c;
}

test('remote replay keeps reasoning on tool-call turns and drops it from plain text turns', () => {
  const prepared = cm.prepareConversation(conversationWithReasoning(), ['sys'], [], 32000, 4096, false, 80, 4, 'tool-turns');
  const text = JSON.stringify(prepared.messages);
  // DeepSeek thinking mode returns 400 unless tool-call turns are replayed with their reasoning.
  assert.ok(text.includes('TOOL_TURN_REASONING'), 'tool-call reasoning must survive for DeepSeek');
  // Every other turn's reasoning is ignored by DeepSeek and unknown elsewhere: pure cost.
  assert.ok(!text.includes('TEXT_TURN_REASONING'), 'plain-turn reasoning must not be replayed');
});

test('token counting stays bounded on degenerate input', () => {
  // BPE merging is quadratic in the length of one whitespace-free run: 20,000 identical characters
  // took 18 s before this guard, blocking the agent loop and the event stream with it.
  const started = Date.now();
  const degenerate = cm.countTokens('R'.repeat(60000) + '\n' + '='.repeat(60000));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `counting took ${elapsed}ms`);
  assert.ok(degenerate > 0);
  // Ordinary content is still counted exactly and quickly.
  const prose = ('the quick brown fox jumps over the lazy dog. ').repeat(2000);
  const proseStart = Date.now();
  assert.ok(cm.countTokens(prose) > 10000);
  assert.ok(Date.now() - proseStart < 2000);
});

test('the remote diet measurably shrinks the request versus full replay', () => {
  const big = ('reasoning about the change we are making here. ').repeat(900);
  const build = () => {
    const c = cm.newConversation();
    c.messages.push({ role: 'user', content: 'task' });
    for (let i = 0; i < 6; i++) {
      c.messages.push({ role: 'assistant', content: `step ${i}`, reasoning_content: big });
    }
    return c;
  };
  const full = cm.prepareConversation(build(), ['sys'], [], 200000, 4096, false, 80, 4, 'full');
  const diet = cm.prepareConversation(build(), ['sys'], [], 200000, 4096, false, 80, 4, 'tool-turns');
  assert.ok(diet.usedTokens * 4 < full.usedTokens, `diet ${diet.usedTokens} vs full ${full.usedTokens}`);
});

test('durable history keeps the reasoning that the request omits', () => {
  const conversation = conversationWithReasoning();
  cm.prepareConversation(conversation, ['sys'], [], 32000, 4096, false, 80, 4, 'tool-turns');
  assert.equal(conversation.messages[3].reasoning_content, 'TEXT_TURN_REASONING', 'pruning must not mutate durable history');
});

test('a remote model without a declared output limit does not get a context-sized max_tokens', () => {
  // A 200k-context cloud model previously received max_tokens ~190000, which hosted APIs reject.
  assert.equal(manager.defaultMaxOutput(false, 200000), manager.REMOTE_DEFAULT_MAX_OUTPUT);
  assert.ok(manager.defaultMaxOutput(false, 200000) < 200000);
  // A local server can genuinely generate up to its loaded context: unchanged.
  assert.equal(manager.defaultMaxOutput(true, 65536), 65536);
  // A context smaller than the cap is never raised to it.
  assert.equal(manager.defaultMaxOutput(false, 8000), 8000);
});

test('failed tool output is capped before it is replayed to the model', async () => {
  const env = { workspacePath: WS, runId: 'r', sessionId: 's', reviewMode: false };
  const exec = await registry.executeTool({ env, mode: 'code', contextTools: {} }, 'edit_file', {
    path: 'missing.txt', old_string: 'x'.repeat(50000), new_string: 'y',
  });
  assert.equal(exec.result.ok, false);
  assert.ok((exec.result.error || '').length <= 4200, `error replay was ${(exec.result.error || '').length} characters`);
});

test('the event log serves history incrementally instead of rescanning the whole file', async () => {
  const { eventStore } = await import('../src/server/events.ts');
  const runId = 'run_v114_' + Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < 200; i++) eventStore.append(runId, 'ses', 'tool.finished', { i, blob: 'x'.repeat(500) });
  const tail = eventStore.history(runId, 195);
  assert.equal(tail.length, 5, 'only events after the cursor are returned');
  assert.equal(tail[0].sequence, 196);
  assert.equal(eventStore.history(runId, 0).length, 200, 'full replay still works');
  // The SSE route polls this several times a second; it must stay cheap on a large log.
  const started = Date.now();
  for (let i = 0; i < 500; i++) eventStore.history(runId, 200);
  assert.ok(Date.now() - started < 1500, 'polling an idle run must not re-parse the log each time');
});

test('MCP results are read from the standard content array, not only structuredContent', () => {
  // The official MCP SDK answers with content blocks; reading only structuredContent made a
  // correctly installed Ponytail server report "returned no instructions".
  assert.equal(mcp.mcpResultText({ content: [{ type: 'text', text: 'YAGNI' }] }), 'YAGNI');
  assert.equal(mcp.mcpResultText({ structuredContent: { instructions: 'from structured' } }), 'from structured');
  assert.equal(mcp.mcpResultText({}), '');
});

test('an MCP server that never answers fails the tool call instead of hanging the run', async () => {
  const script = path.join(WS, 'silent-mcp.mjs');
  fs.writeFileSync(script, 'process.stdin.resume(); setInterval(() => {}, 1000);\n');
  const started = Date.now();
  const result = await mcp.callMcpTool({
    label: 'Silent', command: process.execPath, args: [script], cwd: WS,
    tool: 'anything', arguments: {}, timeoutMs: 1500,
  });
  assert.equal(result.ok, false);
  assert.match(result.error || '', /did not respond/);
  assert.ok(Date.now() - started < 10000, 'the call must be bounded by its timeout');
});

test('search_files skips an unreadable entry instead of failing the whole search', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-search-'));
  fs.writeFileSync(path.join(dir, 'good.txt'), 'needle here\n');
  const blocked = path.join(dir, 'blocked.txt');
  fs.writeFileSync(blocked, 'needle here\n');
  try { fs.chmodSync(blocked, 0o000); } catch { /* best effort */ }
  const result = await registry.searchFiles(dir, { query: 'needle' });
  assert.equal(result.ok, true);
  assert.match(result.output, /good\.txt/);
  try { fs.chmodSync(blocked, 0o644); } catch { /* best effort */ }
});
