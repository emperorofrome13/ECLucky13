import { checkRequest, forbidden } from '@/server/security/auth';
import { getCatalog } from '@/server/providers/model-discovery';
import { resolveApiKey } from '@/server/security/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const baseUrl = String(body.baseUrl || 'http://127.0.0.1:1234/v1');
  const apiKey = String(body.apiKey || '');
  const model = String(body.model || '');
  if (!model) return Response.json({ ok: false, error: 'no model given' });
  try {
    const c = await getCatalog(baseUrl, resolveApiKey(baseUrl, apiKey));
    const meta = c.catalog[model];
    if (meta?.ctx) return Response.json({ ok: true, model, contextWindow: meta.ctx, maxTokens: meta.maxOut || meta.ctx, source: c.source });
    return Response.json({ ok: false, model, error: 'This server does not report context size for the model. Set it manually.' });
  } catch (e: any) {
    return Response.json({ ok: false, model, error: String(e?.message || e) });
  }
}