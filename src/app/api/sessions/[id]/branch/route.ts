import { checkRequest, forbidden } from '@/server/security/auth';
import { branchSession } from '@/server/runs/manager';
import { validPersistentId } from '@/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try {
    const body = await req.json();
    if (!validPersistentId(params.id) || !validPersistentId(body.runId)) throw new Error('Valid session and run IDs are required.');
    if (body.task !== undefined && typeof body.task !== 'string') throw new Error('task must be text.');
    if (body.retry !== undefined && typeof body.retry !== 'boolean') throw new Error('retry must be a boolean.');
    return Response.json(branchSession(params.id, body));
  } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
