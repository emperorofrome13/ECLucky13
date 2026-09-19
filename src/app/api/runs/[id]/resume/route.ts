import { checkRequest, forbidden } from '@/server/security/auth';
import { runs } from '@/server/runs/manager';
import { normalizeSettings } from '@/shared/settings-schema';
import { listChanges, workspaceLocked } from '@/server/workspace/change-journal';
import { validPersistentId } from '@/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  if (!validPersistentId(params.id)) return Response.json({ ok: false, error: 'Invalid run ID.' }, { status: 400 });
  const record = runs.get(params.id);
  if (!record) return Response.json({ ok: false, error: 'Unknown run.' }, { status: 404 });
  if (workspaceLocked(record.workspacePath)) return Response.json({ ok: false, error: 'Wait for the workspace operation to finish.' }, { status: 409 });
  if (listChanges(record.sessionId).some((c) => c.runId === record.id && (c.status === 'conflict' || c.status === 'applying'))) return Response.json({ ok: false, error: 'This run has unresolved change conflicts. Start a new run after reviewing them.' }, { status: 409 });
  const settings = normalizeSettings(body.settings);
  const r = await runs.resumeAfterApproval(params.id, settings);
  return Response.json({ ok: r.ok, error: r.error }, { status: r.ok ? 200 : 409 });
}
