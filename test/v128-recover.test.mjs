import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-recover-'));
process.env.EC12_DATA_DIR = path.join(root, 'data');
const loop = await import('../src/server/agent/loop.ts');
const cm = await import('../src/server/agent/context-manager.ts');
const schema = await import('../src/shared/settings-schema.ts');
const { exitCode } = await import('./shell-compat.mjs');

const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace, { recursive: true });

const failCall = { type: 'tool_delta', index: 0, id: 'c1', name: 'shell_command', argsDelta: JSON.stringify({ command: exitCode(1) }) };
const done = { type: 'done', finishReason: 'stop' };

// Always stuck: every turn emits the same failing call.
function stuckProvider(counter) {
  return { async *stream() { counter.requests++; yield { ...failCall }; yield done; } };
}

function loopDeps(provider, extra = {}) {
  return { runId: 'recover', sessionId: 'recover', workspace, mode: 'code',
    signal: new AbortController().signal, provider, contextWindow: 16000, requestedMaxTokens: 1000,
    maxIterations: 6, repeatedFailureLimit: 2, noProgressTurnLimit: 50, turnRecoveryAttempts: 0,
    contextTools: {}, journalEnv: { workspacePath: workspace, runId: 'recover', sessionId: 'recover', reviewMode: false },
    conversation: cm.newConversation(), systemBlocks: ['Fixture instructions'], task: 'Run the check', emit: () => {}, ...extra };
}

const recoveryNotes = (conv) => conv.messages.filter((m) => m.role === 'user' && String(m.content).includes('going in circles'));

test('a stuck run is handed its block info and never stopped by the watchdog', async () => {
  const counter = { requests: 0 };
  const conv = cm.newConversation();
  // Default (0) = unlimited recoveries; the iteration budget ends the run, not the stall.
  const outcome = await loop.runMainLoop(loopDeps(stuckProvider(counter), { conversation: conv }));
  assert.equal(outcome.blocked, false, 'a stall must never stop the run');
  assert.equal(outcome.exhausted, true, 'the iteration budget ends it');
  assert.ok(counter.requests > 3, `run continued past the first stalls (requests: ${counter.requests})`);
  const notes = recoveryNotes(conv);
  assert.ok(notes.length >= 1, `block info was sent back mid-run (notes: ${notes.length})`);
  assert.ok(notes[0].content.includes('shell_command'), 'note names the failing tool');
  assert.ok(notes[0].content.includes('Do NOT emit the same failing call unchanged'), 'note directs, not just informs');
});

test('an explicit recovery bound still stops a hopeless loop', async () => {
  const counter = { requests: 0 };
  const conv = cm.newConversation();
  const outcome = await loop.runMainLoop(loopDeps(stuckProvider(counter), { conversation: conv, blockRecoveryAttempts: 1, maxIterations: 12 }));
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.blockedTool, 'shell_command');
  assert.equal(recoveryNotes(conv).length, 1, 'exactly one recovery note for a limit of 1');
});

test('a model that fixes itself after the recovery completes the run', async () => {
  let n = 0;
  const provider = { async *stream() {
    n++;
    if (n <= 2) { yield { ...failCall }; yield done; return; }
    yield { type: 'content', text: 'Fixed the quoting; the check passes now.' };
    yield done;
  } };
  const conv = cm.newConversation();
  const outcome = await loop.runMainLoop(loopDeps(provider, { mode: 'ask', conversation: conv }));
  assert.equal(outcome.blocked, false);
  assert.match(outcome.content, /Fixed the quoting/);
  assert.ok(recoveryNotes(conv).length >= 1, 'recovery note was sent mid-run');
});

test('block recoveries default to unlimited (0) and normalize within bounds', () => {
  assert.equal(schema.normalizeSettings({}).agent.blockRecoveryAttempts, 0);
  assert.equal(schema.normalizeSettings({ agent: { blockRecoveryAttempts: 99 } }).agent.blockRecoveryAttempts, 10);
});

test('ProgressGuard still names the stall pattern (unit level)', () => {
  const g = new loop.ProgressGuard(3, 20, 20);
  g.begin();
  assert.equal(g.observe('shell_command', 'a', { ok: false, error: 'boom' }), undefined);
  assert.equal(g.observe('shell_command', 'a', { ok: false, error: 'boom' }), undefined);
  assert.equal(g.observe('shell_command', 'a', { ok: false, error: 'boom' }), 'Repeated failure: shell_command');
  const h = new loop.ProgressGuard(0, 2, 0);
  h.begin();
  assert.equal(h.observe('read_file', 'a', { ok: false, error: 'gone-1' }), undefined);
  assert.equal(h.end(), undefined);
  h.begin();
  assert.equal(h.observe('read_file', 'b', { ok: false, error: 'gone-2' }), undefined);
  assert.equal(h.end(), 'No progress: 2 consecutive turns had only failing tool calls.');
  // Any success resets the stall count.
  h.begin();
  assert.equal(h.observe('read_file', 'c', { ok: true, output: 'new data' }), undefined);
  assert.equal(h.end(), undefined);
});
