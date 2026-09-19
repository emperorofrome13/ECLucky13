import { checkRequest, forbidden } from '@/server/security/auth';
import { getChange } from '@/server/workspace/change-journal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const c = getChange(params.id);
  if (!c) return Response.json({ ok: false, error: 'Unknown change.' }, { status: 404 });
  return Response.json({ ok: true, change: c });
}
