// EC12 regression tests part 2: agent decisions, permissions, verification, processes, persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-data2-'));
process.env.EC12_DATA_DIR = DATA;

const { buildTurnMessages, compact, compactConversation, estimateTokens, summaryBudgetForContext } = await import('../src/server/agent/context-manager.ts');
const { executeTool } = await import('../src/server/tools/registry.ts');
const { runStage } = await import('../src/server/agent/loop.ts');
const { runProcess, runPowerShell } = await import('../src/server/tools/process.ts');
const { createFile } = await import('./shell-compat.mjs');
const { markUnfinishedInterrupted } = await import('../src/server/runs/manager.ts');
const cj = await import('../src/server/workspace/change-journal.ts');
const disc = await import('../src/server/verification/discover.ts');
const exec = await import('../src/server/verification/execute.ts');
const modelDiscovery = await import('../src/server/providers/model-discovery.ts');
const ev = await import('../src/server/events.ts');

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-ws2-'));
const env = (over = {}) => ({ workspacePath: WS, runId: 'run_r2', sessionId: 'ses_r', reviewMode: false, ...over });

// ---- Fake provider: scripted stream events, no model server required ----
class FakeProvider {
  scripts = [];
  constructor(scripts) { this.scripts = scripts; }
  async *stream(messages, opts, signal) {
    const script = this.scripts.shift() || [];
    for (const ev of script) {
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 1));
      yield ev;
    }
    yield { type: 'done', finishReason: 'stop' };
  }
  async listModels() { return []; }
}
const content = (t) => ({ type: 'content', text: t });
const toolCall = (id, name, args) => ({ type: 'tool_delta', index: 0, id, name, argsDelta: JSON.stringify(args) });

test('follow-up turns include prior conversation (structured history, tool pairs intact)', () => {
  const history = [
    { role: 'user', content: 'first task' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'ok' },
    { role: 'assistant', content: 'done writing' },
  ];
  const built = buildTurnMessages({ systemBlocks: ['sys'], history, request: 'now change it to v2', contextBudgetTokens: 100000 });
  const text = built.messages.map((m) => m.content || '').join('\n');
  assert.ok(text.includes('first task'), 'prior user turn must be present');
  assert.ok(JSON.stringify(built.messages).includes('write_file'), 'prior tool call must be present');
  assert.ok(text.includes('done writing'), 'prior assistant turn must be present');
});

test('ask/plan modes cannot mutate via tools or shell', async () => {
  for (const mode of ['ask', 'plan']) {
    const w = await executeTool({ env: env(), mode, contextTools: {} }, 'write_file', { path: 'x.txt', content: 'nope' });
    assert.equal(w.result.ok, false);
    assert.match(w.result.error, /not allowed/);
    const s = await executeTool({ env: env(), mode, contextTools: {} }, 'shell_command', { command: 'echo hi' });
    assert.equal(s.result.ok, false);
    assert.match(s.result.error, /not allowed/);
  }
  const r = await executeTool({ env: env(), mode: 'code', contextTools: {} }, 'write_file', { path: 'ok.txt', content: 'fine' });
  assert.equal(r.result.ok, true);
  assert.ok(r.changeId);
  assert.equal(fs.readFileSync(path.join(WS, 'ok.txt'), 'utf8'), 'fine');
});

test('structured report_verdict is authoritative over misleading prose', async () => {
  const provider = new FakeProvider([[content('Everything looks perfect. VERDICT: PASS'), toolCall('v1', 'report_verdict', { verdict: 'FAIL', summary: 'real bug found' })]]);
  const r = await runStage('review', {
    provider, signal: new AbortController().signal, contextWindow: 16000, requestedMaxTokens: 1024,
    maxIterations: 4, contextTools: {}, journalEnv: env(), systemBlocks: ['sys'], stagePrompt: 'review it',
    conversationContext: 'ctx', emit: () => {},
  });
  assert.equal(r.passed, false);
  assert.match(r.summary, /real bug/);
});

test('a stage without a structured verdict is FAIL', async () => {
  const provider = new FakeProvider([[content('looks fine, VERDICT: PASS')]]);
  const r = await runStage('review', {
    provider, signal: new AbortController().signal, contextWindow: 16000, requestedMaxTokens: 1024,
    maxIterations: 4, contextTools: {}, journalEnv: env(), systemBlocks: ['sys'], stagePrompt: 'review',
    conversationContext: 'ctx', emit: () => {},
  });
  assert.equal(r.passed, false);
  assert.match(r.summary, /No structured VERDICT/);
});

