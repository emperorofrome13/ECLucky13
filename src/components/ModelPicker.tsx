'use client';
// Searchable model picker: scopes (recent/loaded/all/hidden), vendor filter, grouping, hide models,
// hide variant checkpoints, keyboard nav. Catalog metadata (context/price) comes from /api/models.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

type ModelMeta = { ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number; desc?: string };

export interface Catalog { models: string[]; loaded: string[]; catalog: Record<string, { ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number; desc?: string }> }

function fmtCtx(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return (n % 1_000_000 === 0 ? n / 1_000_000 : (n / 1_000_000).toFixed(1)) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

export default function ModelPicker(props: {
  value: string; models: string[]; loaded: string[]; catalog: Record<string, any>;
  recent: string[]; hidden: string[]; hideVariants: boolean; busy?: boolean;
  onType: (v: string) => void;
  onPick: (m: string, meta?: any) => void;
  onHide: (m: string) => void;
  onToggleVariants: () => void;
  onRefresh: () => void;
}) {
  const { value, models, loaded, catalog, recent, hidden, hideVariants, busy, onType, onPick, onHide, onToggleVariants, onRefresh } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'recent' | 'loaded' | 'all' | 'hidden'>('all');
  const [vendor, setVendor] = useState('any');
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setVendor('any'); setHi(0);
    setScope(recent.length ? 'recent' : loaded.length ? 'loaded' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${hi}"]`) as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [hi]);

  const ownerOf = (m: string) => (m.includes('/') ? m.split('/')[0] : '(local)');
  const owners = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of models) { if (hidden.includes(m)) continue; const o = ownerOf(m); c[o] = (c[o] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [models, hidden]);

  const q = query.trim().toLowerCase();
  const filtered = models.filter((m) => {
    if (scope === 'hidden') { if (!hidden.includes(m)) return false; }
    else {
      if (hidden.includes(m)) return false;
      if (hideVariants && m.includes('@') && m !== value) return false;
      if (scope === 'recent' && !recent.includes(m)) return false;
      if (scope === 'loaded' && !loaded.includes(m)) return false;
    }
    if (vendor !== 'any' && ownerOf(m) !== vendor) return false;
    if (q && !m.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    const la = loaded.includes(a) ? 0 : 1, lb = loaded.includes(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    const ra = recent.indexOf(a) === -1 ? 999 : recent.indexOf(a);
    const rb = recent.indexOf(b) === -1 ? 999 : recent.indexOf(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  const shown = filtered.slice(0, 300);
  const grouped = scope === 'all' && vendor === 'any' && !query && filtered.length > 24;
  const groups: Array<{ owner: string; ids: string[] }> = [];
  if (grouped) {
    const map = new Map<string, string[]>();
    for (const m of shown) { const o = ownerOf(m); if (!map.has(o)) map.set(o, []); map.get(o)!.push(m); }
    for (const [owner, ids] of map) groups.push({ owner, ids });
  }
  const visual = grouped ? groups.flatMap((g) => g.ids) : shown;
  const idxOf = new Map(visual.map((m, i) => [m, i]));
  const selectedIndex = Math.max(0, Math.min(hi, visual.length - 1));
  useEffect(() => { setHi((index) => Math.max(0, Math.min(index, visual.length - 1))); }, [visual.length]);
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(selectedIndex + 1, Math.max(0, visual.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(selectedIndex - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (visual[selectedIndex]) pick(visual[selectedIndex]); }
  };

  const pick = (m: string) => { onPick(m, catalog[m]); setOpen(false); };
  const Row = (m: string, i: number) => {
    const meta = catalog[m];
    const isHidden = hidden.includes(m);
    return (
      <div data-idx={i} className={'model-row' + (i === selectedIndex ? ' hi' : '') + (m === value ? ' active' : '')} key={m} onMouseEnter={() => setHi(i)}>
        <button type="button" className="model-pick" aria-pressed={m === value} onClick={() => pick(m)} onFocus={() => setHi(i)}>
          <span className="model-id">{m}</span>
          <span className="model-meta">
            {loaded.includes(m) && <span className="badge pass">loaded</span>}
            {meta?.ctx ? <span>{fmtCtx(meta.ctx)} ctx</span> : null}
          </span>
        </button>
        <button type="button" className="model-hide" aria-label={`${isHidden ? 'Unhide' : 'Hide'} ${m}`} onClick={() => onHide(m)}>{isHidden ? 'unhide' : 'hide'}</button>
      </div>
    );
  };

  return (
    <div className="model-picker" ref={wrap} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); wrap.current?.querySelector<HTMLButtonElement>('.model-browse')?.focus(); } }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input aria-label="Selected model ID" value={value} onChange={(e) => onType(e.target.value)} placeholder="Enter a model ID" />
        <button type="button" className="btn sm model-browse" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Browse</button>
        <button type="button" className="btn sm" onClick={onRefresh} disabled={busy}>{busy ? 'Loading…' : 'Load'}</button>
      </div>
      {open && (
        <div className="model-list" ref={listRef}>
          <input aria-label="Search models" autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setHi(0); setScope('all'); }} onKeyDown={onSearchKey} placeholder="Filter models without changing selection" />
          <div className="model-controls">
            <div className="model-scopes">
              <button className={'scope' + (scope === 'recent' ? ' active' : '')} onClick={() => { setScope('recent'); setHi(0); }} disabled={!recent.length}>recent</button>
              <button className={'scope' + (scope === 'loaded' ? ' active' : '')} onClick={() => { setScope('loaded'); setHi(0); }} disabled={!loaded.length}>loaded</button>
              <button className={'scope' + (scope === 'all' ? ' active' : '')} onClick={() => { setScope('all'); setHi(0); }}>all</button>
              <button className={'scope' + (scope === 'hidden' ? ' active' : '')} onClick={() => { setScope('hidden'); setHi(0); }} disabled={!hidden.length}>hidden{hidden.length ? ' ' + hidden.length : ''}</button>
            </div>
            <select aria-label="Model vendor" value={vendor} onChange={(e) => { setVendor(e.target.value); setHi(0); }} onMouseDown={(e) => e.stopPropagation()}>
              <option value="any">all vendors</option>
              {owners.map(([o, c]) => <option key={o} value={o}>{o} ({c})</option>)}
            </select>
            <span className="model-count">{filtered.length}</span>
          </div>
          <div className="model-options">
            <label className="variant-toggle" onMouseDown={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={hideVariants} onChange={onToggleVariants} /> hide variant checkpoints (@q4, @q8, @bf16…)
            </label>
          </div>
          {!shown.length && <div className="model-row muted">{scope === 'hidden' ? 'No hidden models.' : 'No matching model.'}</div>}
          {grouped ? groups.map((g) => <div key={g.owner}><div className="model-group">{g.owner}<span>{g.ids.length}</span></div>{g.ids.map((m) => Row(m, idxOf.get(m) ?? 0))}</div>) : shown.map((m, i) => Row(m, i))}
          {filtered.length > shown.length && <div className="model-row muted">{filtered.length - shown.length} more — refine your search</div>}
        </div>
      )}
    </div>
  );
}