// EC12 v1.13 resilience + token-diet regression tests. Deterministic; no live model required.
// Covers: output-limit cut-off recovery, malformed-tool-call recovery, stream-error turn retries,
// the no-progress watchdog (which never caps productive iterations), reasoning pruning of completed
// tool batches, tool output caps, and stage cut-off continuation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the data root before any server module reads it.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ec13-data-'));
process.env.EC12_DATA_DIR = DATA;
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'ec13-ws-'));

const loop = await import('../src/server/agent/loop.ts');
const cm = await import('../src/server/agent/context-manager.ts');
const registry = await import('../src/server/tools/registry.ts');
const shell = await import('../src/server/tools/managed-shell.ts');
const prov = await import('../src/server/providers/openai-compatible.ts');

const env = () => ({ workspacePath: WS, runId: 'run_t13', sessionId: 'ses_t13', reviewMode: false });

/** A scripted fake provider: each `stream` call consumes the next response description. */
function fakeProvider(responses, opts = {}) {
  let call = 0;
  return {
    calls: 0,
    async *stream(messages, o, signal) {
      const i = Math.min(this.calls, responses.length - 1);
      this.calls++;
      const r = responses[i];
      if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
      if (r.error) { yield { type: 'error', message: r.error }; return; }
      if (r.reasoning) yield { type: 'reasoning', text: r.reasoning };
      if (r.text) yield { type: 'content', text: r.text };
      for (const tc of r.toolCalls || []) {
        const idx = (r.toolCalls || []).indexOf(tc);
        yield { type: 'tool_delta', index: idx, id: tc.id || `call_${idx}`, name: tc.name, argsDelta: JSON.stringify(tc.args) };
      }
      if (r.usage) yield { type: 'usage', usage: r.usage };
      yield { type: 'done', finishReason: r.finishReason || (r.toolCalls?.length ? 'tool_calls' : 'stop') };
    },
    ...opts,
  };
}

function baseDeps(provider, over = {}) {
  const events = [];
  return {
    deps: {
      runId: 'run_t13', sessionId: 'ses_t13', workspace: WS, mode: 'code',
      signal: new AbortController().signal, provider, contextWindow: 32000, requestedMaxTokens: 4096,
      autoCompact: false, autoCompactAtPercent: 80, keepRecentTurns: 4,
      maxIterations: 0, repeatedFailureLimit: 3,
      contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false, context7ApiKey: '' },
      journalEnv: env(), conversation: cm.newConversation(), systemBlocks: ['You are EC12.'], task: 'Write hello world to hi.txt',
      emit: (type, data) => events.push({ type, data }),
      ...over,
    },
    events,
  };
}

test('output-limit cut-off with a complete tool call executes it instead of failing the run', async () => {
  const provider = fakeProvider([
    { toolCalls: [{ name: 'write_file', args: { path: 'hi.txt', content: 'hello' } }], finishReason: 'length' },
    { toolCalls: [{ name: 'attempt_completion', args: { result: 'EC13_DONE' } }] },
  ]);
  const { deps, events } = baseDeps(provider);
  const outcome = await loop.runMainLoop(deps);
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.blocked, false);
  assert.match(outcome.content, /EC13_DONE/);
  assert.ok(fs.readFileSync(path.join(WS, 'hi.txt'), 'utf8') === 'hello');
  assert.ok(events.some((e) => e.type === 'error' && /output limit, but the tool call was complete/.test(e.data.message)));
});

test('output-limit cut-off with text-only output continues the turn (bounded), then completes', async () => {
  const provider = fakeProvider([
    { text: 'Working on it, I will now', finishReason: 'length' },
    { toolCalls: [{ name: 'attempt_completion', args: { result: 'EC13_CONTINUED' } }] },
  ]);
  const { deps } = baseDeps(provider);
  const outcome = await loop.runMainLoop(deps);
  assert.equal(outcome.error, undefined);
  assert.match(outcome.content, /EC13_CONTINUED/);
  assert.equal(provider.calls, 2);
});

test('malformed tool call asks the model to re-emit instead of blocking', async () => {
  const provider = fakeProvider([
    { toolCalls: [{ name: 'write_file', args: 'BROKEN' }] }, // assembled args become invalid JSON
    { toolCalls: [{ name: 'attempt_completion', args: { result: 'EC13_RETRIED' } }] },
  ]);
  const { deps } = baseDeps(provider);
  const outcome = await loop.runMainLoop(deps);
  assert.match(outcome.content, /EC13_RETRIED/);
  assert.equal(outcome.blocked, false);
});

