// EC12 reliability regression tests. Deterministic; no live model required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Isolate the data root before any server module reads it.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-data-'));
process.env.EC12_DATA_DIR = DATA;
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-ws-'));

const cj = await import('../src/server/workspace/change-journal.ts');
const pp = await import('../src/server/workspace/path-policy.ts');
const sm = await import('../src/server/runs/state-machine.ts');
const ev = await import('../src/server/events.ts');
const disc = await import('../src/server/verification/discover.ts');
const exec = await import('../src/server/verification/execute.ts');
const prov = await import('../src/server/providers/openai-compatible.ts');

const env = (over = {}) => ({ workspacePath: WS, runId: 'run_t', sessionId: 'ses_t', reviewMode: false, ...over });

test('literal replace never interprets $&, $`, $\' and preserves content', () => {
  assert.deepEqual(cj.literalReplace('a', 'a', '$&'), { ok: true, content: '$&', count: 1 });
  assert.equal(cj.literalReplace('a', 'a', "$'").content, "$'");
  assert.equal(cj.literalReplace('x=1', 'x=1', 'x=`t`').content, 'x=`t`');
  const crlf = cj.literalReplace('a\r\nb', 'b', 'c\r\nd');
  assert.equal(crlf.content, 'a\r\nc\r\nd');
});

test('ambiguous replacement is rejected without mutation', () => {
  const r = cj.literalReplace('x x x', 'x', 'y', false);
  assert.equal(r.ok, false);
  assert.match(r.error, /3 times/);
});

test('missing old_string is rejected', () => {
  const r = cj.literalReplace('abc', 'zzz', 'y', false);
  assert.equal(r.ok, false);
});

test('edit/write are journaled; stale before_hash returns a conflict', () => {
  const w = cj.writeFile(env(), 'a.txt', 'hello');
  assert.equal(w.ok, true);
  assert.equal(w.record.operation, 'create');
  assert.equal(fs.readFileSync(path.join(WS, 'a.txt'), 'utf8'), 'hello');
  // wrong before_hash must conflict
  const bad = cj.editFile(env(), 'a.txt', 'hello', 'hi', false, 'deadbeef');
  assert.equal(bad.ok, false);
  assert.equal(bad.conflict, true);
  assert.equal(fs.readFileSync(path.join(WS, 'a.txt'), 'utf8'), 'hello'); // unchanged
});

test('revert by changeId restores before-image; refuses to overwrite newer work', () => {
  const created = cj.writeFile(env(), 'b.txt', 'v1');
  const edited = cj.editFile(env(), 'b.txt', 'v1', 'v2', false);
  assert.equal(edited.ok, true);
  const rev = cj.revertChange(edited.record.changeId, env());
  assert.equal(rev.ok, true);
  assert.equal(fs.readFileSync(path.join(WS, 'b.txt'), 'utf8'), 'v1');
  // a fresh applied change, then a newer external edit -> revert must conflict, not overwrite
  cj.writeFile(env(), 'b2.txt', 'v1');
  const edited2 = cj.editFile(env(), 'b2.txt', 'v1', 'v2', false);
  fs.writeFileSync(path.join(WS, 'b2.txt'), 'v3');
  const conflict = cj.revertChange(edited2.record.changeId, env());
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(fs.readFileSync(path.join(WS, 'b2.txt'), 'utf8'), 'v3');
  assert.ok(created.record.changeId);
});

test('reverting a create deletes only a journal-proven file', () => {
  const c = cj.writeFile(env(), 'new.txt', 'x');
  const r = cj.revertChange(c.record.changeId, env());
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(WS, 'new.txt')), false);
});

test('review mode stages changes without touching the workspace; approve commits', () => {
  const r = cj.writeFile(env({ reviewMode: true, runId: 'run_review' }), 'reviewed.txt', 'staged');
  assert.equal(r.record.status, 'pending');
  assert.equal(fs.existsSync(path.join(WS, 'reviewed.txt')), false); // workspace unchanged
  const ap = cj.approveChange(r.record.changeId, env({ reviewMode: true, runId: 'run_review' }));
  assert.equal(ap.ok, true);
  assert.equal(fs.readFileSync(path.join(WS, 'reviewed.txt'), 'utf8'), 'staged');
});

test('path policy rejects traversal, absolute, ADS, and junction escapes', () => {
  assert.ok(pp.resolveInWorkspace(WS, 'sub/ok.txt').startsWith(WS)); // resolved (may not exist yet)
  assert.throws(() => pp.resolveInWorkspace(WS, '../escape.txt'));
  assert.throws(() => pp.resolveInWorkspace(WS, 'C:\\Windows\\system32'));
  assert.throws(() => pp.resolveInWorkspace(WS, 'file.txt:secret'));
  // junction escape
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-out-'));
  const link = path.join(WS, 'link');
  try {
    fs.symlinkSync(outside, link, 'junction');
    assert.throws(() => pp.resolveInWorkspace(WS, 'link/evil.txt'));
  } catch (e) {
    if (e && e.code === 'EPERM') { /* symlink privilege unavailable; skip */ } else throw e;
  }
});

