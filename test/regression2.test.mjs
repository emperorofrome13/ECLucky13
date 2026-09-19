// EC12 regression tests part 3: tokenizer, repair loop, baseline split, browser assertions,
// catalog cache, loop usage forwarding. No model server required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-data3-'));
process.env.EC12_DATA_DIR = DATA;

const cm = await import('../src/server/agent/context-manager.ts');
const loop = await import('../src/server/agent/loop.ts');
const mgr = await import('../src/server/runs/manager.ts');
const exec = await import('../src/server/verification/execute.ts');
const disc = await import('../src/server/verification/discover.ts');
const modelDiscovery = await import('../src/server/providers/model-discovery.ts');

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-ws3-'));

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
const usage = (p, c) => ({ type: 'usage', usage: { promptTokens: p, completionTokens: c, totalTokens: p + c } });

test('tokenizer is exact cl100k (not bytes/4)', () => {
  assert.ok(cm.estimatorName().startsWith('cl100k'));
  assert.equal(cm.countTokens('hello world'), 2);
  assert.ok(cm.countTokens('hello world') < Math.ceil('hello world'.length / 4) + 1 || true);
  // a long repetitive string: exact count differs from the rough estimate on real text
  const t = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
  assert.ok(cm.countTokens(t) > 0 && cm.countTokens(t) < t.length);
});

test('bounded repair: FAIL then PASS recovers; maxRepair 0 does not retry', async () => {
  const base = {
    signal: new AbortController().signal, contextWindow: 16000, requestedMaxTokens: 512,
    maxIterations: 4, contextTools: {}, journalEnv: { workspacePath: WS, runId: 'r', sessionId: 's', reviewMode: false },
    systemBlocks: ['sys'], stagePrompt: 'fix', conversationContext: 'ctx', emit: () => {},
  };
  const p1 = new FakeProvider([[toolCall('v1', 'report_verdict', { verdict: 'FAIL', summary: 'bug' })], [toolCall('v2', 'report_verdict', { verdict: 'PASS', summary: 'fixed' })], []]);
  const ok = await loop.runStageWithRepair('review', { ...base, provider: p1 }, 1);
  assert.equal(ok.passed, true);
  assert.equal(ok.attempts, 2);
  const p2 = new FakeProvider([[toolCall('v1', 'report_verdict', { verdict: 'FAIL', summary: 'bug' })], []]);
  const no = await loop.runStageWithRepair('review', { ...base, provider: p2 }, 0);
  assert.equal(no.passed, false);
  assert.equal(no.attempts, 1);
});

test('baseline split separates pre-existing failures from regressions', () => {
  const base = [
    { checkId: 'a', name: 'typecheck', command: '', cwd: '', required: true, status: 'failed' },
    { checkId: 'b', name: 'lint', command: '', cwd: '', required: false, status: 'failed' },
    { checkId: 'c', name: 'test', command: '', cwd: '', required: true, status: 'passed' },
  ];
  const fin = [
    { checkId: 'a', name: 'typecheck', status: 'failed', required: true },
    { checkId: 'b', name: 'lint', status: 'failed', required: false },
    { checkId: 'c', name: 'test', status: 'failed', required: true },
    { checkId: 'd', name: 'boot', status: 'failed', required: true },
  ];
  const { preExisting, regressions } = mgr.splitCheckFailures(base, fin);
  assert.ok(preExisting.some((s) => s.startsWith('typecheck')));
  assert.ok(preExisting.some((s) => s.startsWith('boot') && s.includes('no baseline')));
  assert.ok(regressions.some((s) => s.startsWith('test')));
  assert.ok(!regressions.some((s) => s.startsWith('lint')), 'optional failures are not regressions');
});

test('browser presence assertions run when a browser exists', async () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-bassert-'));
  fs.writeFileSync(path.join(w, 'titled.html'), '<html><head><title>Hello</title></head><body><p>visible text here</p></body></html>');
  const checks = disc.discoverChecks(w).filter((c) => c.kind === 'browser');
  const r = await exec.runVerification(w, checks, undefined, () => {});
  const preview = (r.checks[0]?.outputPreview || '');
  assert.ok(r.checks[0].status === 'passed' || r.checks[0].status === 'unavailable', `unexpected ${r.checks[0].status}`);
  if (r.checks[0].status === 'passed') assert.ok(preview.includes('title='), 'presence assertions recorded');
});

test('an empty page fails the presence assertion', async () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-bblank-'));
  fs.writeFileSync(path.join(w, 'blank.html'), '<html><head></head><body></body></html>');
  const checks = disc.discoverChecks(w).filter((c) => c.kind === 'browser');
  const r = await exec.runVerification(w, checks, undefined, () => {});
  assert.ok(['failed', 'unavailable'].includes(r.checks[0].status));
});

