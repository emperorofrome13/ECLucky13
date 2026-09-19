import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('test-output', { recursive: true });
process.env.EC12_DATA_DIR = fs.mkdtempSync(path.resolve('test-output/session-delete-'));
const { getOrCreateSession, setSessionDeleted, listSessions, loadSession, runs } = await import('../src/server/runs/manager.ts');

test('delete hides a chat, preserves its data, blocks reuse, and supports undo', () => {
  const input={id:'ses_delete_test',workspaceId:'ws_test',workspacePath:process.cwd(),title:'Delete fixture'};
  getOrCreateSession(input);
  assert.equal(setSessionDeleted(input.id,true).ok,true);
  assert.equal(listSessions('ws_test').length,0);
  assert.ok(loadSession(input.id).deletedAt);
  assert.throws(()=>getOrCreateSession(input),/deleted/);
  assert.equal(setSessionDeleted(input.id,false).ok,true);
  assert.equal(listSessions('ws_test')[0].title,'Delete fixture');
  assert.equal(loadSession(input.id).deletedAt,undefined);
});

test('running sessions and invalid IDs cannot be deleted', (t) => {
  t.mock.method(runs,'activeForWorkspace',()=>({sessionId:'ses_delete_test'}));
  assert.equal(setSessionDeleted('ses_delete_test',true).status,409);
  assert.equal(loadSession('ses_delete_test').deletedAt,undefined);
  assert.equal(setSessionDeleted('../workspaces',true).status,400);
  assert.equal(setSessionDeleted('ses_missing',true).status,404);
});
