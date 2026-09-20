import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-agent-'));
process.env.EC12_DATA_DIR = path.join(root, 'data');
const cm = await import('../src/server/agent/context-manager.ts');
const loop = await import('../src/server/agent/loop.ts');
const mgr = await import('../src/server/runs/manager.ts');
const { OpenAICompatProvider } = await import('../src/server/providers/openai-compatible.ts');

const tool = (name, args, id = 'call') => ({ type: 'tool_delta', index: 0, id, name, argsDelta: JSON.stringify(args) });
const done = { type: 'done', finishReason: 'stop' };
function fake(scripts) {
  return { requests: [], async *stream(messages, opts) {
    this.requests.push({ messages: structuredClone(messages), opts });
    for (const e of scripts.shift() || []) yield e;
    yield done;
  } };
}
function deps(provider, extra = {}) {
  return { provider, signal: new AbortController().signal, contextWindow: 16000, requestedMaxTokens: 1000,
    maxIterations: 8, repeatedFailureLimit: 3, noProgressTurnLimit: 3, turnRecoveryAttempts: 1,
    contextTools: {}, journalEnv: { workspacePath: root, runId: 'lucky', sessionId: 'lucky', reviewMode: false },
    systemBlocks: ['Fixture instructions'], stagePrompt: 'Review the fixture', conversationContext: 'Original goal',
    emit: () => {}, ...extra };
}

