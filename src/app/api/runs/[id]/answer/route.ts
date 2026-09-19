import { checkRequest, forbidden } from '@/server/security/auth';
import { runs } from '@/server/runs/manager';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const result = runs.answer(params.id, String(body.answer || ''));
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
