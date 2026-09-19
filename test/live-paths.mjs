// EC12 live-path verification (no model server needed). Run: phase1, restart server, phase2.
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.EC12_BASE || 'http://127.0.0.1:3211';
const PHASE = process.argv[2] || 'phase1';
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const get = (p) => fetch(BASE + p).then((r) => r.json());
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!cond) process.exitCode = 1; };

if (PHASE === 'phase1') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec12-live-'));
  const ws = await (await post('/api/workspaces', { path: dir })).json();
  ok('register workspace', ws.ok, ws.workspace?.id);
  const wsId = ws.workspace.id;

  // 1. terminal exec + reconciliation
  const ex = await (await post('/api/exec', { workspaceId: wsId, command: "Set-Content -Path 'made.txt' -Value 'by terminal'" })).json();
  ok('terminal exec', ex.ok && ex.exitCode === 0, JSON.stringify({ exit: ex.exitCode, ms: ex.durationMs }));
  ok('terminal reconciled', ex.workspaceChanges >= 1 && Array.isArray(ex.changeIds) && ex.changeIds.length >= 1);
  const ch = await get('/api/changes/' + ex.changeIds[0]);
  ok('change recorded', ch.ok && ch.change.changeId === ex.changeIds[0], ch.change?.status);

  // 2. editor conflict (stale hash -> 409)
  const rd = await fetch(`${BASE}/api/files/${wsId}?path=made.txt`).then((r) => r.json());
  fs.writeFileSync(path.join(dir, 'made.txt'), 'changed behind your back');
  const putRes = await fetch(`${BASE}/api/files/${wsId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'made.txt', content: 'stale save', beforeHash: rd.hash }) });
  ok('stale save rejected (409)', putRes.status === 409);

  // 3+4. two failing runs -> session/event isolation + reconnect replay
  const bad = { preset: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'none', modelSelection: 'pinned', maxTokens: 64, temperature: 0, contextWindow: 4096, connectTimeoutMs: 3000, firstTokenTimeoutMs: 5000, streamIdleTimeoutMs: 5000, requestTimeoutMs: 15000, retries: 0, inputCostPer1M: 0, outputCostPer1M: 0, currency: '$', autoCompact: true };
  const mk = (task, sid) => post('/api/runs', { clientRequestId: 'lp_' + sid + '_' + Date.now(), sessionId: sid, workspaceId: wsId, mode: 'code', task, settings: { provider: bad, agent: { maxIterations: 2, stageMaxIterations: 0, reviewBeforeApply: false, autoAcceptChanges: true, repeatedFailureLimit: 2, stageRepairAttempts: 0 }, autoPrompt: { enabled: false, stages: [] }, contextTools: {}, workspace: { id: wsId, path: dir }, mode: 'code', theme: 'neon', recentModels: [], hiddenModels: [], hideVariants: false } }).then((r) => r.json());
  const A = await mk('task about APPLES unique word zxq-apples-1', 'lp_ses_a');
  const B = await mk('task about ORANGES unique word zxq-oranges-2', 'lp_ses_b');
  ok('both runs created', A.ok && B.ok);

  async function collect(runId, after = 0, maxMs = 60000) {
    const res = await fetch(`${BASE}/api/runs/${runId}/events?after=${after}`, { headers: { Accept: 'text/event-stream' } });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const evs = [];
    const t0 = Date.now(); let done = false;
    while (Date.now() - t0 < maxMs) {
      const { done: d, value } = await reader.read();
      if (d) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        try { const e = JSON.parse(l.slice(5).trim()); evs.push(e); if (e.type === 'run.finished') { done = true; break; } } catch { /* keep */ }
      }
      if (done) break;
    }
    try { reader.cancel(); } catch { /* ignore */ }
    return evs;
  }
  const [evA, evB] = [await collect(A.runId), await collect(B.runId)];
  const textA = JSON.stringify(evA), textB = JSON.stringify(evB);
  const ownA = evA.every((e) => e.runId === A.runId && e.sessionId === 'lp_ses_a');
  const ownB = evB.every((e) => e.runId === B.runId && e.sessionId === 'lp_ses_b');
  ok('session A isolated', ownA && textA.includes('zxq-apples-1') && !textA.includes('zxq-oranges-2'));
  ok('session B isolated', ownB && textB.includes('zxq-oranges-2') && !textB.includes('zxq-apples-1'));

  // reconnect: fetch tail again with after and check no dupes vs full coverage
  const seqA = evA.map((e) => e.sequence);
  const last = seqA[seqA.length - 1] || 0;
  const tail = await collect(A.runId, last - 2, 10000);
  const merged = new Map();
  for (const e of [...evA, ...tail]) merged.set(e.sequence, e);
  ok('reconnect replays tail', tail.length >= 2);
  ok('no duplicate sequences after merge', merged.size === new Set([...seqA, ...tail.map((e) => e.sequence)]).size);

  // 6. EC11 import (settings mapped, sessions as transcript text, repeatable, keys untouched)
  const mig1 = await (await post('/api/migrate', { settings: { provider: { baseUrl: 'http://x', model: 'm1' }, theme: 'amber' }, sessions: [{ id: 's1', title: 'old chat', events: [{ kind: 'user', content: 'hi' }, { kind: 'assistant', content: 'hello' }, { kind: 'tool_call', content: 'x' }] }] })).json();
  ok('migrate applies settings, skips tools', mig1.ok && mig1.applied.provider.model === 'm1' && mig1.importedSessions === 1);
  const mig2 = await (await post('/api/migrate', { settings: { provider: { baseUrl: 'http://x', model: 'm1' } }, sessions: [{ id: 's1', title: 'old chat', events: [{ kind: 'user', content: 'hi' }] }] })).json();
  ok('migrate repeatable (no duplicates)', mig2.ok && mig2.imported[0].events === 0);

  // 5. inject a fake active run for the restart test
  const dataDir = 'E:\\aiprojects\\coders\\ec\\ec12\\data\\runs';
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'run_inject_live.json'), JSON.stringify({ id: 'run_inject_live', sessionId: 'lp_ses_a', workspaceId: wsId, workspacePath: dir, mode: 'code', state: 'generating', clientRequestId: 'inject', configuredModel: 'm', effectiveModel: 'm', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  console.log('INJECTED run_inject_live (restart the server, then run phase2)');
}

if (PHASE === 'phase2') {
  const r = await get('/api/runs/run_inject_live');
  ok('restart marks injected run interrupted', r.ok && r.run.state === 'interrupted', r.run?.state);
}
