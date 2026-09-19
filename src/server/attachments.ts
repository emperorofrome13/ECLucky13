import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, writeJsonAtomic, assertPersistentId } from './store';
import type { ChatMessage } from './providers/openai-compatible';

export interface Attachment { id: string; name: string; mime: string; size: number; url: string; workspaceId: string; text?: string }
export interface AttachmentSettings { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxTextChars: number }
const defaults: AttachmentSettings = { maxFiles: 20, maxFileBytes: 20 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxTextChars: 500000 };
export function attachmentSettings(): AttachmentSettings { return { ...defaults, ...readJson<Partial<AttachmentSettings>>(dataDir('attachments', 'settings.json'), {}) }; }
export function saveAttachmentSettings(input: unknown): AttachmentSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Attachment settings must be an object.');
  const settings = attachmentSettings();
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaults) || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Attachment limits must be nonnegative integers; zero means unlimited.');
    settings[key as keyof AttachmentSettings] = value;
  }
  writeJsonAtomic(dataDir('attachments', 'settings.json'), settings);
  return settings;
}
export function publicAttachment(a: Attachment) { return { id: a.id, name: a.name, mime: a.mime, size: a.size, url: a.url }; }
export function getAttachment(id: string): Attachment | undefined {
  assertPersistentId(id);
  return readJson<Attachment | undefined>(dataDir('attachments', id + '.json'), undefined);
}
export function attachmentBytes(id: string): Buffer { assertPersistentId(id); return fs.readFileSync(dataDir('attachments', id + '.bin')); }
export function resolveAttachments(ids: unknown, workspaceId: string): Attachment[] {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('attachmentIds must be an array of strings.');
  return [...new Set(ids as string[])].map(id => {
    const attachment = getAttachment(id);
    if (!attachment || attachment.workspaceId !== workspaceId) throw new Error('Attachment not found in this workspace: ' + id);
    return attachment;
  });
}
function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
}
export async function storeAttachments(files: File[], workspaceId: string): Promise<Attachment[]> {
  const limits = attachmentSettings();
  if (!files.length) throw new Error('Choose at least one file.');
  if (limits.maxFiles && files.length > limits.maxFiles) throw new Error(`At most ${limits.maxFiles} attachments per upload.`);
  if (limits.maxTotalBytes && files.reduce((n, file) => n + file.size, 0) > limits.maxTotalBytes) throw new Error('Upload exceeds maxTotalBytes.');
  const prepared: Array<{ record: Attachment; bytes: Buffer }> = [];
  for (const file of files) {
    if (limits.maxFileBytes && file.size > limits.maxFileBytes) throw new Error(`${file.name}: exceeds maxFileBytes.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    let mime = imageMime(bytes);
    let text: string | undefined;
    if (!mime) {
      if (/\.doc$/i.test(file.name) || file.type === 'application/msword') throw new Error(`${file.name}: legacy .doc documents are unsupported. Convert to DOCX or UTF-8 text.`);
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf' || bytes.subarray(0, 5).toString() === '%PDF-') {
        const { PDFParse } = await import('pdf-parse');
        try {
          const parser = new PDFParse({ data: new Uint8Array(bytes) });
          try { text = (await parser.getText({ pageJoiner: '' })).text; }
          finally { await parser.destroy(); }
        } catch (error) {
          throw new Error(`${file.name}: PDF extraction failed: malformed, encrypted or unsupported PDF document. ${error instanceof Error ? error.message : String(error)}`);
        }
        mime = 'application/pdf';
      } else if (/\.docx$/i.test(file.name) || /wordprocessingml/.test(file.type)) {
        const mammoth = await import('mammoth');
        try {
          const result = await mammoth.extractRawText({ buffer: bytes });
          const errors = result.messages.filter(message => message.type === 'error');
          if (errors.length) throw new Error(errors.map(message => message.message).join('; '));
          text = result.value;
        } catch (error) {
          throw new Error(`${file.name}: DOCX extraction failed: malformed or unsupported DOCX document. ${error instanceof Error ? error.message : String(error)}`);
        }
        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else {
        if (file.type.startsWith('image/')) throw new Error(`${file.name}: unsupported or invalid image. Use PNG, JPEG, GIF or WebP.`);
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error(`${file.name}: unsupported binary document. Use UTF-8 text.`); }
        if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) throw new Error(`${file.name}: unsupported binary document.`);
        mime = 'text/plain';
      }
      if (mime !== 'text/plain' && !text.trim()) throw new Error(`${file.name}: document contains no extractable text (empty or image-only/scanned). OCR is unsupported; upload a text-based document.`);
      if (limits.maxTextChars && text.length > limits.maxTextChars) throw new Error(`${file.name}: extracted text exceeds maxTextChars.`);
    }
    const id = 'att_' + randomUUID().replace(/-/g, '');
    prepared.push({ bytes, record: { id, name: file.name.replace(/[\x00-\x1f]/g, '').split(/[\\/]/).pop() || 'attachment', mime, size: bytes.length, workspaceId, url: `/api/attachments/${id}`, ...(text !== undefined ? { text } : {}) } });
  }
  try {
    for (const { record, bytes } of prepared) {
      fs.writeFileSync(dataDir('attachments', record.id + '.bin'), bytes);
      writeJsonAtomic(dataDir('attachments', record.id + '.json'), record);
    }
  } catch (error) {
    for (const { record } of prepared) for (const extension of ['.bin', '.json']) fs.rmSync(dataDir('attachments', record.id + extension), { force: true });
    throw error;
  }
  return prepared.map(p => p.record);
}
export function attachmentMessage(task: string, ids: string[], workspaceId: string): ChatMessage {
  const attachments = resolveAttachments(ids, workspaceId);
  return {
    role: 'user',
    content: [task, ...attachments.map(a => a.text !== undefined ? `Attached document: ${a.name}\n<attachment-content>\n${a.text}\n</attachment-content>` : `Attached image: ${a.name}`)].join('\n\n'),
    attachmentIds: attachments.map(a => a.id),
    images: attachments.filter(a => a.mime.startsWith('image/')).map(a => ({ url: `data:${a.mime};base64,${attachmentBytes(a.id).toString('base64')}` })),
  };
}
