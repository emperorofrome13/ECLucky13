'use client';
// Explorer: workspace tree from /api/files/[id]?tree=1. Paths are workspace-relative.
import { useCallback, useEffect, useRef, useState } from 'react';

interface Node { name: string; path: string; type: 'dir' | 'file'; children?: Node[] }

export default function FileTree(props: { workspaceId: string; refreshKey: number; activePath: string; onOpen: (p: string) => void }) {
  const { workspaceId, refreshKey, activePath, onOpen } = props;
  const [tree, setTree] = useState<Node[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const requestId = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    if (!workspaceId) { setTree([]); setLoading(false); setError(''); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/files/${encodeURIComponent(workspaceId)}?tree=1&depth=6`);
      const d = await r.json();
      if (request !== requestId.current) return;
      if (r.ok && d.ok) setTree(d.tree || []); else setError(d.error || 'Could not read folder.');
    } catch (e: any) { if (request === requestId.current) setError(String(e?.message || e)); } finally { if (request === requestId.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load, refreshKey]);

  const toggle = (p: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const rows = (nodes: Node[], depth: number) => nodes.map((n) => (
    <div key={n.path}>
      <button type="button" className={'tree-row ' + n.type + (activePath === n.path ? ' active' : '')} style={{ paddingLeft: 8 + depth * 13 }} title={n.path}
        aria-label={`${n.type === 'dir' ? 'Folder' : 'Open file'} ${n.path}`}
        aria-expanded={n.type === 'dir' ? expanded.has(n.path) : undefined}
        aria-current={n.type === 'file' && activePath === n.path ? 'page' : undefined}
        onClick={() => (n.type === 'dir' ? toggle(n.path) : onOpen(n.path))}
        onKeyDown={(e) => {
          if (n.type === 'dir' && ((e.key === 'ArrowRight' && !expanded.has(n.path)) || (e.key === 'ArrowLeft' && expanded.has(n.path)))) { e.preventDefault(); toggle(n.path); }
        }}>
        <span className="ic" aria-hidden="true">{n.type === 'dir' ? (expanded.has(n.path) ? '-' : '+') : ''}</span>
        <span>{n.name}{n.type === 'dir' ? '/' : ''}</span>
      </button>
      {n.type === 'dir' && expanded.has(n.path) && n.children && rows(n.children, depth + 1)}
    </div>
  ));

  return (
    <>
      <div className="panel-head"><span>Explorer</span><button className="btn ghost sm" onClick={load}>refresh</button></div>
      <div className="panel-scroll">
        {!workspaceId && <div className="hint" style={{ padding: 10 }}>No workspace. Set one in the top bar.</div>}
        {workspaceId && loading && <div className="hint" style={{ padding: 10 }}>Loading…</div>}
        {workspaceId && error && <div className="hint" style={{ padding: 10, color: 'var(--bad)' }}>{error}</div>}
        {workspaceId && !loading && !error && !tree.length && <div className="hint" style={{ padding: 10 }}>Folder is empty.</div>}
        {workspaceId && !loading && <div className="tree">{rows(tree, 0)}</div>}
      </div>
    </>
  );
}