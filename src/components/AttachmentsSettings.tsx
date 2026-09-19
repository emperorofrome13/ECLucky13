'use client';
import { useEffect, useState } from 'react';

interface Limits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxTextChars: number }
const FIELDS: Array<{ key: keyof Limits; label: string; hint: string }> = [
  { key: 'maxFiles', label: 'Max files per upload', hint: '0 = unlimited' },
  { key: 'maxFileBytes', label: 'Max size per file (bytes)', hint: '0 = unlimited' },
  { key: 'maxTotalBytes', label: 'Max total upload size (bytes)', hint: '0 = unlimited' },
  { key: 'maxTextChars', label: 'Max text characters per document', hint: '0 = unlimited' },
];

export default function AttachmentsSettings() {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [supported, setSupported] = useState<string[]>([]);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/attachments').then(async (r) => {
      const d = await r.json();
      if (!alive) return;
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not load attachment limits.');
      setLimits(d.settings); setSupported(d.supported || []); setUnsupported(d.unsupported || []);
    }).catch((e) => { if (alive) setStatus(e.message); });
    return () => { alive = false; };
  }, []);
  const save = async () => {
    if (!limits || busy) return;
    setBusy(true); setStatus('');
    try {
      const r = await fetch('/api/attachments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(limits) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not save attachment limits.');
      setLimits(d.settings); setStatus('Attachment limits saved.');
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save attachment limits.'); }
    finally { setBusy(false); }
  };
  if (!limits) return <p className="hint" role="status">{status || 'Loading attachment limits…'}</p>;
  return <div className="attachments-settings">
    <b>Attachment limits</b>
    {FIELDS.map((field) => <label key={field.key}>{field.label}
      <input type="number" min={0} value={limits[field.key]} aria-label={field.label}
        onChange={(e) => setLimits({ ...limits, [field.key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
      <span className="hint">{field.hint}</span></label>)}
    <p className="hint">Images: {supported.filter((m) => m.startsWith('image/')).join(', ') || 'none'}. Documents: {supported.filter((m) => !m.startsWith('image/')).join(', ') || 'none'}. Not supported: {unsupported.join(', ') || 'none'}.</p>
    {status && <p role="status" className="hint">{status}</p>}
    <button className="btn primary sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save attachment limits'}</button>
  </div>;
}
