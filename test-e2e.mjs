const BASE = 'http://localhost:3000';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// 1. Register workspace
console.log('1. Registering workspace...');
const ws = await post('/api/workspaces', { path: 'E:/aiprojects/coders/ec/ec12' });
console.log('  Workspace:', JSON.stringify(ws));
if (!ws.ok) { console.error('FAILED: workspace registration'); process.exit(1); }

// 2. Create a run
console.log('2. Sending hello...');
const run = await post('/api/runs', {
  clientRequestId: 'e2e_test_' + Date.now(),
  sessionId: 'e2e_ses_' + Date.now(),
  workspaceId: ws.workspace.id,
  mode: 'ask',
  task: 'hello',
  settings: {
    provider: { baseUrl: 'http://127.0.0.1:1234', apiKey: '', model: 'google/gemma-4-e2b', modelSelection: 'auto', contextWindow: 32256, maxTokens: 2048, temperature: 0.7, connectTimeoutMs: 10000, firstTokenTimeoutMs: 120000, streamIdleTimeoutMs: 30000, requestTimeoutMs: 300000, retries: 1, inputCostPer1M: 0, outputCostPer1M: 0, currency: 'USD' },
    agent: { maxIterations: 0, repeatedFailureLimit: 5, reviewBeforeApply: false, autoAcceptChanges: true, stageMaxIterations: 0, stageRepairAttempts: 1 },
    autoPrompt: { enabled: false, stages: [] },
    contextTools: { readFile: true, writeFile: true, listFiles: true, grep: true, skills: false },
    workspace: { id: ws.workspace.id, path: ws.workspace.path },
    theme: 'dark', mode: 'ask',
  },
});
console.log('  Run created:', JSON.stringify(run));
if (!run.ok) { console.error('FAILED: run creation'); process.exit(1); }

// 3. Read SSE events via fetch
const runId = run.runId;
console.log('3. Reading events for run', runId, '...');
const res = await fetch(`${BASE}/api/runs/${runId}/events?after=0`);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const seenTypes = new Set();
let assistantText = '';
let done = false;
const startTime = Date.now();

while (!done && Date.now() - startTime < 60000) {
  const { value, done: streamDone } = await reader.read();
  if (streamDone) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    try {
      const e = JSON.parse(line.slice(6));
      seenTypes.add(e.type);
      if (e.type === 'assistant.delta') assistantText += (e.data?.text || '');
      if (e.type === 'error') console.log('  ERROR:', e.data?.message);
      if (e.type === 'run.state') console.log('  State:', e.data?.state);
      if (e.type === 'run.finished') { console.log('  Finished:', e.data?.summary?.outcome); done = true; break; }
    } catch { /* ignore */ }
  }
}

console.log('\n=== RESULTS ===');
console.log('Event types:', [...seenTypes].join(', '));
console.log('Assistant text:', assistantText ? JSON.stringify(assistantText.slice(0, 500)) : '(EMPTY!)');
console.log('Done:', done);
if (!done) console.log('TIMEOUT');
