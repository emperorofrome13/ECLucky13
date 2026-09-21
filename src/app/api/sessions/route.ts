import { checkRequest, forbidden } from '@/server/security/auth';
import { listSessions, updateSession, setSessionDeleted } from '@/server/runs/manager';
import { validPersistentId } from '@/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function view(session: ReturnType<typeof listSessions>[number]) {
  return { id: session.id, title: session.title, pinned: !!session.pinned, workspaceId: session.workspaceId, workspacePath: session.workspacePath, createdAt: session.createdAt, updatedAt: session.updatedAt, turnCount: session.conversation.messages.filter((m) => m.role === 'user').length, originalTask: session.conversation.originalTask || '' };
}

export function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const url = new URL(req.url);
  return Response.json({ ok: true, sessions: listSessions(url.searchParams.get('workspaceId') || undefined, url.searchParams.get('q') || '').map(view) });
}

export async function PATCH(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  if (!validPersistentId(body?.id)) return Response.json({ ok: false, error: 'Invalid session ID.' }, { status: 400 });
  if (body.restore === true) {
    const result = setSessionDeleted(String(body.id || ''), false);
    return result.ok ? Response.json({ ok: true, session: view(result.session) }) : Response.json(result, { status: result.status });
  }
  const session = updateSession(String(body.id || ''), { ...(typeof body.title === 'string' ? { title: body.title } : {}), ...(typeof body.pinned === 'boolean' ? { pinned: body.pinned } : {}) });
  if (!session) return Response.json({ ok: false, error: 'Session not found.' }, { status: 404 });
  return Response.json({ ok: true, session: view(session) });
}

export async function DELETE(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const result = setSessionDeleted(String(body.id || ''), true);
  return result.ok ? Response.json({ ok: true }) : Response.json(result, { status: result.status });
}
