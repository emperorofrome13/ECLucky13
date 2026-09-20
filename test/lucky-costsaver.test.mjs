import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('test-output', { recursive: true });

const prov = await import('../src/server/providers/openai-compatible.ts');
const { normalizeSettings } = await import('../src/shared/settings-schema.ts');

const msg = (role, content) => ({ role, content });

test('withCacheBreakpoints marks system head and tail only, never mutates', () => {
  const input = [
    msg('system', 'sys'), msg('user', 'u1'),
    msg('assistant', 'a1'), msg('tool', 't1'),
    msg('assistant', 'a2'), msg('tool', 't2'),
  ];
  const out = prov.withCacheBreakpoints(input);
  assert.equal(out.length, 6);
  // System + last two non-system (a2, t2) marked.
  assert.deepEqual(out[0].cache_control, { type: 'ephemeral' });
  assert.ok(!('cache_control' in out[1]));
  assert.ok(!('cache_control' in out[2]));
  assert.ok(!('cache_control' in out[3]));
  assert.deepEqual(out[4].cache_control, { type: 'ephemeral' });
  assert.deepEqual(out[5].cache_control, { type: 'ephemeral' });
  // Input untouched: unmarked are identical refs, marked are copies.
  assert.ok(out[1] === input[1]);
  assert.ok(out[0] !== input[0]);
  assert.deepEqual(input[0], msg('system', 'sys'));
});

test('withCacheBreakpoints is safe on tiny histories', () => {
  assert.deepEqual(prov.withCacheBreakpoints([]), []);
  const one = [msg('user', 'hi')];
  const out = prov.withCacheBreakpoints(one);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].cache_control, { type: 'ephemeral' });
  assert.ok(out[0] !== one[0] && one[0].cache_control === undefined);
});

test('cacheBreakpointsAllowed never fires for local models', () => {
  assert.equal(prov.cacheBreakpointsAllowed('https://openrouter.ai/api/v1', true), true);
  assert.equal(prov.cacheBreakpointsAllowed('http://127.0.0.1:1234/v1', true), false);
  assert.equal(prov.cacheBreakpointsAllowed('http://localhost:1234/v1', true), false);
  assert.equal(prov.cacheBreakpointsAllowed('https://openrouter.ai/api/v1', false), false);
  assert.equal(prov.cacheBreakpointsAllowed('https://openrouter.ai/api/v1', undefined), false);
});

test('usage parser extracts cached tokens with fallbacks', () => {
  const first = (ev) => {
    for (const e of prov.payloadEvents(ev)) if (e.type === 'usage') return e.usage;
    return null;
  };
  const u1 = first({ usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 60 } } });
  assert.deepEqual(u1, { promptTokens: 100, completionTokens: 10, totalTokens: 110, cachedTokens: 60 });
  const u2 = first({ usage: { prompt_tokens: 100, completion_tokens: 10 } });
  assert.deepEqual(u2, { promptTokens: 100, completionTokens: 10, totalTokens: 110 });
  assert.ok(!('cachedTokens' in u2));
  const u3 = first({ usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, cached_tokens: 7 } });
  assert.equal(u3.cachedTokens, 7);
});

test('costSaver setting defaults off and normalizes', () => {
  assert.equal(normalizeSettings({}).provider.costSaver, false);
  assert.equal(normalizeSettings({ provider: { costSaver: true } }).provider.costSaver, true);
  assert.equal(normalizeSettings({ provider: { costSaver: 'yes' } }).provider.costSaver, false);
  assert.equal(normalizeSettings({}).provider.saverTurnBudget, 60);
  assert.equal(normalizeSettings({ provider: { saverTurnBudget: 25 } }).provider.saverTurnBudget, 25);
});

test('historyDiet uses knobs normally, saver preset when on', async () => {
  const cm = await import('../src/server/agent/context-manager.ts');
  assert.deepEqual(cm.historyDiet({}, false), { full: 5, chars: 500, callChars: 200 });
  assert.deepEqual(cm.historyDiet({ historyToolFull: 9, historyToolChars: 700, historyToolCallChars: 50 }, false), { full: 9, chars: 700, callChars: 50 });
  assert.deepEqual(cm.historyDiet({ historyToolFull: 50 }, true), { full: 2, chars: 200, callChars: 100 });
});

test('soft turn budget warns once then finishes blocked with wrap-up', async () => {
  const loop = await import('../src/server/agent/loop.ts');
  const cm2 = await import('../src/server/agent/context-manager.ts');
  const root = fs.mkdtempSync(path.resolve('test-output/lucky-budget-'));
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello budget');
  const events = [];
  const provider = { async *stream() {
    yield { type: 'tool_delta', index: 0, id: 'k', name: 'read_file', argsDelta: JSON.stringify({ path: 'note.txt' }) };
    yield { type: 'done', finishReason: 'stop' };
  } };
  const conversation = cm2.newConversation();
  const outcome = await loop.runMainLoop({
    runId: 'budget', sessionId: 'budget', workspace: root, mode: 'code', signal: new AbortController().signal,
    provider, contextWindow: 32000, requestedMaxTokens: 1000, autoCompact: false, maxIterations: 0,
    repeatedFailureLimit: 3, costSaver: true, softTurnLimit: 4, contextTools: {},
    journalEnv: { workspacePath: root, runId: 'budget', sessionId: 'budget', reviewMode: false },
    conversation, systemBlocks: ['Test saver'], task: 'read the note', emit: (type, data) => events.push({ type, data }),
  });
  assert.equal(outcome.blocked, true);
  assert.match(outcome.error || '', /turn budget/);
  assert.ok(outcome.turns >= 9 && outcome.turns <= 10, `turns=${outcome.turns}`);
  assert.ok(events.some((e) => e.type === 'error' && !e.data.fatal && /turn budget reached/.test(e.data.message)), 'warns once');
  assert.ok(conversation.messages.some((m) => m.role === 'user' && /turn budget reached/.test(m.content || '')), 'warning visible in history');
});

test('soft budget off leaves long runs alone', async () => {
  const loop = await import('../src/server/agent/loop.ts');
  const cm2 = await import('../src/server/agent/context-manager.ts');
  let calls = 0;
  const done = { type: 'done', finishReason: 'stop' };
  const provider = { async *stream() { calls++; yield done; } };
  const outcome = await loop.runMainLoop({
    runId: 'nobudget', sessionId: 'nobudget', workspace: process.cwd(), mode: 'ask', signal: new AbortController().signal,
    provider, contextWindow: 32000, requestedMaxTokens: 1000, autoCompact: false, maxIterations: 0,
    repeatedFailureLimit: 3, contextTools: {},
    journalEnv: { workspacePath: process.cwd(), runId: 'nobudget', sessionId: 'nobudget', reviewMode: false },
    conversation: cm2.newConversation(), systemBlocks: ['Test'], task: 'say hi', emit: () => {},
  });
  assert.equal(outcome.blocked, false);
  assert.ok(!/turn budget/.test(outcome.error || ''));
});
