// EC11 harness smoke test: stream /api/chat and summarize every SSE event.
const PORT = process.env.PORT || '3620';
const MODEL = process.argv[2] || 'qwen3.5-4b-claude-4.6-opus-reasoning-distilled-v2';
const STAGE = process.argv[3] || 'review';
const ENABLED = process.argv[4] !== 'off';
const WORKDIR = process.argv[5] || 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test';

const body = {
  messages: [{ role: 'user', content: "Create a file hello.js that prints 'hello from ec11' to the console. Then call attempt_completion. Keep it to one file." }],
  workingDirectory: WORKDIR,
  provider: {
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: MODEL,
    maxTokens: 4000,
    temperature: 0.3,
    contextWindow: 16384,
    connectTimeoutMs: 30000,
    completionTimeoutMs: 600000,
    streamIdleTimeoutMs: 300000,
    retries: 1,
  },
  agent: { maxIterations: 10, stageMaxIterations: 6 },
  autoPrompt: { enabled: ENABLED, stages: STAGE ? [STAGE] : [] },
};

const counts = {};
const tools = [];
const stages = [];
const sysMsgs = [];
const errors = [];
let assistantChars = 0;
const started = Date.now();

const ctl = new AbortController();
const hardTimeout = setTimeout(() => ctl.abort(), 540000);

try {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctl.signal,
  });
  console.log('HTTP', res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      counts[ev.type] = (counts[ev.type] || 0) + 1;
      if (ev.type === 'content') assistantChars += (ev.content || '').length;
      if (ev.type === 'tool_call') tools.push(ev.toolCall?.name);
      if (ev.type === 'auto_prompt_stage') stages.push(`${ev.stageResult?.stage}:${ev.stageResult?.passed ? 'PASS' : 'FAIL'}`);
      if (ev.type === 'system') sysMsgs.push(String(ev.content || '').slice(0, 100));
      if (ev.type === 'error') errors.push(String(ev.error || '').slice(0, 200));
      if (ev.type === 'done') console.log('DONE finalContentChars=', (ev.finalContent || '').length, 'stageResults=', JSON.stringify((ev.stageResults || []).map((s) => s.stage + ':' + (s.passed ? 'PASS' : 'FAIL'))));
    }
  }
} catch (e) {
  console.log('EXCEPTION', String(e.message || e));
}
clearTimeout(hardTimeout);
console.log('elapsed_s=', ((Date.now() - started) / 1000).toFixed(1));
console.log('event_counts=', JSON.stringify(counts));
console.log('tool_calls=', JSON.stringify(tools));
console.log('stage_results=', JSON.stringify(stages));
console.log('errors=', JSON.stringify(errors));
console.log('sample_system=', JSON.stringify(sysMsgs.slice(0, 6)));
console.log('assistant_chars=', assistantChars);
