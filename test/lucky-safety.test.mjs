import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

fs.mkdirSync('test-output', { recursive: true });
process.env.EC12_DATA_DIR = fs.mkdtempSync(path.join(path.resolve('test-output'), 'lucky-safety-'));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-fixture-'));

const { dataDir, validPersistentId } = await import('../src/server/store.ts');
const { registerWorkspace, resolveInWorkspace } = await import('../src/server/workspace/path-policy.ts');
const journal = await import('../src/server/workspace/change-journal.ts');
const { runVerification } = await import('../src/server/verification/execute.ts');
const { checkRequest } = await import('../src/server/security/auth.ts');

function fixtureDir(name) {
  const p = path.join(fixtures, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

test('persistent ids are validated and dataDir rejects traversal components', () => {
  assert.equal(validPersistentId('ses_abc123'), true);
  assert.equal(validPersistentId('../evil'), false);
  assert.equal(validPersistentId('a/b'), false);
  assert.equal(validPersistentId(''), false);
  assert.throws(() => dataDir('sessions', '../workspaces', 'x.json'), /Invalid data path|escapes/i);
  assert.throws(() => dataDir('..', 'escape.json'), /Invalid data path|escapes/i);
  const ok = dataDir('sessions', 'ses_x.json');
  assert.ok(path.resolve(ok).startsWith(path.resolve(process.env.EC12_DATA_DIR)));
});

test('existing symlink target escaping the workspace is rejected, not swallowed', () => {
  const ws = fixtureDir('confinement');
  const outside = fixtureDir('outside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  const link = path.join(ws, 'jump');
  try { fs.symlinkSync(outside, link, 'junction'); } catch (e) { if (e.code !== 'EPERM') throw e; }
  if (fs.existsSync(link)) {
    assert.throws(() => resolveInWorkspace(ws, 'jump/secret.txt'), /escapes/i);
  }
  assert.throws(() => resolveInWorkspace(ws, '../outside/secret.txt'), /escapes|Absolute/);
  assert.throws(() => resolveInWorkspace(ws, 'a/b/../../../outside/secret.txt'), /escapes|Absolute/);
});

test('overlay reads validate the relative path before touching staging', () => {
  const ws = registerWorkspace(fixtureDir('overlay-ws'));
  const env = { workspacePath: ws.path, runId: 'run_ovl', sessionId: 'ses_ovl', reviewMode: true };
  assert.throws(() => journal.overlayRead(env, 'sub/../../outside.txt'), /escapes|Absolute|relative path/i);
  const r = journal.writeFile(env, 'ok.txt', 'hello');
  assert.equal(r.ok, true);
  const bad = journal.writeFile(env, '../evil.txt', 'x');
  assert.equal(bad.ok, false);
  assert.match(String(bad.error || ''), /escapes|Absolute|relative path/i);
});

test('staged deletes are honest tombstones and approval cleans staging', () => {
  const ws = registerWorkspace(fixtureDir('tomb-ws'));
  fs.writeFileSync(path.join(ws.path, 'gone.txt'), 'data');
  const env = { workspacePath: ws.path, runId: 'run_tb', sessionId: 'ses_tb', reviewMode: true };
  const del = journal.deleteFile(env, 'gone.txt');
  assert.equal(del.ok, true);
  const seen = journal.overlayRead(env, 'gone.txt');
  assert.equal(seen.exists, false);
  const stillThere = fs.existsSync(path.join(ws.path, 'gone.txt'));
  assert.equal(stillThere, true);
  const wsPath = ws.path;
  const approved = journal.approveChange(del.record.changeId, { workspacePath: wsPath, runId: 'run_tb', sessionId: 'ses_tb', reviewMode: false });
  assert.equal(approved.ok, true);
  assert.equal(fs.existsSync(path.join(ws.path, 'gone.txt')), false);
  assert.equal(fs.existsSync(path.join(process.env.EC12_DATA_DIR, 'staging', 'run_tb', 'gone.txt')), false);
});

test('approval refuses to overwrite newer disk content (conflict)', () => {
  const ws = registerWorkspace(fixtureDir('conflict-ws'));
  fs.writeFileSync(path.join(ws.path, 'f.txt'), 'one');
  const env = { workspacePath: ws.path, runId: 'run_cf', sessionId: 'ses_cf', reviewMode: true };
  const w = journal.writeFile(env, 'f.txt', 'two');
  assert.equal(w.ok, true);
  fs.writeFileSync(path.join(ws.path, 'f.txt'), 'external-edit');
  const approved = journal.approveChange(w.record.changeId, { workspacePath: ws.path, runId: 'run_cf', sessionId: 'ses_cf', reviewMode: false });
  assert.equal(approved.ok, false);
  assert.equal(fs.readFileSync(path.join(ws.path, 'f.txt'), 'utf8'), 'external-edit');
});

test('rejecting a change invalidates later dependent pending changes on the same path', () => {
  const ws = registerWorkspace(fixtureDir('dep-ws'));
  fs.writeFileSync(path.join(ws.path, 'd.txt'), 'base');
  const env = { workspacePath: ws.path, runId: 'run_dp', sessionId: 'ses_dp', reviewMode: true };
  const first = journal.writeFile(env, 'd.txt', 'first');
  const second = journal.writeFile(env, 'd.txt', 'second');
  assert.equal(first.ok && second.ok, true);
  const rejected = journal.rejectChange(first.record.changeId);
  assert.equal(rejected.ok, true);
  const later = journal.getChange(second.record.changeId);
  assert.equal(later.status, 'conflict');
  const approvedLater = journal.approveChange(second.record.changeId, { workspacePath: ws.path, runId: 'run_dp', sessionId: 'ses_dp', reviewMode: false });
  assert.equal(approvedLater.ok, false);
  assert.equal(fs.readFileSync(path.join(ws.path, 'd.txt'), 'utf8'), 'base');
});

test('approval sequence is oldest-first; approving the newer one first conflicts', () => {
  const ws = registerWorkspace(fixtureDir('ord-ws'));
  fs.writeFileSync(path.join(ws.path, 'o.txt'), 'a');
  const env = { workspacePath: ws.path, runId: 'run_or', sessionId: 'ses_or', reviewMode: true };
  const a = journal.writeFile(env, 'o.txt', 'b');
  const b = journal.writeFile(env, 'o.txt', 'c');
  const newerFirst = journal.approveChange(b.record.changeId, { workspacePath: ws.path, runId: 'run_or', sessionId: 'ses_or', reviewMode: false });
  assert.equal(newerFirst.ok, false);
  const ok1 = journal.approveChange(a.record.changeId, { workspacePath: ws.path, runId: 'run_or', sessionId: 'ses_or', reviewMode: false });
  assert.equal(ok1.ok, true);
  const ok2 = journal.approveChange(b.record.changeId, { workspacePath: ws.path, runId: 'run_or', sessionId: 'ses_or', reviewMode: false });
  assert.equal(ok2.ok, true, String(ok2.error || 'approve of second change failed'));
  assert.equal(fs.readFileSync(path.join(ws.path, 'o.txt'), 'utf8'), 'c');
});

test('shell reconciliation never mistakes bounded-snapshot files for creates or deletes', () => {
  const ws = registerWorkspace(fixtureDir('snap-ws'));
  const bigPath = path.join(ws.path, 'big.bin');
  fs.writeFileSync(bigPath, Buffer.alloc(600 * 1024, 1));
  const before = journal.snapshotWorkspace(ws.path);
  assert.equal(before.files.has('big.bin'), false);
  assert.equal(before.incomplete.has('big.bin'), true);
  fs.rmSync(bigPath);
  const rec = journal.reconcileShellChanges(
    { workspacePath: ws.path, runId: 'run_snap', sessionId: 'ses_snap', reviewMode: false },
    before, 'test'
  );
  const bigChanges = rec.changes.filter((c) => c.path === 'big.bin');
  assert.equal(bigChanges.length, 0);
  fs.writeFileSync(path.join(ws.path, 'appeared.bin'), Buffer.alloc(600 * 1024, 2));
  const rec2 = journal.reconcileShellChanges(
    { workspacePath: ws.path, runId: 'run_snap', sessionId: 'ses_snap', reviewMode: false },
    before, 'test'
  );
  const appeared = rec2.changes.find((c) => c.path === 'appeared.bin');
  assert.equal(appeared, undefined);
  assert.ok(rec2.skipped > 0);
  fs.writeFileSync(bigPath, 'now text');
  const rec3 = journal.reconcileShellChanges({ workspacePath: ws.path, runId: 'run_snap', sessionId: 'ses_snap', reviewMode: false }, before, 'test');
  const changed = rec3.changes.find((c) => c.path === 'big.bin');
  assert.equal(changed.operation, 'modify');
  assert.equal(changed.beforeText, null);
  assert.equal(journal.revertChange(changed.changeId, { workspacePath: ws.path, runId: 'run_snap', sessionId: 'ses_snap', reviewMode: false }).ok, false);
  assert.equal(fs.readFileSync(bigPath, 'utf8'), 'now text');
  assert.equal(fs.existsSync(path.join(ws.path, 'appeared.bin')), true);
});

test('change index lists each change once', () => {
  const ws = registerWorkspace(fixtureDir('idx-ws'));
  const env = { workspacePath: ws.path, runId: 'run_idx', sessionId: 'ses_idx', reviewMode: false };
  const w = journal.writeFile(env, 'idx.txt', 'x');
  assert.equal(w.ok, true);
  const listed = journal.listChanges('ses_idx');
  const matches = listed.filter((c) => c.changeId === w.record.changeId);
  assert.equal(matches.length, 1);
});

test('verification is truthful: failed optional blocks verified; unavailable required gives unverified', async () => {
  const ws = fixtureDir('verif-ws');
  const mk = (id, required, command, args, kind) => ({ checkId: id, name: id, command, args, cwd: ws, required, kind });
  const failingOptional = await runVerification(ws, [
    { checkId: 'pytest', name: 'pytest', command: process.execPath, args: ['-e', 'process.exit(1)'], cwd: ws, required: false, kind: 'python' },
  ], undefined, () => {});
  assert.equal(failingOptional.outcome, 'failed');
  const unavailableRequired = await runVerification(ws, [
    { checkId: 'typecheck', name: 'typecheck', command: 'ec13-no-such-binary', args: [], cwd: ws, required: true, kind: 'typecheck' },
  ], undefined, () => {});
  assert.equal(unavailableRequired.outcome, 'unverified');
  const passing = await runVerification(ws, [
    { checkId: 'ok', name: 'ok', command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: ws, required: true, kind: 'typecheck' },
  ], undefined, () => {});
  assert.equal(passing.outcome, 'verified');
  const bootFail = await runVerification(ws, [
    { checkId: 'boot', name: 'boot', command: 'ec13-no-such-binary', args: [], cwd: ws, required: true, kind: 'boot' },
  ], undefined, () => {});
  assert.equal(bootFail.outcome, 'failed');
  assert.equal(bootFail.checks[0].status, 'failed');
});

test('auth accepts IPv6 loopback and same-origin, rejects foreign localhost origins', () => {
  const ok1 = checkRequest(new Request('http://[::1]:3000/api/x', { headers: { host: '[::1]:3000' } }));
  assert.equal(ok1.ok, true);
  const ok2 = checkRequest(new Request('http://127.0.0.1:3000/api/x', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } }));
  assert.equal(ok2.ok, true);
  const okNoOrigin = checkRequest(new Request('http://127.0.0.1:3000/api/x', { headers: { host: 'localhost:3000' } }));
  assert.equal(okNoOrigin.ok, true);
  const evil = checkRequest(new Request('http://127.0.0.1:3000/api/x', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://localhost:9999' } }));
  assert.equal(evil.ok, false);
  const dns = checkRequest(new Request('http://attacker.example/api/x', { headers: { host: 'attacker.example' } }));
  assert.equal(dns.ok, false);
  const wildcard = checkRequest(new Request('http://0.0.0.0:3000/api/x', { headers: { host: '0.0.0.0:3000' } }));
  assert.equal(wildcard.ok, false);
});

test('files API returns workspace-relative paths at every depth', async () => {
  const ws = registerWorkspace(fixtureDir('tree-ws'));
  fs.mkdirSync(path.join(ws.path, 'src', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(ws.path, 'src', 'nested', 'file.txt'), 'fixture');
  const { GET } = await import('../src/app/api/files/[id]/route.ts');
  const response = await GET(new Request(`http://127.0.0.1:3000/api/files/${ws.id}?tree=1`, { headers: { host: '127.0.0.1:3000' } }), { params: { id: ws.id } });
  const body = await response.json();
  assert.equal(body.tree[0].children[0].children[0].path, 'src/nested/file.txt');
});

test('runs API pages stable history and rejects workspace/session mismatches', async () => {
  const { GET, POST } = await import('../src/app/api/runs/route.ts');
  const { getOrCreateSession, runs } = await import('../src/server/runs/manager.ts');
  const { writeJsonAtomic } = await import('../src/server/store.ts');
  const ws = registerWorkspace(fixtureDir('history-ws'));
  const other = registerWorkspace(fixtureDir('other-history-ws'));
  getOrCreateSession({ id: 'ses_history', workspaceId: ws.id, workspacePath: ws.path, title: 'Fixture history' });
  const time = '2026-01-01T00:00:00.000Z';
  for (const id of ['run_history_a', 'run_history_b', 'run_history_c']) writeJsonAtomic(dataDir('runs', id + '.json'), {
    id, sessionId: 'ses_history', workspaceId: ws.id, workspacePath: ws.path, createdAt: time, updatedAt: time, state: 'succeeded', mode: 'ask', task: 'fixture', finalText: id,
  });
  const request = (query) => new Request('http://127.0.0.1:3000/api/runs?' + query, { headers: { host: '127.0.0.1:3000' } });
  const first = await (await GET(request('sessionId=ses_history&limit=2'))).json();
  assert.deepEqual(first.runs.map((r) => r.id), ['run_history_c', 'run_history_b']);
  assert.equal(first.hasMore, true);
  const second = await (await GET(request('sessionId=ses_history&limit=2&before=' + first.nextBefore))).json();
  assert.deepEqual(second.runs.map((r) => r.id), ['run_history_a']);
  assert.equal(second.hasMore, false);
  const wrong = await POST(new Request('http://127.0.0.1:3000/api/runs', { method: 'POST', headers: { host: '127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: other.id, sessionId: 'ses_history', task: 'fixture' }) }));
  assert.equal(wrong.status, 409);
  assert.equal(runs.activeForWorkspace(other.path), undefined);
});

test('recovery applies only matching before-images and preserves newer disk content', () => {
  const ws = registerWorkspace(fixtureDir('recovery-ws'));
  const env = { workspacePath: ws.path, runId: 'run_recovery', sessionId: 'ses_recovery', reviewMode: true };
  fs.writeFileSync(path.join(ws.path, 'f.txt'), 'before');
  const change = journal.writeFile(env, 'f.txt', 'after').record;
  const file = dataDir('changes', change.changeId + '.json');
  fs.writeFileSync(file, JSON.stringify({ ...change, status: 'applying' }));
  assert.equal(journal.recoverUnfinished(), 1);
  assert.equal(fs.readFileSync(path.join(ws.path, 'f.txt'), 'utf8'), 'after');
  const created = journal.writeFile(env, 'new.txt', 'planned').record;
  fs.writeFileSync(path.join(ws.path, 'new.txt'), 'external');
  fs.writeFileSync(dataDir('changes', created.changeId + '.json'), JSON.stringify({ ...created, status: 'applying' }));
  assert.equal(journal.recoverUnfinished(), 0);
  assert.equal(journal.getChange(created.changeId).status, 'conflict');
  assert.equal(fs.readFileSync(path.join(ws.path, 'new.txt'), 'utf8'), 'external');
});

test('terminal API reports execution and reconciliation, and rejects active runs', async (t) => {
  const { POST } = await import('../src/app/api/exec/route.ts');
  const { runs } = await import('../src/server/runs/manager.ts');
  const ws = registerWorkspace(fixtureDir('terminal-ws'));
  const request = () => new Request('http://127.0.0.1:3000/api/exec', { method: 'POST', headers: { host: '127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, command: "[Console]::Write('fixture-ok')", timeoutMs: 5000 }) });
  const result = await (await POST(request())).json();
  assert.equal(result.commandOk, true);
  assert.equal(result.output, 'fixture-ok');
  assert.equal(result.reconciliation.ok, true);
  assert.equal(journal.workspaceLocked(ws.path), false);
  t.mock.method(runs, 'activeForWorkspace', () => ({ id: 'run_busy', state: 'generating' }));
  assert.equal((await POST(request())).status, 409);
});

test('model routes resolve stored credentials without returning keys', async (t) => {
  const { storeCredential, resolveApiKey } = await import('../src/server/security/secrets.ts');
  const models = await import('../src/app/api/models/route.ts');
  const info = await import('../src/app/api/model-info/route.ts');
  const baseUrl = 'https://models.fixture.invalid/v1';
  const { keyRef } = storeCredential(baseUrl, 'fixture-only-key');
  assert.equal(resolveApiKey('https://different.fixture.invalid/v1', '', keyRef), '');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer fixture-only-key');
    calls++;
    return Response.json({ data: [{ id: 'fixture-model', context_length: 4096 }] });
  });
  const response = await models.GET(new Request('http://127.0.0.1:3000/api/models?baseUrl=' + encodeURIComponent(baseUrl), { headers: { host: '127.0.0.1:3000' } }));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(calls > 0);
  assert.equal(JSON.stringify(body).includes('fixture-only-key'), false);
  const metadata = await (await info.POST(new Request('http://127.0.0.1:3000/api/model-info', { method: 'POST', headers: { host: '127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, model: 'fixture-model' }) }))).json();
  assert.equal(metadata.contextWindow, 4096);
});

test('incomplete snapshots cannot turn pre-existing files into revertible creates', () => {
  const ws = registerWorkspace(fixtureDir('incomplete-ws'));
  fs.writeFileSync(path.join(ws.path, 'existing.txt'), 'before');
  const before = journal.snapshotWorkspace(ws.path);
  before.files.clear(); before.complete = false; before.skipped++;
  fs.writeFileSync(path.join(ws.path, 'existing.txt'), 'after');
  const env = { workspacePath: ws.path, runId: 'run_incomplete', sessionId: 'ses_incomplete', reviewMode: false };
  const change = journal.reconcileShellChanges(env, before, 'fixture').changes[0];
  assert.equal(change.operation, 'modify');
  assert.equal(journal.revertChange(change.changeId, env).ok, false);
  assert.equal(fs.readFileSync(path.join(ws.path, 'existing.txt'), 'utf8'), 'after');
});

test('workspace lock serializes mutations per workspace', async () => {
  const { withWorkspaceLock } = journal;
  const order = [];
  const p1 = withWorkspaceLock('k', async () => { await new Promise((r) => setTimeout(r, 30)); order.push(1); });
  const p2 = withWorkspaceLock('k', async () => { order.push(2); });
  await Promise.all([p1, p2]);
  assert.deepEqual(order, [1, 2]);
});
