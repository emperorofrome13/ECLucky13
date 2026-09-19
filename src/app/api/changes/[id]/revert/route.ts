import { checkRequest, forbidden } from '@/server/security/auth';
import { runs } from '@/server/runs/manager';
import { getChange, revertChange, workspaceLocked, type JournalEnv } from '@/server/workspace/change-journal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const change = getChange(params.id);
  if (!change) return Response.json({ ok: false, error: 'Unknown change.' }, { status: 404 });
  const wsPath = change.workspacePath || runs.get(change.runId)?.workspacePath;
  if (!wsPath) return Response.json({ ok: false, error: 'Change has no recorded workspace.' }, { status: 400 });
  runs.ensureRecovered();
  if (workspaceLocked(wsPath) || runs.activeForWorkspace(wsPath)) return Response.json({ ok: false, error: 'Wait for the workspace operation to finish.' }, { status: 409 });
  const env: JournalEnv = { workspacePath: wsPath, runId: change.runId, sessionId: change.sessionId, reviewMode: false };
  const r = revertChange(params.id, env);
  return Response.json({ ok: r.ok, error: r.error, conflict: r.conflict }, { status: r.ok ? 200 : r.conflict ? 409 : 400 });
}
