// 1) Warm up LM Studio so a model is actually loaded.
// 2) Point EC11 at a DIFFERENT model and confirm the server-side resolver uses the loaded one.
const APP = 'http://127.0.0.1:3000';
const LM = 'http://127.0.0.1:1234/v1';
const LOADED_TARGET = process.argv[2] || 'qwen/qwen3.5-9b';
const WRONG = 'google/gemma-4-12b';

async function warmUp() {
  console.log('warming up LM Studio with', LOADED_TARGET, '(may take a while)...');
  const t0 = Date.now();
  const res = await fetch(LM + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LOADED_TARGET, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  });
  const txt = await res.text();
  console.log('warmup HTTP', res.status, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's', txt.slice(0, 120));
}

await warmUp();

// Check native loaded state
const native = await (await fetch('http://127.0.0.1:1234/api/v0/models')).json();
const loadedNative = (native.data || []).filter((m) => m.state === 'loaded').map((m) => m.id);
console.log('lmstudio_loaded=', JSON.stringify(loadedNative));

// Our API should report the loaded list
const mr = await (await fetch(APP + '/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: LM }) })).json();
console.log('ec11_/api/models loaded=', JSON.stringify(mr.loaded), 'models=', mr.models.length);

// Now run EC11 with the WRONG model configured; resolver must use the loaded one.
const body = {
  messages: [{ role: 'user', content: "Reply with the single word: ok. Then call attempt_completion." }],
  workingDirectory: 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test',
  provider: { baseUrl: LM, model: WRONG, maxTokens: 64, temperature: 0, contextWindow: 8192, connectTimeoutMs: 60000, completionTimeoutMs: 600000, retries: 1 },
  agent: { maxIterations: 4, stageMaxIterations: 2 },
  autoPrompt: { enabled: false, stages: [] },
  contextTools: { skills: false },
};
const res = await fetch(APP + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
const sys = []; let toolCalls = [];
while (true) {
  const { done, value } = await reader.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop() || '';
  for (const l of lines) {
    if (!l.startsWith('data: ')) continue;
    let ev; try { ev = JSON.parse(l.slice(6)); } catch { continue; }
    if (ev.type === 'system') sys.push(String(ev.content).slice(0, 160));
    if (ev.type === 'tool_call') toolCalls.push(ev.toolCall.name);
    if (ev.type === 'error') console.log('ERROR', ev.error);
  }
}
console.log('system_events=', JSON.stringify(sys, null, 1));
console.log('tool_calls=', JSON.stringify(toolCalls));
console.log('resolver_used_loaded=', sys.some((s) => s.includes(LOADED_TARGET)));