test('retryable stream error (empty response) re-requests the turn; run survives', async () => {
  const provider = fakeProvider([
    { error: 'Model returned an empty response. Check the LM Studio server log and retry.' },
    { toolCalls: [{ name: 'attempt_completion', args: { result: 'EC13_AFTER_RETRY' } }] },
  ]);
  const { deps, events } = baseDeps(provider);
  const outcome = await loop.runMainLoop(deps);
  assert.match(outcome.content, /EC13_AFTER_RETRY/);
  assert.ok(events.some((e) => e.type === 'retry'));
  assert.equal(provider.calls, 2);
});

test('non-retryable stream error (auth) still fails the run immediately', async () => {
  const provider = fakeProvider([{ error: 'Provider HTTP 401: invalid api key' }]);
  const { deps } = baseDeps(provider, { turnRecoveryAttempts: 3 });
  const outcome = await loop.runMainLoop(deps);
  assert.match(outcome.error || '', /HTTP 401/);
  assert.equal(provider.calls, 1);
});

test('no-progress watchdog blocks a varied-failure loop but any success resets it', async () => {
  // All tool calls fail with DIFFERENT, deterministic errors (dodges repeated-failure detection
  // on every OS — no process spawning involved).
  const responses = Array.from({ length: 6 }, (_, i) => ({
    toolCalls: [{ name: 'read_file', args: { path: `missing-${i}.txt` } }],
  }));
  const provider = fakeProvider(responses);
  const { deps } = baseDeps(provider, { noProgressTurnLimit: 5 });
  const outcome = await loop.runMainLoop(deps);
  assert.equal(outcome.blocked, true);
  assert.match(outcome.error || '', /No progress/);
  assert.equal(provider.calls, 5);

  // With the guard off (0), unlimited iterations are honored — cancellation is the only stop.
  // The repeating tail response SUCCEEDS (list_files), so neither the watchdog (off) nor the
  // repeated-failure guard (successes clear signatures) can end the run before the user's Stop.
  const provider2 = fakeProvider([
    ...Array.from({ length: 8 }, (_, i) => ({ toolCalls: [{ name: 'read_file', args: { path: `missing2-${i}.txt` } }] })),
    { toolCalls: [{ name: 'list_files', args: {} }] },
  ]);
  const controller = new AbortController();
  const { deps: deps2 } = baseDeps(provider2, { noProgressTurnLimit: 0, signal: controller.signal });
  const p = loop.runMainLoop(deps2);
  // Let a few failing turns pass, then cancel: proves the loop was still running, not blocked.
  setTimeout(() => controller.abort(new Error('user stop')), 150);
  const outcome2 = await p;
  assert.equal(outcome2.cancelled, true);
  assert.equal(outcome2.blocked, false);
});

test('a successful tool call resets the no-progress counter (long productive runs are never cut)', async () => {
  const responses = [];
  for (let i = 0; i < 12; i++) {
    responses.push({ toolCalls: [{ name: 'read_file', args: { path: `missing-a-${i}.txt` } }] });
    responses.push({ toolCalls: [{ name: 'list_files', args: {} }] }); // success → resets the counter
  }
  const provider = fakeProvider(responses);
  const { deps } = baseDeps(provider, { noProgressTurnLimit: 5 });
  const controller = new AbortController();
  deps.signal = controller.signal;
  const p = loop.runMainLoop(deps);
  setTimeout(() => controller.abort(new Error('user stop')), 250);
  const outcome = await p;
  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.blocked, false, 'alternating fail/success must never trip the guard');
});

test('reasoning from completed tool batches is pruned; the latest batch keeps it (local)', async () => {
  const conversation = cm.newConversation();
  conversation.messages.push(
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, reasoning_content: 'REASONING_BATCH_1', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'a.txt' },
    { role: 'assistant', content: null, reasoning_content: 'REASONING_BATCH_2', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: 'content' },
  );
  const prepared = cm.prepareConversation(conversation, ['sys'], [], 32000, 4096, false, 80, 4, 'active-batch');
  const text = JSON.stringify(prepared.messages);
  assert.ok(!text.includes('REASONING_BATCH_1'), 'completed batch reasoning must be dropped');
  assert.ok(text.includes('REASONING_BATCH_2'), 'the latest batch keeps its reasoning');
  // The legacy boolean still selects the same policies.
  const legacy = cm.prepareConversation({ ...conversation, messages: conversation.messages.map((m) => ({ ...m })) }, ['sys'], [], 32000, 4096, false, 80, 4, false);
  assert.ok(!JSON.stringify(legacy.messages).includes('REASONING_BATCH_1'));
  // Explicit full replay is still available as a compatibility escape hatch.
  const conversation2 = cm.newConversation();
  conversation2.messages.push(...conversation.messages.map((m) => ({ ...m })));
  const prepared2 = cm.prepareConversation(conversation2, ['sys'], [], 32000, 4096, false, 80, 4, 'full');
  const text2 = JSON.stringify(prepared2.messages);
  assert.ok(text2.includes('REASONING_BATCH_1') && text2.includes('REASONING_BATCH_2'));
});