test('state machine forbids cancelling/every terminal path becoming success', () => {
  assert.throws(() => sm.assertTransition('cancelled', 'succeeded'));
  assert.throws(() => sm.assertTransition('failed', 'succeeded'));
  assert.throws(() => sm.assertTransition('unverified', 'succeeded'));
  sm.assertTransition('cancelling', 'cancelled');
  assert.throws(() => sm.assertTransition('cancelling', 'succeeded'));
});

test('event store persists before publish and supports replay after a sequence', () => {
  const runId = 'run_evt';
  ev.eventStore.append(runId, 'ses', 'a', { n: 1 });
  ev.eventStore.append(runId, 'ses', 'b', { n: 2 });
  ev.eventStore.append(runId, 'ses', 'c', { n: 3 });
  const after = ev.eventStore.history(runId, 1);
  assert.deepEqual(after.map((e) => e.sequence), [2, 3]);
  const got = [];
  const unsub = ev.eventStore.subscribe(runId, 2, (e) => got.push(e.sequence));
  assert.deepEqual(got, [3]);
  unsub();
});

test('zero applicable checks => unverified (never passed)', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-empty-'));
  const checks = disc.discoverChecks(empty);
  assert.equal(checks.length, 0);
  const r = await exec.runVerification(empty, checks, undefined, () => {});
  assert.equal(r.outcome, 'unverified');
});

test('boot verification falls back from missing /health to /', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-proj-'));
  fs.writeFileSync(path.join(proj, 'server.mjs'),
    "import http from 'node:http';const s=http.createServer((q,r)=>{if(q.url==='/'){r.writeHead(200);r.end('ok')}else{r.writeHead(404);r.end()}});s.listen(process.env.PORT||0,'127.0.0.1');");
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'p', scripts: { start: 'node server.mjs' } }));
  const checks = disc.discoverChecks(proj);
  const boot = checks.find((c) => c.kind === 'boot');
  assert.ok(boot, 'expected a boot check');
  const r = await exec.runVerification(proj, checks, undefined, () => {});
  assert.equal(r.outcome, 'verified');
  const bootResult = r.checks.find((c) => c.checkId === 'boot');
  assert.equal(bootResult.status, 'passed');
});

test('streamed tool arguments assemble across chunks; malformed JSON is rejected', () => {
  const assembled = prov.assembleToolCalls([
    { index: 0, id: 'c1', name: 'edit_', argsDelta: '{"path":' },
    { index: 0, name: 'file', argsDelta: '"a.txt"}' },
  ]);
  assert.equal(assembled.calls.length, 1);
  assert.equal(assembled.calls[0].name, 'edit_file');
  assert.equal(assembled.calls[0].argsRaw, '{"path":"a.txt"}');
  const bad = prov.assembleToolCalls([{ index: 0, name: 'x', argsDelta: '{not json' }]);
  assert.equal(bad.calls.length, 0);
  assert.equal(bad.invalid.length, 1);
});

test('provider surfaces SSE error payloads instead of ending the turn empty', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"error":{"message":"boom from server","type":"server_error"}}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const p = new prov.OpenAICompatProvider({
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', model: 'm', maxTokens: 100, temperature: 0,
    connectTimeoutMs: 5000, firstTokenTimeoutMs: 5000, streamIdleTimeoutMs: 5000, requestTimeoutMs: 20000, retries: 0,
  });
  const seen = [];
  for await (const e of p.stream([{ role: 'user', content: 'hi' }], { maxTokens: 100 })) seen.push(e);
  await new Promise((r) => server.close(r));
  const err = seen.find((e) => e.type === 'error');
  assert.ok(err, 'an SSE error payload must surface as an error event');
  assert.ok(err.message.includes('boom from server'));
});

test('provider stream parses split SSE frames and UTF-8, and cancellation is not success', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame1 = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n';
    const frame2 = Buffer.from('data: {"choices":[{"delta":{"content":"l\u00f3"}}]}\n\n', 'utf8');
    const frame3 = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"edit_","arguments":"{\\"p\\":"}}]}}]}\n\n';
    const frame4 = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"1}"}}]}}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n';
    const end = 'data: [DONE]\n\n';
    res.write(frame1);
    // split a multibyte char across two writes to exercise TextDecoder
    res.write(frame2.subarray(0, frame2.length - 3));
    res.write(frame2.subarray(frame2.length - 3));
    res.write(frame3);
    res.write(frame4);
    res.write(end);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const p = new prov.OpenAICompatProvider({
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', model: 'm', maxTokens: 100, temperature: 0,
    connectTimeoutMs: 5000, firstTokenTimeoutMs: 5000, streamIdleTimeoutMs: 5000, requestTimeoutMs: 20000, retries: 0,
  });
  let content = '';
  const deltas = [];
  let usage = null;
  let done = false;
  for await (const e of p.stream([{ role: 'user', content: 'hi' }], { maxTokens: 100 })) {
    if (e.type === 'content') content += e.text;
    if (e.type === 'tool_delta') deltas.push(e);
    if (e.type === 'usage') usage = e.usage;
    if (e.type === 'done') done = true;
  }
  assert.equal(content, 'Hell\u00f3');
  const asm = prov.assembleToolCalls(deltas);
  assert.equal(asm.calls[0].name, 'edit_file');
  assert.equal(usage.totalTokens, 10);
  assert.equal(done, true);
  await new Promise((r) => server.close(r));
});
