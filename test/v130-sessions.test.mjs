import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('test-output', { recursive: true });
process.env.EC12_DATA_DIR = fs.mkdtempSync(path.resolve('test-output/session-multiws-'));
const { getOrCreateSession, listSessions, loadSession } = await import('../src/server/runs/manager.ts');

test('sessions in different workspaces coexist and list globally', () => {
  const a = getOrCreateSession({ id: 'ses_ws_a', workspaceId: 'ws_a', workspacePath: 'C:\\proj\\a', title: 'A task' });
  const b = getOrCreateSession({ id: 'ses_ws_b', workspaceId: 'ws_b', workspacePath: 'C:\\proj\\b', title: 'B task' });
  assert.equal(a.workspacePath, 'C:\\proj\\a');
  assert.equal(b.workspacePath, 'C:\\proj\\b');
  // Global list (what the sidebar shows): both present, so no workspace hides another.
  const all = listSessions();
  assert.ok(all.some((s) => s.id === 'ses_ws_a'), 'ws A session listed globally');
  assert.ok(all.some((s) => s.id === 'ses_ws_b'), 'ws B session listed globally');
  // Scoped list still works for callers that pass a workspace.
  assert.deepEqual(listSessions('ws_a').map((s) => s.id), ['ses_ws_a']);
  assert.deepEqual(listSessions('ws_b').map((s) => s.id), ['ses_ws_b']);
  // Records carry the workspace path the UI needs to switch context on open.
  assert.equal(loadSession('ses_ws_b')?.workspacePath, 'C:\\proj\\b');
});
