import { checkRequest, forbidden } from '@/server/security/auth';
import { runs } from '@/server/runs/manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const r = runs.cancel(params.id);
  return Response.json({ ok: r.ok, error: r.error }, { status: r.ok ? 200 : 409 });
}
