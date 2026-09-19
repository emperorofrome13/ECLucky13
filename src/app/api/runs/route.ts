import { checkRequest, forbidden } from '@/server/security/auth';
import { getWorkspace } from '@/server/workspace/path-policy';
import { runs, listRuns, getOrCreateSession, loadSession } from '@/server/runs/manager';
import { normalizeSettings } from '@/shared/settings-schema';
import { canonicalizeStages } from '@/shared/stage-definitions';
import { validPersistentId } from '@/server/store';
import { resolveAttachments } from '@/server/attachments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') || '';
  if (sessionId && !validPersistentId(sessionId)) return Response.json({ ok: false, error: 'Invalid session ID.' }, { status: 400 });
  const limit = Number(url.searchParams.get('limit') || 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return Response.json({ ok: false, error: 'limit must be an integer between 1 and 1000.' }, { status: 400 });
  runs.ensureRecovered();
  let records = listRuns().filter((r) => !sessionId || r.sessionId === sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const before = url.searchParams.get('before');
  if (before) {
    const index = records.findIndex((r) => r.id === before);
    if (index >= 0) records = records.slice(index + 1);
    else if (Number.isFinite(Date.parse(before))) records = records.filter((r) => r.createdAt < new Date(before).toISOString());
    else return Response.json({ ok: false, error: 'Unknown history cursor.' }, { status: 400 });
  }
  const hasMore = records.length > limit;
  const page = records.slice(0, limit);
  return Response.json({ ok: true, runs: page.map((r) => runs.get(r.id) || r), hasMore, nextBefore: hasMore ? page[page.length - 1].id : null });
}

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const workspaceId = String(body.workspaceId || '');
  const ws = getWorkspace(workspaceId);
  if (!ws) return Response.json({ ok: false, error: 'Unknown or unregistered workspace. Register it first.' }, { status: 400 });

  const task = String(body.task || '').trim();
  if (!task) return Response.json({ ok: false, error: 'A task is required.' }, { status: 400 });

  const settings = normalizeSettings(body.settings);
  settings.autoPrompt.stages = canonicalizeStages(settings.autoPrompt.stages);
  const mode = ['ask', 'plan', 'code'].includes(body.mode) ? body.mode : settings.mode;
  const clientRequestId = String(body.clientRequestId || '') || ('req_' + Date.now());
  const sessionId = String(body.sessionId || '');
  if (sessionId && !validPersistentId(sessionId)) return Response.json({ ok: false, error: 'Invalid session ID.' }, { status: 400 });
  const existingSession = sessionId ? loadSession(sessionId) : undefined;
  if (existingSession?.deletedAt) return Response.json({ ok: false, error: 'This session was deleted. Start a new session or undo deletion.' }, { status: 409 });
  if (existingSession && (existingSession.workspaceId !== ws.id || existingSession.workspacePath !== ws.path)) return Response.json({ ok: false, error: 'Session belongs to another workspace.' }, { status: 409 });
  let attachmentIds: string[];
  try { attachmentIds = resolveAttachments(body.attachmentIds ?? [], ws.id).map(a => a.id); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }

  const session = getOrCreateSession({ id: sessionId || undefined, workspaceId: ws.id, workspacePath: ws.path, title: task.slice(0, 60) });
  const created = runs.create({ clientRequestId, sessionId: session.id, workspaceId: ws.id, workspacePath: ws.path, mode, task, attachmentIds, settings });
  if (!created.ok) return Response.json({ ok: false, error: (created as { error: string }).error, runId: (created as { record?: { id: string } }).record?.id }, { status: 409 });
  return Response.json({ ok: true, runId: created.record.id, sessionId: session.id, state: created.record.state });
}

