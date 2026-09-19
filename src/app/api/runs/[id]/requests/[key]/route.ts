import { checkRequest, forbidden } from '@/server/security/auth';
import { validPersistentId } from '@/server/store';
import { findRequestPayload } from '@/server/request-payloads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// On-demand full model-request payload. The event log and compact replays carry
// only summaries; the complete payload (current sidecar file, or the embedded copy
// in older logs) is served here when the user explicitly downloads it.
export async function GET(req: Request, { params }: { params: { id: string; key: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  if (!validPersistentId(params.id) || !validPersistentId(params.key)) return Response.json({ ok: false, error: 'Invalid request ID.' }, { status: 400 });
  const payload = findRequestPayload(params.id, params.key);
  if (payload === undefined) return Response.json({ ok: false, error: 'Request payload not found for this run.' }, { status: 404 });
  return new Response(JSON.stringify(payload, null, 2), { headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="request-${params.key}.json"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