test('compaction never orphans a tool result and stays near budget', () => {
  const msgs = [{ role: 'system', content: 'sys' }];
  for (let i = 0; i < 30; i++) {
    msgs.push({ role: 'user', content: 'q' + i });
    msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: 't' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
    msgs.push({ role: 'tool', tool_call_id: 't' + i, content: 'result' + i });
    msgs.push({ role: 'assistant', content: 'a' + i });
  }
  const budget = 200;
  const r = compact(msgs, budget);
  for (let i = 0; i < r.messages.length; i++) {
    const m = r.messages[i];
    if (m.role === 'tool') {
      const prev = r.messages[i - 1];
      assert.ok(prev && prev.role === 'assistant' && prev.tool_calls?.length, 'tool result must follow its assistant tool_call');
    }
  }
  assert.ok(r.after <= budget + 4000);
});

test('durable auto-compaction retains the original task, active plan, tool state, and four recent turns', () => {
  const conversation = { originalTask: 'Implement durable chat compaction.', plan: ['Preserve tool state', 'Keep recent turns'], summary: '', updatedAt: new Date().toISOString(), messages: [] };
  for (let i = 0; i < 7; i++) {
    conversation.messages.push({ role: 'user', content: `request ${i}` });
    conversation.messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'read_file', arguments: '{"path":"app.ts"}' } }] });
    conversation.messages.push({ role: 'tool', tool_call_id: `t${i}`, content: `tool result ${i}` });
    conversation.messages.push({ role: 'assistant', content: `answer ${i}` });
  }
  const result = compactConversation(conversation, 60928, 4);
  assert.equal(result.compacted, true); assert.equal(result.earlierTurns, 3);
  assert.match(conversation.summary, /Implement durable chat compaction/); assert.match(conversation.summary, /Preserve tool state/); assert.match(conversation.summary, /tool result 0/);
  assert.equal(conversation.messages.filter((m) => m.role === 'user').length, 4);
  assert.ok(result.summaryTokens <= summaryBudgetForContext(60928));
});

test('browser check is skipped with no html files (never a free pass)', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-nohtml-'));
  const checks = disc.discoverChecks(empty).filter((c) => c.kind === 'browser');
  assert.equal(checks.length, 0, 'no html => no browser check at all');
});

test('a failing nested TypeScript project is detected by project checks', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-ts-'));
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 't', scripts: { typecheck: 'tsc --noEmit' } }));
  fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true }, include: ['src'] }));
  fs.mkdirSync(path.join(proj, 'src'));
  fs.writeFileSync(path.join(proj, 'src', 'bad.ts'), 'const x: number = "not a number";\n');
  const checks = disc.discoverChecks(proj);
  const r = await exec.runVerification(proj, checks, undefined, () => {});
  const tc = r.checks.find((c) => c.checkId === 'typecheck');
  assert.ok(tc, 'typecheck check should exist');
  assert.equal(tc.status, 'failed');
  assert.equal(r.outcome, 'failed');
});

test('browser check loads a titled page (or reports unavailable without a browser)', async () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-html-'));
  fs.writeFileSync(path.join(w, 'page.html'), '<html><head><title>T</title></head><body>hi</body></html>');
  const checks = disc.discoverChecks(w).filter((c) => c.kind === 'browser');
  const r = await exec.runVerification(w, checks, undefined, () => {});
  const b = r.checks[0];
  assert.ok(['passed', 'unavailable'].includes(b.status), `unexpected ${b.status}`);
});

test('stopping a command kills it (cancelled, never success)', async () => {
  const ac = new AbortController();
  const p = runProcess({ command: process.execPath, args: ['-e', 'console.log("started"); setTimeout(()=>{}, 30000)'], cwd: WS, timeoutMs: 60000, signal: ac.signal, label: 'kill-test' });
  await new Promise((r) => setTimeout(r, 700));
  ac.abort();
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(res.terminationReason, 'cancelled');
});

