import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('test-output', { recursive: true });
const root = fs.mkdtempSync(path.resolve('test-output/lucky-perf-'));
process.env.EC12_DATA_DIR = path.join(root, 'data');

const events = await import('../src/server/events.ts');
const payloads = await import('../src/server/request-payloads.ts');

const env = (seq, type, data, eventId = 'e' + seq) => ({
  version: 1, eventId, sequence: seq, timestamp: '2026-09-19T00:00:00.000Z',
  sessionId: 'ses_perf', runId: 'run_perf', type, data,
});

test('coalesceDeltas merges consecutive same-stream text exactly', () => {
  const input = [
    env(1, 'assistant.delta', { text: 'a', phase: 'main', requestId: 'r1' }),
    env(2, 'assistant.delta', { text: 'b', phase: 'main', requestId: 'r1' }),
    env(3, 'tool.started', { name: 'x' }),
    env(4, 'assistant.delta', { text: 'c', phase: 'main', requestId: 'r2' }),
    env(5, 'reasoning.delta', { text: 'd', phase: 'main', requestId: 'r2' }),
    env(6, 'reasoning.delta', { text: 'e', phase: 'main', requestId: 'r2' }),
  ];
  const before = JSON.stringify(input);
  const out = events.coalesceDeltas(input);
  assert.equal(out.length, 4);
  assert.equal(out[0].type, 'assistant.delta');
  assert.equal(out[0].data.text, 'ab');
  assert.equal(out[0].eventId, 'e1');
  assert.equal(out[0].sequence, 2);
  assert.equal(out[3].data.text, 'de');
  // Input (shared memory-window objects) must not be mutated.
  assert.equal(JSON.stringify(input), before);
});

test('coalesceDeltas does not merge across streams or scopes', () => {
  const out = events.coalesceDeltas([
    env(1, 'assistant.delta', { text: 'a', phase: 'main', requestId: 'r1' }),
    env(2, 'assistant.delta', { text: 'b', phase: 'stage', stageId: 'review', stageAttempt: 1, requestId: 'r1' }),
    env(3, 'assistant.delta', { text: 'c', phase: 'main', requestId: 'r1' }),
  ]);
  assert.equal(out.length, 3);
});

test('stripRequestPayload summarizes old full payloads, passes slim ones through', () => {
  const full = env(1, 'request.started', { messages: [{ role: 'user' }, { role: 'assistant' }], tools: [{}, {}, {}], maxTokens: 1000, requestId: 'r1' });
  const stripped = events.stripRequestPayload(full);
  assert.equal(stripped.data.messageCount, 2);
  assert.equal(stripped.data.toolCount, 3);
  assert.ok(stripped.data.payloadBytes > 0);
  assert.equal(stripped.data.stripped, true);
  assert.ok(!('messages' in stripped.data));
  assert.equal(stripped.data.requestId, 'r1');
  const slim = env(2, 'request.started', { messageCount: 5, toolCount: 7, payloadBytes: 123, payloadKey: 'req_x', requestId: 'r2' });
  assert.deepEqual(events.stripRequestPayload(slim).data, slim.data);
  const other = env(3, 'tool.finished', { ok: true });
  assert.deepEqual(events.stripRequestPayload(other).data, other.data);
});

test('compact replay collapses thousands of deltas with text intact', () => {
  const { eventStore } = events;
  const runId = 'run_compact_' + Date.now().toString(36);
  const scope = { phase: 'main', stageId: null, stageAttempt: 0, requestId: 'req_c1' };
  for (let i = 0; i < 1200; i++) eventStore.append(runId, 'ses_perf', 'assistant.delta', { ...scope, text: 'x' + (i % 10) });
  for (let i = 0; i < 1200; i++) eventStore.append(runId, 'ses_perf', 'reasoning.delta', { ...scope, text: 'y' + (i % 10) });
  eventStore.append(runId, 'ses_perf', 'request.started', { ...scope, messages: [{ role: 'user' }], tools: [{}, {}], maxTokens: 50 });
  eventStore.append(runId, 'ses_perf', 'request.finished', { ...scope, usageStatus: 'reported', completed: true, cancelled: false });
  const full = eventStore.replay(runId, 0, false);
  assert.equal(full.length, 2402);
  const compact = eventStore.replay(runId, 0, true);
  assert.ok(compact.length <= 6, `compact replay has ${compact.length} events`);
  const assistant = compact.find((e) => e.type === 'assistant.delta');
  assert.ok(assistant.data.text.length === 2400, 'assistant text truncated');
  assert.ok(assistant.data.text.startsWith('x0x1'));
  const started = compact.find((e) => e.type === 'request.started');
  assert.equal(started.data.messageCount, 1);
  assert.equal(started.data.toolCount, 2);
  assert.equal(started.data.stripped, true);
});

test('request payload sidecar round-trips, log fallback resolves old runs', () => {
  const saved = payloads.saveRequestPayload('req_unit_1', { messages: [{ role: 'user', content: 'hi' }], maxTokens: 9 });
  assert.match(saved.key, /^req_/);
  assert.ok(saved.bytes > 0);
  assert.deepEqual(payloads.readRequestPayload(saved.key), { messages: [{ role: 'user', content: 'hi' }], maxTokens: 9 });
  assert.equal(payloads.readRequestPayload('req_missing'), undefined);
  assert.equal(payloads.readRequestPayload('../evil'), undefined);
  const runId = 'run_payload_' + Date.now().toString(36);
  const logFile = path.join(process.env.EC12_DATA_DIR, 'runs', runId + '.events.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const line = (e) => JSON.stringify(e) + '\n';
  fs.writeFileSync(logFile,
    line(env(1, 'request.started', { messages: [{ role: 'user', content: 'old' }], requestId: 'req_old_9' })) +
    line({ ...env(2, 'request.started', { messageCount: 1, payloadKey: saved.key, requestId: 'req_new_9' }), runId }));
  const first = JSON.parse(fs.readFileSync(logFile, 'utf8').split('\n')[0]);
  first.runId = runId;
  fs.writeFileSync(logFile, line(first) + line({ ...env(2, 'request.started', { messageCount: 1, payloadKey: saved.key, requestId: 'req_new_9' }), runId }));
  assert.deepEqual(payloads.findRequestPayload(runId, 'e1'), { messages: [{ role: 'user', content: 'old' }], requestId: 'req_old_9' });
  assert.deepEqual(payloads.findRequestPayload(runId, 'req_old_9'), { messages: [{ role: 'user', content: 'old' }], requestId: 'req_old_9' });
  assert.deepEqual(payloads.findRequestPayload(runId, 'e2'), { messages: [{ role: 'user', content: 'hi' }], maxTokens: 9 });
  assert.equal(payloads.findRequestPayload(runId, 'nope'), undefined);
  assert.equal(payloads.findRequestPayload('../evil', 'e1'), undefined);
  assert.equal(payloads.findRequestPayload(runId, 'run_payload_other'), undefined);
});
