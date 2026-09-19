import fs from 'node:fs';
import { Readable } from 'node:stream';
import { checkRequest, forbidden } from '@/server/security/auth';
import { validPersistentId } from '@/server/store';
import { artifactFile, getOutputArtifact } from '@/server/output-artifacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string; artifactId: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  if (!validPersistentId(params.id) || !validPersistentId(params.artifactId)) return Response.json({ ok: false, error: 'Invalid artifact ID.' }, { status: 400 });
  try {
    const meta = getOutputArtifact(params.id, params.artifactId);
    if (!meta) return Response.json({ ok: false, error: 'Output artifact not found in this run.' }, { status: 404 });
    const handle = await fs.promises.open(artifactFile(params.id, params.artifactId), 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) { await handle.close(); throw new Error('Not a file.'); }
    if (!stat.size) { await handle.close(); return new Response('', { headers: { 'Cache-Control': 'no-store' } }); }
    const stream = handle.createReadStream({ start: 0, end: stat.size - 1, autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${params.artifactId}.jsonl"`,
      'Content-Length': String(stat.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return Response.json({ ok: false, error: 'Output artifact is unavailable.' }, { status: 404 });
  }
}
