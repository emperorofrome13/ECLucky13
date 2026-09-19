import { checkRequest, forbidden } from '@/server/security/auth';
import { attachmentBytes, getAttachment } from '@/server/attachments';
import { validPersistentId } from '@/server/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  if (!validPersistentId(params.id)) return Response.json({ ok: false, error: 'Invalid attachment ID.' }, { status: 400 });
  const attachment = getAttachment(params.id);
  if (!attachment) return Response.json({ ok: false, error: 'Attachment not found.' }, { status: 404 });
  return new Response(new Uint8Array(attachmentBytes(attachment.id)), { headers: {
    'Content-Type': attachment.mime,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  } });
}
