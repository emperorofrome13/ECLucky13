import { checkRequest, forbidden } from '@/server/security/auth';
import { compactStoredSession, loadSession, runs } from '@/server/runs/manager';
import { validPersistentId } from '@/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const { id } = await params;
  if (!validPersistentId(id)) return Response.json({ ok: false, error: 'Invalid session ID.' }, { status: 400 });
  if ((body.contextWindow !== undefined && !Number.isFinite(Number(body.contextWindow))) || (body.keepRecentTurns !== undefined && !Number.isFinite(Number(body.keepRecentTurns)))) return Response.json({ ok: false, error: 'Compaction limits must be finite numbers.' }, { status: 400 });
  const session = loadSession(id);
  if (session && runs.activeForWorkspace(session.workspacePath)) return Response.json({ ok: false, error: 'Wait for the current run to finish before compacting this session.' }, { status: 409 });
  const contextWindow = Math.max(512, Math.floor(Number(body.contextWindow) || 65536));
  const keepRecentTurns = Math.max(1, Math.min(20, Math.floor(Number(body.keepRecentTurns) || 4)));
  const compacted = compactStoredSession(id, contextWindow, keepRecentTurns);
  if (!compacted) return Response.json({ ok: false, error: 'Session not found.' }, { status: 404 });
  const { result } = compacted;
  return Response.json({ ok: true, ...result, message: result.compacted ? `Compacted ${result.earlierTurns} earlier turns into a ${result.summaryTokens.toLocaleString()}-token summary.` : `Nothing eligible to compact; the most recent ${keepRecentTurns} turns are kept.` });
}
