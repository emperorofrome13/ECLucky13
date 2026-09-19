import { checkRequest, forbidden } from '@/server/security/auth';
import { discoverModels } from '@/server/providers/model-discovery';
import { resolveApiKey } from '@/server/security/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function respond(baseUrl: string, apiKey: string) {
  try {
    const catalog = await discoverModels(baseUrl, resolveApiKey(baseUrl, apiKey)); const loaded = catalog.loaded;
    return Response.json({ ok: true, models: catalog.models, loaded, catalog: catalog.catalog, source: catalog.source });
  } catch (e: any) {
    return Response.json({ ok: false, models: [], loaded: [], catalog: {}, error: String(e?.message || e) }, { status: 200 });
  }
}

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const url = new URL(req.url);
  const baseUrl = url.searchParams.get('baseUrl') || 'http://127.0.0.1:1234/v1';
  // API keys are never accepted in URL query strings; POST the body or store server-side.
  const apiKey = '';
  return respond(baseUrl, apiKey);
}

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  return respond(String(body.baseUrl || 'http://127.0.0.1:1234/v1'), String(body.apiKey || ''));
}
