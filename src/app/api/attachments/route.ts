import { checkRequest, forbidden } from '@/server/security/auth';
import { getWorkspace } from '@/server/workspace/path-policy';
import { attachmentSettings, saveAttachmentSettings, storeAttachments, publicAttachment } from '@/server/attachments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  return Response.json({ ok: true, settings: attachmentSettings(), supported: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], unsupported: ['application/msword'] });
}
export async function PATCH(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try { return Response.json({ ok: true, settings: saveAttachmentSettings(await req.json()) }); }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  try {
    const form = await req.formData();
    const workspaceId = String(form.get('workspaceId') || '');
    if (!getWorkspace(workspaceId)) throw new Error('Register a workspace before uploading attachments.');
    const values = form.getAll('files');
    if (values.some(value => typeof value === 'string')) throw new Error('files must contain uploaded files.');
    const attachments = await storeAttachments(values as File[], workspaceId);
    return Response.json({ ok: true, attachments: attachments.map(publicAttachment) });
  } catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
