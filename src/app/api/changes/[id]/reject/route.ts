import { checkRequest, forbidden } from '@/server/security/auth';
import { getChange, rejectChange, workspaceLocked } from '@/server/workspace/change-journal';
import { runs } from '@/server/runs/manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const change = getChange(params.id);
  if (!change?.workspacePath) return Response.json({ ok: false, error: 'Unknown change or workspace.' }, { status: 404 });
  runs.ensureRecovered();
  const active = runs.activeForWorkspace(change.workspacePath);
  if (workspaceLocked(change.workspacePath) || (active && (active.id !== change.runId || active.state !== 'waiting_for_approval'))) return Response.json({ ok: false, error: 'Wait for the workspace operation to finish.' }, { status: 409 });
  const r = rejectChange(params.id);
  return Response.json({ ok: r.ok, error: r.error, invalidatedChangeIds: r.invalidatedChangeIds }, { status: r.ok ? 200 : 400 });
}