test('process-tree kill: stopping the parent also stops its child', async () => {
  const childPidFile = path.join(WS, 'childpid.txt');
  const parent = `const cp=require('node:child_process');const c=cp.spawn(process.execPath,['-e','setTimeout(()=>{},60000)']);require('node:fs').writeFileSync(${JSON.stringify(childPidFile)},String(c.pid));console.log('spawned');setInterval(()=>{},60000);`;
  const ac = new AbortController();
  const runP = runProcess({ command: process.execPath, args: ['-e', parent], cwd: WS, timeoutMs: 60000, signal: ac.signal, label: 'tree-test' });
  let childPid = 0;
  for (let i = 0; i < 75 && !childPid; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { childPid = parseInt(fs.readFileSync(childPidFile, 'utf8').trim(), 10); } catch { /* wait */ }
  }
  assert.ok(childPid > 0, 'child spawned');
  ac.abort();
  const r = await runP;
  assert.equal(r.cancelled, true);
  // Signal delivery and reaping are asynchronous on POSIX: assert eventual termination, not that
  // the pid has already disappeared by the time the parent's promise settles.
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try { process.kill(childPid, 0); await new Promise((res) => setTimeout(res, 100)); } catch { alive = false; }
  }
  assert.equal(alive, false, 'child process should be terminated with the tree');
});

test('changes are session-scoped', () => {
  cj.writeFile(env({ sessionId: 'ses_a', runId: 'run_a' }), 'a.txt', 'A');
  cj.writeFile(env({ sessionId: 'ses_b', runId: 'run_b' }), 'b.txt', 'B');
  const la = cj.listChanges('ses_a').map((c) => c.path);
  const lb = cj.listChanges('ses_b').map((c) => c.path);
  assert.ok(la.includes('a.txt') && !la.includes('b.txt'));
  assert.ok(lb.includes('b.txt') && !lb.includes('a.txt'));
});

test('shell-created files are reconciled into the journal and revertible', async () => {
  const before = cj.snapshotWorkspace(WS);
  const r = await runPowerShell(createFile('shell-made.txt', 'from shell'), WS, { timeoutMs: 60000, label: 'reconcile-test' });
  assert.equal(r.exitCode, 0);
  const { changes } = cj.reconcileShellChanges(env(), before, 'shell_command:test');
  const rec = changes.find((c) => c.path === 'shell-made.txt');
  assert.ok(rec, 'shell-created file must be recorded');
  assert.equal(rec.operation, 'create');
  const rev = cj.revertChange(rec.changeId, env());
  assert.equal(rev.ok, true);
  assert.equal(fs.existsSync(path.join(WS, 'shell-made.txt')), false);
});

test('journal recovers an interrupted apply on restart', async () => {
  const rec = { changeId: 'chg_recover', sessionId: 'ses_r', runId: 'run_r', tool: 'write_file', path: 'recover.txt', operation: 'create', beforeExists: false, beforeText: null, beforeHash: null, afterText: 'recovered', afterHash: null, createdAt: new Date().toISOString(), appliedAt: null, status: 'applying', workspacePath: WS };
  fs.mkdirSync(path.join(DATA, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'changes', 'chg_recover.json'), JSON.stringify(rec));
  markUnfinishedInterrupted();
  assert.equal(fs.readFileSync(path.join(WS, 'recover.txt'), 'utf8'), 'recovered');
  assert.equal(cj.getChange('chg_recover').status, 'applied');
});

test('interrupted runs are marked interrupted on restart (not replayed, not success)', () => {
  const runId = 'run_restart2';
  fs.mkdirSync(path.join(DATA, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'runs', runId + '.json'), JSON.stringify({ id: runId, sessionId: 'ses_x', workspaceId: 'w', workspacePath: WS, mode: 'code', state: 'generating', clientRequestId: 'cr2', configuredModel: 'm', effectiveModel: 'm', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  markUnfinishedInterrupted();
  const after = JSON.parse(fs.readFileSync(path.join(DATA, 'runs', runId + '.json'), 'utf8'));
  assert.equal(after.state, 'interrupted');
});

test('pinned model selection is never substituted; auto uses the loaded model', () => {
  const pinned = modelDiscovery.resolveEffectiveModel('pinned', 'my-model', ['other-model'], {});
  assert.equal(pinned.effective, 'my-model');
  assert.equal(pinned.changed, false);
  const auto = modelDiscovery.resolveEffectiveModel('auto', '', ['loaded1', 'loaded2'], {});
  assert.equal(auto.effective, 'loaded1');
  assert.equal(auto.changed, true);
});

test('event replay delivers no duplicate sequences', () => {
  const runId = 'run_replay2';
  ev.eventStore.append(runId, 's', 'x', { i: 1 });
  ev.eventStore.append(runId, 's', 'y', { i: 2 });
  ev.eventStore.append(runId, 's', 'z', { i: 3 });
  const clientSeen = new Set();
  ev.eventStore.subscribe(runId, 0, (e) => {
    if (clientSeen.has(e.sequence)) throw new Error('duplicate delivered');
    clientSeen.add(e.sequence);
  });
  assert.equal(clientSeen.size, 3);
});
