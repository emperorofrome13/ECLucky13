import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-unblocked-'));
process.env.EC12_DATA_DIR = path.join(root, 'data');
const loop = await import('../src/server/agent/loop.ts');
const mgr = await import('../src/server/runs/manager.ts');
const cm = await import('../src/server/agent/context-manager.ts');
const { exitCode } = await import('./shell-compat.mjs');

const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace, { recursive: true });

// A provider that always emits the same failing shell command, like a model
// stuck re-running a broken test script.
function stuckProvider() {
  return { async *stream() {
    yield { type: 'tool_delta', index: 0, id: 'c1', name: 'shell_command', argsDelta: JSON.stringify({ command: exitCode(1) }) };
    yield { type: 'done', finishReason: 'stop' };
  } };
}

function loopDeps(provider, extra = {}) {
  return { runId: 'unblocked', sessionId: 'unblocked', workspace, mode: 'code',
    signal: new AbortController().signal, provider, contextWindow: 16000, requestedMaxTokens: 1000,
    maxIterations: 10, repeatedFailureLimit: 2, noProgressTurnLimit: 50, turnRecoveryAttempts: 0,
    contextTools: {}, journalEnv: { workspacePath: workspace, runId: 'unblocked', sessionId: 'unblocked', reviewMode: false },
    conversation: cm.newConversation(), systemBlocks: ['Fixture instructions'], task: 'Run the check', emit: () => {}, ...extra };
}

test('a stuck run blocks with the failing tool and its last error attached', async () => {
  const outcome = await loop.runMainLoop(loopDeps(stuckProvider()));
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.blockedTool, 'shell_command');
  assert.ok((outcome.lastError || '').length > 0, 'last error must travel with the outcome');
  assert.ok(/repeated failure/i.test(outcome.error || ''), 'stall reason names the pattern: ' + outcome.error);
});

test('a blocked run explains itself instead of dying silent', () => {
  const message = mgr.buildBlockedMessage({ content: '', cancelled: false, exhausted: false, blocked: true,
    error: 'Repeated failure: shell_command', blockedTool: 'shell_command', lastError: 'exit code 1',
    productivelyChanged: false, usage: { promptTokens: 0, completionTokens: 0 }, turns: 5 });
  assert.ok(message.includes('shell_command'));
  assert.ok(message.includes('exit code 1'));
  assert.ok(/still open/i.test(message), 'the session must be declared alive');
  assert.ok(/continue|different approach|diagnose/i.test(message), 'concrete next steps required');
});

test('an exhausted run says the budget ran out, not that it failed', () => {
  const message = mgr.buildBlockedMessage({ content: '', cancelled: false, exhausted: true, blocked: false,
    blockedTool: 'shell_command', lastError: 'exit code 1',
    productivelyChanged: false, usage: { promptTokens: 0, completionTokens: 0 }, turns: 8 });
  assert.ok(/iteration budget/i.test(message));
});

test('the failure memo tells the next run not to repeat the doomed call', () => {
  const text = mgr.buildFailureMemoText({ tool: 'shell_command', reason: 'Repeated failure: shell_command',
    lastError: 'exit code 1', runId: 'run_x', at: new Date().toISOString() });
  assert.ok(text.includes('shell_command'));
  assert.ok(/do not repeat/i.test(text));
});

test('the failure memo survives a session save/load round-trip', () => {
  const s = mgr.getOrCreateSession({ workspaceId: 'ws_memo', workspacePath: workspace, title: 'memo' });
  s.failureMemo = { tool: 'shell_command', reason: 'Repeated failure: shell_command', lastError: 'exit code 1', runId: 'run_x', at: new Date().toISOString() };
  mgr.saveSession(s);
  const back = mgr.loadSession(s.id);
  assert.equal(back?.failureMemo?.tool, 'shell_command');
  assert.ok((back?.failureMemo?.reason || '').includes('Repeated failure'));
});
