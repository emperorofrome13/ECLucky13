import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.mkdirSync('test-output', { recursive: true });

const cm = await import('../src/server/agent/context-manager.ts');

const toolMsg = (id, chars) => ({ role: 'tool', tool_call_id: id, content: 'OUT-' + id + '-' + 'x'.repeat(chars) });
const convo = (n) => {
  const messages = [{ role: 'user', content: 'do the thing' }];
  for (let i = 0; i < n; i++) {
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
    messages.push(toolMsg('c' + i, 2000));
  }
  return { messages, plan: [], updatedAt: '2026-09-19T00:00:00.000Z' };
};

test('summarizeOldToolOutputs keeps recent tool results complete', () => {
  const out = cm.summarizeOldToolOutputs(convo(8).messages, 3, 500);
  const tools = out.filter((m) => m.role === 'tool');
  assert.equal(tools.length, 8);
  // Last 3 complete (2000+ chars, no marker); older condensed with marker.
  for (const t of tools.slice(-3)) assert.ok(t.content.length > 2000 && !t.content.includes('condensed'));
  for (const t of tools.slice(0, 5)) {
    assert.ok(t.content.includes('condensed to 500 characters'));
    assert.ok(t.content.length < 800);
  }
});

test('summarizeOldToolOutputs leaves non-tool and short outputs alone, never mutates', () => {
  const c = convo(3);
  c.messages.push({ role: 'assistant', content: 'done' });
  const before = JSON.stringify(c.messages);
  const out = cm.summarizeOldToolOutputs(c.messages, 5, 500);
  assert.equal(JSON.stringify(c.messages), before);
  assert.equal(out.filter((m) => m.role === 'assistant').length, 4);
  // keepFull covers all 3 tool messages: identical refs back.
  assert.ok(out.every((m, i) => m === c.messages[i]));
  // Short outputs are never condensed even outside the window.
  const mixed = [toolMsg('a', 100), toolMsg('b', 2000)];
  const out2 = cm.summarizeOldToolOutputs(mixed, 0, 500);
  assert.equal(out2[0].content.length, 100 + 'OUT-a-'.length);
  assert.ok(out2[1].content.includes('condensed'));
});

test('summarizeOldToolOutputs honors zero/unlimited and keep-none', () => {
  const c = convo(2).messages;
  assert.deepEqual(cm.summarizeOldToolOutputs(c, 5, 0), c);
  const all = cm.summarizeOldToolOutputs(c, 0, 500);
  assert.ok(all.filter((m) => m.role === 'tool').every((m) => m.content.includes('condensed')));
});

test('prepareConversation slims outgoing tool history, durable stays complete', () => {
  const c = convo(10);
  const fullChars = c.messages.filter((m) => m.role === 'tool').reduce((n, m) => n + m.content.length, 0);
  const p = cm.prepareConversation(c, ['sys'], [], 200000, 4096, false, 80, 4, 'full', 3, 500);
  const outTools = p.messages.filter((m) => m.role === 'tool');
  assert.equal(outTools.length, 10);
  assert.ok(outTools.slice(-3).every((m) => m.content.length > 2000));
  assert.ok(outTools.slice(0, 7).every((m) => m.content.includes('condensed')));
  const outChars = outTools.reduce((n, m) => n + m.content.length, 0);
  assert.ok(outChars < fullChars * 0.6, `only ${fullChars - outChars} chars saved`);
  // Durable conversation untouched.
  assert.ok(c.messages.filter((m) => m.role === 'tool').every((m) => m.content.length > 2000 && !m.content.includes('condensed')));
});

test('compaction restore recovers full tool outputs, not condensed copies', () => {
  const c = convo(12);
  cm.prepareConversation(c, ['sys'], [], 3000, 512, true, 80, 2, 'full', 2, 500);
  const condensed = c.messages.filter((m) => m.role === 'tool' && m.content.includes('condensed'));
  assert.equal(condensed.length, 0, `${condensed.length} durable tool messages left condensed`);
});

