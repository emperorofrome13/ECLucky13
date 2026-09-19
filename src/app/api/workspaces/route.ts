import { checkRequest, forbidden } from '@/server/security/auth';
import { listWorkspaces, registerWorkspace } from '@/server/workspace/path-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  return Response.json({ ok: true, workspaces: listWorkspaces() });
}

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const p = String(body.path || '').trim();
  if (!p) return Response.json({ ok: false, error: 'path required' }, { status: 400 });
  try {
    const ws = registerWorkspace(p);
    return Response.json({ ok: true, workspace: ws });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