test('compaction preserves reasoning on retained durable messages while pruning the request', () => {
  const c = cm.newConversation();
  c.originalTask = 'Goal';
  c.messages.push({ role: 'user', content: 'Goal' });
  for (let i = 0; i < 16; i++) c.messages.push(
    { role: 'assistant', content: null, reasoning_content: `reason-${i}`, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${i}`, content: 'detail '.repeat(600) });
  const p = cm.prepareConversation(c, ['sys'], [], 4000, 1000, true, 80, 4, 'none');
  assert.equal(p.compaction.compacted, true);
  assert.ok(c.messages.some(m => m.reasoning_content));
  assert.ok(p.messages.every(m => !m.reasoning_content));
});

test('review-stage writes emit pending changes for the approval UI', async () => {
  const events = [];
  const provider = fake([[tool('write_file', { path: 'stage-approval.cjs', content: 'module.exports = 13;\n' })], [tool('report_verdict', { verdict: 'PASS', summary: 'Ready for approval' })]]);
  const outcome = await loop.runStage('review', deps(provider, { journalEnv: { workspacePath: root, runId: 'stage_approval', sessionId: 'stage_approval', reviewMode: true }, emit: (type, data) => events.push({ type, data }) }));
  assert.equal(outcome.passed, true);
  assert.equal(fs.existsSync(path.join(root, 'stage-approval.cjs')), false);
  const change = events.find((event) => event.type === 'change.pending');
  assert.ok(change?.data.changeId);
  assert.equal(change.data.phase, 'stage');
  assert.equal(change.data.path, 'stage-approval.cjs');
});

function sseServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'fixture-model', max_context_length: 16000 }] }));
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { parsed = { messages: [{ content: '' }] }; }
        handler(parsed, res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
const sse = (events) => 'data: ' + events.map((e) => JSON.stringify(e)).join('\n\ndata: ') + '\n\ndata: [DONE]\n\n';
const usageEv = (p, c) => ({ choices: [], usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c } });
const toolCallEv = (id, name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] });
const contentEv = (text) => ({ choices: [{ delta: { content: text } }] });

test('manager records usage durably per request across main and stages without double counting', async () => {
  const { server, port } = await sseServer((parsed, res) => {
    const last = parsed.messages[parsed.messages.length - 1].content || '';
      const isStage = /report_verdict/.test(JSON.stringify(parsed.tools || []));
      if (isStage) res.end(sse([toolCallEv('s1', 'report_verdict', { verdict: 'PASS', summary: 'ok' }), usageEv(30, 3)]));
      else res.end(sse([usageEv(10, 1), contentEv('hello')]));
    });
  try {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-ws-'));
    fs.writeFileSync(path.join(ws, 'file.txt'), 'x');
    const settings = {
      provider: { preset: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', model: 'fixture-model', modelSelection: 'pinned', maxTokens: 512, temperature: 0, contextWindow: 16000, autoModelLimits: false, reasoningReplay: 'auto' },
      agent: { maxIterations: 4, stageMaxIterations: 4, stageRepairAttempts: 0, repeatedFailureLimit: 3 },
      autoPrompt: { enabled: true, stages: ['review'] },
      contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false },
      workspace: { id: 'ws', path: ws }, mode: 'code', theme: 'neon',
    };
    const session = mgr.getOrCreateSession({ workspaceId: 'ws', workspacePath: ws });
    const { ok, record: created } = mgr.runs.create({ clientRequestId: 'usage-1', sessionId: session.id, workspaceId: 'ws', workspacePath: ws, mode: 'code', task: 'implement the fixture feature', settings });
    assert.ok(ok);
    for (let i = 0; i < 100; i++) {
      const rec = mgr.runs.get(created.id);
      if (rec && ['succeeded', 'failed', 'blocked'].includes(rec.state)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const record = mgr.runs.get(created.id);
    assert.ok(['succeeded', 'blocked', 'unverified'].includes(record.state), 'run reached a terminal state: ' + record.state + ' ' + (record.error || ''));
    const stored = mgr.loadSession(session.id);
    assert.deepEqual(stored.usage, { promptTokens: 40, completionTokens: 4, totalTokens: 44, cachedTokens: 0 });
    assert.ok(stored.usageRequests && Object.values(stored.usageRequests).length >= 2, 'per-request usage rows persisted');
    for (const row of Object.values(stored.usageRequests)) assert.equal(row.usageStatus, 'reported');
    const stageRows = Object.values(stored.usageRequests).filter((r) => r.phase === 'stage');
    assert.ok(stageRows.length >= 1, 'stage request is scoped phase=stage');
    assert.ok(stageRows.every((r) => r.stageId === 'review' && r.stageAttempt >= 1), 'stage rows carry stageId/stageAttempt');
    const mainRows = Object.values(stored.usageRequests).filter((r) => r.phase === 'main');
    assert.ok(mainRows.length >= 1 && mainRows.every((r) => r.stageId === null), 'main rows scoped stageId=null');
  } finally { server.close(); }
});

test('recordRequestUsage counts a re-reported request once (no double count)', () => {
  const s = mgr.getOrCreateSession({ workspaceId: 'u', workspacePath: root });
  const price = { model: 'm', inPrice: 0, outPrice: 0, currency: '$' };
  mgr.recordRequestUsage(s, { requestId: 'r1', runId: 'run1', phase: 'main', stageId: null, stageAttempt: 0, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, price, ts: '' });
  mgr.recordRequestUsage(s, { requestId: 'r1', runId: 'run1', phase: 'main', stageId: null, stageAttempt: 0, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, price, ts: '', finished: true, completed: true });
  mgr.recordRequestUsage(s, { requestId: 'r2', runId: 'run1', phase: 'stage', stageId: 'review', stageAttempt: 2, usage: { promptTokens: 30, completionTokens: 3, totalTokens: 33 }, price, ts: '' });
  mgr.recordRequestUsage(s, { requestId: 'r3', runId: 'run1', phase: 'main', stageId: null, stageAttempt: 0, price, ts: '', finished: true, cancelled: true });
  assert.deepEqual(s.usage, { promptTokens: 40, completionTokens: 8, totalTokens: 48, cachedTokens: 0 });
  const rows = Object.values(s.usageRequests);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.requestId === 'r1').usageStatus, 'reported');
  assert.equal(rows.find((r) => r.requestId === 'r3').usageStatus, 'unknown');
  assert.equal(rows.find((r) => r.requestId === 'r3').cancelled, true);
  assert.equal(s.usageEvents.find((e) => e.requestId === 'r1').usage.totalTokens, 15);
});

test('main-loop usage is never double counted when a request is retried', async () => {
  const c = cm.newConversation();
  const { OpenAICompatProvider } = await import('../src/server/providers/openai-compatible.ts');
  void OpenAICompatProvider;
  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
  let reported = 0;
  const emitCapture = [];
  const emit = (type, data) => emitCapture.push({ type, data });
  const provider = fake([[{ type: 'usage', usage }, { type: 'content', text: 'retryable ' }, { type: 'error', message: 'fetch failed' }], [{ type: 'usage', usage }, { type: 'content', text: 'all done' }]]);
  const outcome = await loop.runMainLoop({ ...deps(provider, { emit, maxIterations: 3, turnRecoveryAttempts: 2 }), mode: 'ask', task: 'hi', conversation: c });
  assert.equal(outcome.error, undefined);
  assert.equal(reported, 0);
  const usageEvents = emitCapture.filter((e) => e.type === 'usage');
  assert.ok(usageEvents.length >= 2);
  const perRequest = new Map();
  for (const e of emitCapture.filter((e) => e.type === 'usage')) {
    const id = e.data.requestId;
    assert.ok(id, 'usage events carry a requestId');
    assert.equal(perRequest.has(id), false, 'one usage row per requestId (no double count on retry)');
    perRequest.set(id, true);
  }
});