test('resolveReasoningReplay defaults to active-batch for local and remote, honors explicit', () => {
  for (const local of [true, false]) {
    assert.equal(cm.resolveReasoningReplay('auto', local), 'active-batch');
    assert.equal(cm.resolveReasoningReplay(undefined, local), 'active-batch');
    assert.equal(cm.resolveReasoningReplay(true, local), 'active-batch');
  }
  assert.equal(cm.resolveReasoningReplay('tool-turns', false), 'tool-turns');
  assert.equal(cm.resolveReasoningReplay('full', true), 'full');
  assert.equal(cm.resolveReasoningReplay('none', false), 'none');
});

test('active-batch default keeps only the latest tool batch reasoning', () => {
  const c = convo(4);
  c.messages.forEach((m, i) => { if (m.role === 'assistant') m.reasoning_content = 'reason-' + i; });
  const p = cm.prepareConversation(c, ['sys'], [], 200000, 4096, false, 80, 4, 'auto');
  const kept = p.messages.filter((m) => m.role === 'assistant' && m.reasoning_content);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].reasoning_content, 'reason-' + (c.messages.length - 2));
});

const callConvo = (n) => {
  const messages = [{ role: 'user', content: 'do the thing' }];
  for (let i = 0; i < n; i++) {
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'k' + i, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: `f${i}.txt`, content: 'y'.repeat(2000) }) } }] });
    messages.push({ role: 'tool', tool_call_id: 'k' + i, content: 'ok' });
  }
  return { messages, plan: [], updatedAt: '2026-09-19T00:00:00.000Z' };
};

test('summarizeOldToolCallArgs condenses old arguments, keeps pairing intact', () => {
  const out = cm.summarizeOldToolCallArgs(callConvo(6).messages, 2, 200);
  const calls = out.filter((m) => m.role === 'assistant');
  assert.equal(calls.length, 6);
  for (const c of calls.slice(-2)) assert.ok(JSON.stringify(c.tool_calls).length > 2000);
  for (const c of calls.slice(0, 4)) {
    const fn = c.tool_calls[0].function;
    assert.equal(fn.name, 'write_file');
    assert.equal(c.tool_calls[0].id.slice(0, 1), 'k');
    assert.equal(c.tool_calls[0].type, 'function');
    assert.ok(fn.arguments.includes('path=') && fn.arguments.includes('<200'));
    assert.ok(fn.arguments.length < 300);
  }
});

test('summarizeOldToolCallArgs leaves short args and non-calls alone, never mutates', () => {
  const c = callConvo(2);
  const before = JSON.stringify(c.messages);
  const out = cm.summarizeOldToolCallArgs(c.messages, 5, 200);
  assert.equal(JSON.stringify(c.messages), before);
  assert.ok(out.every((m, i) => m === c.messages[i]));
  assert.deepEqual(cm.summarizeOldToolCallArgs(c.messages, 5, 0), c.messages);
  const all = cm.summarizeOldToolCallArgs(c.messages, 0, 200);
  assert.ok(all.filter((m) => m.role === 'assistant').every((m) => m.tool_calls[0].function.arguments.includes('chars>')));
});

test('prepareConversation slims old call arguments, durable stays complete', () => {
  const c = callConvo(8);
  const p = cm.prepareConversation(c, ['sys'], [], 200000, 4096, false, 80, 4, 'full', 5, 500, 200);
  const outCalls = p.messages.filter((m) => m.role === 'assistant');
  assert.ok(outCalls.slice(-5).every((m) => JSON.stringify(m.tool_calls).length > 2000));
  assert.ok(outCalls.slice(0, 3).every((m) => m.tool_calls[0].function.arguments.includes('chars>')));
  assert.ok(c.messages.filter((m) => m.role === 'assistant').every((m) => m.tool_calls[0].function.arguments.includes('yyyy')));
});

test('system prompt instructs batched independent tool calls', () => {
  const text = fs.readFileSync(new URL('../autoprompts/system.md', import.meta.url));
  assert.match(String(text), /batch independent tool calls/i);
});
