// EC12 live smoke test against the running server (port 3211). Uses the real local model server.
const BASE = process.env.EC12_BASE || 'http://127.0.0.1:3211';
const WS_PATH = process.argv[2] || 'E:\\aiprojects\\coders\\ec\\ec12\\workspace-test';

const settings = {
  provider: {
    preset: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: 'qwen/qwen3.5-9b',
    modelSelection: 'auto', maxTokens: 4096, temperature: 0.2, contextWindow: 16384,
    connectTimeoutMs: 180000, firstTokenTimeoutMs: 300000, streamIdleTimeoutMs: 300000, requestTimeoutMs: 900000,
    retries: 0, inputCostPer1M: 0, outputCostPer1M: 0, currency: '$', autoCompact: true,
  },
  agent: { maxIterations: 8, stageMaxIterations: 4, reviewBeforeApply: false, autoAcceptChanges: true, repeatedFailureLimit: 3 },
  autoPrompt: { enabled: false, stages: [] },
  contextTools: { rtk: false, ponytail: false, context7: false, codegraph: false, search: false, skills: false },
  workspace: { id: '', path: '' }, mode: 'code', theme: 'neon', recentModels: [], hiddenModels: [], hideVariants: false,
};

const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());

const ws = await post('/api/workspaces', { path: WS_PATH });
if (!ws.ok) { console.error('workspace register failed:', ws); process.exit(1); }
console.log('workspace:', ws.workspace.id, ws.workspace.path);

async function runTask(task, { cancelAfterMs = 0, timeoutMs = 240000 } = {}) {
  const created = await post('/api/runs', { clientRequestId: 'smoke_' + Date.now(), sessionId: 'ses_smoke', workspaceId: ws.workspace.id, mode: 'code', task, settings });
  if (!created.ok) { console.error('run create failed:', created); return null; }
  const runId = created.runId;
  console.log('\nRUN', runId, 'task:', task);
  const summary = { events: {}, changes: [], checks: [], stages: [], states: [], content: '' };
  const res = await fetch(`${BASE}/api/runs/${runId}/events?after=0`, { headers: { Accept: 'text/event-stream' } });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const start = Date.now();
  let cancelSent = false;
  let finished = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let e; try { e = JSON.parse(line.slice(5).trim()); } catch { continue; }
      summary.events[e.type] = (summary.events[e.type] || 0) + 1;
      const d = e.data || {};
      if (e.type === 'assistant.delta') summary.content += d.text || '';
      if (e.type === 'run.state') { summary.states.push(d.state); console.log('  state ->', d.state, d.detail ? '(' + d.detail + ')' : ''); if (cancelAfterMs && d.state === 'generating' && !cancelSent) { cancelSent = true; console.log('  >>> sending cancel'); await post(`/api/runs/${runId}/cancel`, {}); } }
      if (e.type === 'tool.finished') console.log('  tool', d.name, d.ok ? 'ok' : 'FAIL', (d.durationMs || 0) + 'ms');
      if (e.type === 'change.applied' || e.type === 'change.pending') { summary.changes.push({ id: d.changeId, path: d.path, status: e.type === 'change.pending' ? 'pending' : 'applied' }); console.log('  change', d.operation, d.path, d.add + '/' + d.del); }
      if (e.type === 'verification.check') { summary.checks.push(d.check.name + '=' + d.check.status); console.log('  check', d.check.name, d.check.status); }
      if (e.type === 'stage.finished') { summary.stages.push(d.stage + '=' + (d.passed ? 'PASS' : 'FAIL')); }
      if (e.type === 'error') console.log('  error:', String(d.message).slice(0, 160), d.fatal ? '(fatal)' : '');
      if (e.type === 'run.finished') { finished = true; summary.outcome = d.summary?.outcome; console.log('  FINISHED ->', d.summary?.outcome); }
    }
    if (finished || Date.now() - start > timeoutMs) break;
  }
  const final = await fetch(`${BASE}/api/runs/${runId}`).then((r) => r.json());
  summary.finalState = final.run?.state;
  console.log('  final state:', final.run?.state, 'summary outcome:', final.run?.summary?.outcome || '(none)');
  return summary;
}

console.log('\n=== TEST 1: real task, verification semantics ===');
const t1 = await runTask("Use write_file to create hello12.js containing exactly: console.log('hello from ec12');", {});
console.log('TEST1 result:', JSON.stringify({ events: t1.events, changes: t1.changes, checks: t1.checks, finalState: t1.finalState, outcome: t1.outcome }));
console.log('TEST1 assistant text:', JSON.stringify(t1.content.slice(0, 400)));

console.log('\n=== TEST 2: cancel cannot become success ===');
const t2 = await runTask("Write a very long detailed 5000 word essay about software architecture into essay.txt using write_file.", { cancelAfterMs: 2500, timeoutMs: 60000 });
console.log('TEST2 final state:', t2.finalState, '(must be cancelled)');

const ok1 = ['unverified', 'succeeded', 'failed', 'blocked'].includes(t1.finalState);
const ok2 = t2.finalState === 'cancelled';
console.log('\nSMOKE:', ok1 && ok2 ? 'PASS' : 'FAIL');
process.exit(ok1 && ok2 ? 0 : 1);
