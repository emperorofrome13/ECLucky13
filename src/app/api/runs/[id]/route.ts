import { checkRequest, forbidden } from '@/server/security/auth';
import { runs } from '@/server/runs/manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const record = runs.get(params.id);
  if (!record) return Response.json({ ok: false, error: 'Unknown run.' }, { status: 404 });
  return Response.json({ ok: true, run: record });
}