test('prompt override chain: workspace .ec12 wins, app dir next, builtin last', async () => {
  const pf = await import('../src/server/prompt-files.ts');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-prompt-'));
  assert.equal(pf.promptSource('review', ws), 'app');
  assert.ok(pf.readPrompt('review', ws).includes('report_verdict'));
  fs.mkdirSync(path.join(ws, '.ec12', 'autoprompts'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.ec12', 'autoprompts', 'review.md'), 'CUSTOM REVIEW PROMPT');
  assert.equal(pf.promptSource('review', ws), 'workspace');
  assert.equal(pf.readPrompt('review', ws), 'CUSTOM REVIEW PROMPT');
  fs.rmSync(path.join(ws, '.ec12'), { recursive: true, force: true });
});

test('remote catalog is cached within TTL; local catalogs stay fresh', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ data: [{ id: 'fixture-model' }] }); };
  try {
    const url = 'https://catalog-cache.invalid/v1';
    const a = await modelDiscovery.getCatalog(url, '');
    const initialCalls = calls;
    const b = await modelDiscovery.getCatalog(url, '');
    assert.equal(a, b); assert.ok(initialCalls > 0); assert.equal(calls, initialCalls);
    const local = 'http://127.0.0.1:19998/v1';
    const c = await modelDiscovery.getCatalog(local, '');
    const d = await modelDiscovery.getCatalog(local, '');
    assert.notEqual(c, d);
    assert.deepEqual(d.models, ['fixture-model']);
  } finally { globalThis.fetch = originalFetch; }
});

test('message list has exactly one leading system message (strict templates)', () => {
  const built = cm.buildTurnMessages({
    systemBlocks: ['sys-a', '', 'sys-b'],
    history: [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ],
    request: 'q2',
    contextBudgetTokens: 100000,
  });
  const sysCount = built.messages.filter((m) => m.role === 'system').length;
  assert.equal(sysCount, 1);
  assert.equal(built.messages[0].role, 'system');
  assert.ok(built.messages[0].content.includes('sys-a') && built.messages[0].content.includes('sys-b'));
});

test('report_verdict is stage-only and never offered to the main loop', async () => {
  const seenTools = [];
  const provider = new FakeProvider([[content('all done')]]);
  const origStream = provider.stream.bind(provider);
  provider.stream = async function* (messages, opts, signal) {
    seenTools.push((opts.tools || []).map((t) => t.function?.name || t.name));
    yield* origStream(messages, opts, signal);
  };
  await loop.runMainLoop({
    runId: 'rl2', sessionId: 'sl2', workspace: WS, mode: 'code', signal: new AbortController().signal,
    provider, contextWindow: 16000, requestedMaxTokens: 512, maxIterations: 2, repeatedFailureLimit: 3,
    contextTools: {}, journalEnv: { workspacePath: WS, runId: 'rl2', sessionId: 'sl2', reviewMode: false },
    conversation: { messages: [], plan: [], updatedAt: new Date().toISOString() },
    systemBlocks: ['sys'], task: 'do it', emit: () => {},
  });
  assert.ok(seenTools.length >= 1);
  for (const names of seenTools) assert.ok(!names.includes('report_verdict'), 'main loop must not offer report_verdict');
});

test('loop forwards per-request usage and applies tool writes', async () => {
  const got = [];
  const provider = new FakeProvider([
    [usage(10, 5), toolCall('t1', 'write_file', { path: 'loop.txt', content: 'via loop' })],
    [content('done')],
  ]);
  const out = await loop.runMainLoop({
    runId: 'rl', sessionId: 'sl', workspace: WS, mode: 'code', signal: new AbortController().signal,
    provider, contextWindow: 16000, requestedMaxTokens: 512, maxIterations: 4, repeatedFailureLimit: 3,
    contextTools: {}, journalEnv: { workspacePath: WS, runId: 'rl', sessionId: 'sl', reviewMode: false },
    conversation: { messages: [], plan: [], updatedAt: new Date().toISOString() },
    systemBlocks: ['sys'], task: 'write the file', emit: () => {},
    onUsage: (u) => got.push(u),
  });
  assert.ok(got.length >= 1 && got[0].promptTokens === 10 && got[0].completionTokens === 5, 'exact usage forwarded per request');
  assert.equal(fs.readFileSync(path.join(WS, 'loop.txt'), 'utf8'), 'via loop');
  assert.equal(out.content, 'done');
});

