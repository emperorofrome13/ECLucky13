'use client';
import { useEffect, useState } from 'react';

export interface UIAttachment { id: string; name: string; mime: string; size: number; url: string }

function AttachmentCard({ item: saved, onRemove }: { item: UIAttachment; onRemove?: (id: string) => void }) {
  const [metadata, setMetadata] = useState<Partial<UIAttachment>>({});
  const item = { ...saved, ...metadata };
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (saved.mime) return;
    const controller = new AbortController();
    fetch(`/api/attachments/${encodeURIComponent(saved.id)}`, { signal: controller.signal }).then(async (r) => {
      if (!r.ok) throw new Error('Saved attachment unavailable. Try downloading it again.');
      const disposition = r.headers.get('content-disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
      const blob = await r.blob();
      if (!controller.signal.aborted) setMetadata({ mime: blob.type, size: blob.size, name: encoded ? decodeURIComponent(encoded) : plain || saved.name });
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [saved.id, saved.mime, saved.name]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const url = `/api/attachments/${encodeURIComponent(item.id)}`;
  useEffect(() => {
    if (!open || item.mime.startsWith('image/')) return;
    const controller = new AbortController();
    setText(null); setError('');
    fetch(url, { signal: controller.signal }).then(async (r) => {
      if (!r.ok) throw new Error('Preview unavailable. Download the original file or retry.');
      const mime = r.headers.get('content-type') || item.mime;
      if (!mime.startsWith('text/') && !/json|xml/.test(mime)) throw new Error('This document has no text preview. Download the original file.');
      return r.text();
    }).then(setText).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [open, url, item.mime]);
  return <div className="attachment-card">
    {item.mime.startsWith('image/') && <img src={url} alt={item.name} onError={() => setError('Image preview unavailable. Try downloading the original.')} />}
    <div><b>{item.name}</b><span className="hint">{item.size >= 0 ? `${item.size.toLocaleString()} bytes` : 'Saved attachment'}</span></div>
    <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide preview' : 'Preview'} {item.name}</button>
    <a className="btn sm" href={url} download={item.name}>Download</a>
    {onRemove && <button className="btn sm" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>Remove</button>}
    {error && <p role="alert">{error}</p>}
    {open && (item.mime.startsWith('image/') ? <img className="attachment-expanded" src={url} alt={`Full preview of ${item.name}`} /> : <pre className="attachment-preview">{text ?? (error || 'Loading preview…')}</pre>)}
  </div>;
}

export default function AttachmentList({ attachments, onRemove }: { attachments: UIAttachment[]; onRemove?: (id: string) => void }) {
  return attachments.length ? <div className="attachment-list" aria-label="Attachments">{attachments.map((item) => <AttachmentCard key={item.id} item={item} onRemove={onRemove} />)}</div> : null;
}

export function recordAttachments(record: { attachments?: UIAttachment[]; attachmentIds?: string[] }): UIAttachment[] {
  return record.attachments || (record.attachmentIds || []).map((id) => ({ id, name: id, mime: '', size: -1, url: `/api/attachments/${encodeURIComponent(id)}` }));
}
