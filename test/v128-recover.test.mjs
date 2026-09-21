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
    maxIterations: 12, repeatedFailureLimit: 2, noProgressTurnLimit: 50, turnRecoveryAttempts: 0,
    blockRecoveryAttempts: 1, contextTools: {}, journalEnv: { workspacePath: workspace, runId: 'recover', sessionId: 'recover', reviewMode: false },
    conversation: cm.newConversation(), systemBlocks: ['Fixture instructions'], task: 'Run the check', emit: () => {}, ...extra };
}

test('a stuck run is handed its block info and continues instead of stopping at once', async () => {
  const counter = { requests: 0 };
  const conv = cm.newConversation();
  const outcome = await loop.runMainLoop(loopDeps(stuckProvider(counter), { conversation: conv }));
  // One recovery spent, then the terminal block with the v1.27 explanation payload.
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.blockedTool, 'shell_command');
  assert.ok(counter.requests > 3, `run must continue past the first stall (requests: ${counter.requests})`);
  const notes = conv.messages.filter((m) => m.role === 'user' && String(m.content).includes('going in circles'));
  assert.equal(notes.length, 1, 'exactly one recovery note for a limit of 1');
  assert.ok(notes[0].content.includes('shell_command'), 'note names the failing tool');
  assert.ok(notes[0].content.includes('Do NOT emit the same failing call unchanged'), 'note directs, not just informs');
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
  const outcome = await loop.runMainLoop(loopDeps(provider, { mode: 'ask', conversation: conv, blockRecoveryAttempts: 2 }));
  assert.equal(outcome.blocked, false);
  assert.match(outcome.content, /Fixed the quoting/);
  assert.ok(conv.messages.some((m) => m.role === 'user' && String(m.content).includes('going in circles')), 'recovery note was sent mid-run');
});

test('block recoveries default to 2 and normalize within bounds', () => {
  assert.equal(schema.normalizeSettings({}).agent.blockRecoveryAttempts, 2);
  assert.equal(schema.normalizeSettings({ agent: { blockRecoveryAttempts: 0 } }).agent.blockRecoveryAttempts, 0);
  assert.equal(schema.normalizeSettings({ agent: { blockRecoveryAttempts: 99 } }).agent.blockRecoveryAttempts, 10);
});
