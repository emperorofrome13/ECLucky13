import { checkRequest, forbidden } from '@/server/security/auth';
import { storeCredential } from '@/server/security/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const baseUrl = String(body.baseUrl || '').trim();
  if (!baseUrl) return Response.json({ ok: false, error: 'baseUrl required' }, { status: 400 });
  const { keyRef } = storeCredential(baseUrl, String(body.apiKey || ''));
  return Response.json({ ok: true, keyRef });
}