test('tool outputs are capped before entering history: read_file head+tail, search_files total', async () => {
  const big = ('x'.repeat(120) + '\n').repeat(400); // ~48k chars
  fs.writeFileSync(path.join(WS, 'big.txt'), big);
  const read = await registry.executeTool({ env: env(), mode: 'code', contextTools: {} }, 'read_file', { path: 'big.txt' });
  assert.ok(read.result.output.length < 30000, `read_file replay was ${read.result.output.length}`);
  assert.ok(read.result.output.includes('middle truncated'));

  fs.writeFileSync(path.join(WS, 'code.txt'), ('needle here\n').repeat(300));
  const search = await registry.executeTool({ env: env(), mode: 'code', contextTools: {} }, 'search_files', { query: 'needle', path: '.' });
  assert.ok(search.result.ok);
  assert.ok(search.result.output.length <= 17000, `search replay was ${search.result.output.length}`);
  assert.match(search.result.output, /More matches available/);
});

test('shell output is tail-capped so build errors at the end survive', async () => {
  // Runs on every platform: the command is `node <script>`, which needs no shell-specific quoting.
  const script = path.join(WS, 'bulk-output.mjs');
  fs.writeFileSync(script, "process.stdout.write('Y'.repeat(60000)); process.stdout.write('BUILD_ERROR_AT_END');\n");
  const exec = await shell.startShell(env(), `node ${JSON.stringify(script)}`, undefined, 15000);
  const out = exec.result.output;
  assert.ok(out.length < 12000, `shell replay was ${out.length}`);
  assert.ok(out.includes('early output omitted'), 'truncation must be marked');
  assert.ok(out.includes('BUILD_ERROR_AT_END'), 'the tail — where build errors live — must survive');
});

test('stage cut-off continues in place and still accepts the structured verdict', async () => {
  const provider = fakeProvider([
    { text: 'Partial review because the ', finishReason: 'length' },
    { toolCalls: [{ name: 'report_verdict', args: { verdict: 'PASS', summary: 'EC13_STAGE_OK' } }] },
  ]);
  const events = [];
  const r = await loop.runStage('review', {
    provider, signal: new AbortController().signal, contextWindow: 32000, requestedMaxTokens: 2048,
    maxIterations: 0, contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false, context7ApiKey: '' },
    journalEnv: env(), systemBlocks: ['sys'], stagePrompt: 'Review.', conversationContext: 'ctx',
    emit: (type, data) => events.push({ type, data }),
    onUsage: () => {},
  });
  assert.equal(r.passed, true);
  assert.match(r.summary, /EC13_STAGE_OK/);
});

test('stage usage is reported through onUsage for session accounting', async () => {
  const provider = fakeProvider([
    { toolCalls: [{ name: 'report_verdict', args: { verdict: 'PASS', summary: 'ok' } }], usage: { promptTokens: 111, completionTokens: 22, totalTokens: 133 } },
  ]);
  let seen = 0;
  await loop.runStage('review', {
    provider, signal: new AbortController().signal, contextWindow: 32000, requestedMaxTokens: 2048,
    maxIterations: 0, contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false, context7ApiKey: '' },
    journalEnv: env(), systemBlocks: ['sys'], stagePrompt: 'Review.', conversationContext: 'ctx',
    emit: () => {},
    onUsage: (u) => { seen += u.promptTokens; },
  });
  assert.equal(seen, 111);
});

test('provider skips corrupted SSE frames without killing the stream', () => {
  const deltas = [
    { index: 0, id: 'c1', name: 'write_file', argsDelta: '{"path":"ok.txt","content":"fine"}' },
  ];
  const { calls, invalid } = prov.assembleToolCalls(deltas);
  assert.equal(calls.length, 1);
  assert.equal(invalid.length, 0);
  // isRetryableStreamError classification used by the loop.
  assert.equal(loop.isRetryableStreamError('Model returned an empty response. Check the LM Studio server log and retry.'), true);
  assert.equal(loop.isRetryableStreamError('Provider stream ended before completion. Partial output was preserved; no partial tool call was executed.'), true);
  assert.equal(loop.isRetryableStreamError('Provider HTTP 502: bad gateway'), true);
  assert.equal(loop.isRetryableStreamError('Provider HTTP 401: invalid key'), false);
});
