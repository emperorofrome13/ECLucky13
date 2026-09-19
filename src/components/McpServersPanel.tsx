'use client';
import { useEffect, useRef, useState } from 'react';
import { CUSTOM_MCP_LIMIT_LABELS, DEFAULT_CUSTOM_MCP_LIMITS, type CustomMcpServer } from '@/shared/settings-schema';

const blank = (): CustomMcpServer => ({ id: '', name: '', enabled: true, transport: 'stdio', command: '', args: [], cwd: '', url: '', env: {}, headers: {}, limits: { ...DEFAULT_CUSTOM_MCP_LIMITS } });

export default function McpServersPanel({ workspace }: { workspace: string }) {
  const [servers, setServers] = useState<CustomMcpServer[]>([]);
  const [draft, setDraft] = useState<CustomMcpServer | null>(null);
  const [args, setArgs] = useState('[]');
  const [env, setEnv] = useState('{}');
  const [headers, setHeaders] = useState('{}');
  const [replaceEnv, setReplaceEnv] = useState(false);
  const [replaceHeaders, setReplaceHeaders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, any>>({});
  const controller = useRef<AbortController | null>(null);
  const request = async (method: string, body?: unknown, suffix = '', signal?: AbortSignal) => {
    const response = await fetch('/api/mcp-servers' + suffix, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `MCP request failed (HTTP ${response.status}).`);
    return data;
  };
  const refresh = async () => { const data = await request('GET'); setServers(data.servers); };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message)).finally(() => setLoading(false));
    return () => controller.current?.abort();
  }, []);
  const edit = (server: CustomMcpServer) => {
    setDraft(structuredClone(server)); setArgs(JSON.stringify(server.args, null, 2));
    setEnv(JSON.stringify(server.env, null, 2)); setHeaders(JSON.stringify(server.headers, null, 2));
    setReplaceEnv(!server.id); setReplaceHeaders(!server.id); setError('');
  };
  const perform = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e: any) { setError(e.name === 'AbortError' ? 'MCP request cancelled.' : e.message); }
    finally { setBusy(false); controller.current = null; }
  };
  const save = () => perform(async () => {
    if (!draft) return;
    let values: any;
    try { values = { ...draft, args: JSON.parse(args), env: JSON.parse(env), headers: JSON.parse(headers), replaceEnv, replaceHeaders }; }
    catch { throw new Error('Arguments must be a JSON array; environment and headers must be JSON objects.'); }
    await request(draft.id ? 'PATCH' : 'POST', values);
    setEnv('{}'); setHeaders('{}'); setDraft(null);
    await refresh(); setMessage('Server saved for the next run; active task keeps its snapshot.');
  });
  const probe = (id: string, discover: boolean) => perform(async () => {
    controller.current = new AbortController();
    setResults((r) => ({ ...r, [id]: undefined }));
    const data = await request('PUT', { id, workspace }, '', controller.current.signal);
    setResults((r) => ({ ...r, [id]: { ...data, discover } }));
    setMessage(`Connection and tool discovery passed: ${data.tools.length} tools. No tool was executed.`);
  });
  return <fieldset style={{ fontSize: 14, minWidth: 0 }}>
    <legend>Custom MCP servers</legend>
    <p className="hint">Trusted servers run with this app&apos;s permissions. Only you configure commands and URLs; the model cannot change them. Calls auto-apply in Code mode without confirmations.</p>
    <p className="hint">Save applies next run; active task keeps its snapshot. Credentials remain server-side. Use environment variables or headers for secrets, never command arguments or URLs.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <button className="btn primary" disabled={busy || !!draft} onClick={() => edit(blank())}>Add MCP server</button>
      <button className="btn" disabled={busy} onClick={() => perform(refresh)}>Refresh servers</button>
      {busy && <button className="btn" disabled={!controller.current} onClick={() => controller.current?.abort()}>Stop test</button>}
    </div>
    {loading && <p role="status">Loading MCP servers…</p>}
    {!loading && !servers.length && <p>No custom servers configured. Add a local stdio or streamable HTTP server.</p>}
    {error && <p role="alert" style={{ color: 'var(--bad)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {servers.map((server) => <div key={server.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0', overflowWrap: 'anywhere' }}>
      <strong>{server.name}</strong> <span>{server.transport === 'stdio' ? 'Local stdio' : 'Streamable HTTP'} · {server.enabled ? 'Enabled' : 'Disabled'}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <label className="stage-toggle"><input type="checkbox" checked={server.enabled} disabled={busy || !!draft} onChange={(e) => { const enabled = e.target.checked; void perform(async () => { await request('PATCH', { id: server.id, enabled }); await refresh(); setMessage('Enablement saved for the next run.'); }); }} />Enable {server.name}</label>
        <button className="btn sm" disabled={busy || !!draft} onClick={() => edit(server)}>Edit</button>
        <button className="btn sm" disabled={busy || !server.enabled} onClick={() => probe(server.id, false)}>Test connection</button>
        <button className="btn sm" disabled={busy || !server.enabled} onClick={() => probe(server.id, true)}>Discover tools</button>
        <button className="btn danger sm" disabled={busy || !!draft} onClick={() => perform(async () => { await request('DELETE', undefined, '?id=' + encodeURIComponent(server.id)); await refresh(); setResults((r) => { const next = { ...r }; delete next[server.id]; return next; }); setMessage('Server deleted for future runs.'); })}>Delete</button>
      </div>
      {!server.enabled && <p role="status">Disabled for new runs. Enable this server to test or discover tools.</p>}
      {server.enabled && results[server.id] && <div role="status">Ready: {results[server.id].tools.length} tools{results[server.id].discover && results[server.id].tools.map((tool: any) => <details key={tool.name} style={{ marginTop: 8 }}><summary>{tool.remoteName} · {tool.mutating ? 'Code mode' : 'Read-only'}</summary><p>{tool.description}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14 }}>{JSON.stringify({ name: tool.name, parameters: tool.parameters }, null, 2)}</pre></details>)}</div>}
    </div>)}
    {draft && <fieldset disabled={busy} style={{ minWidth: 0 }}>
      <legend>{draft.id ? 'Edit MCP server' : 'New MCP server'}</legend>
      <div className="field"><label htmlFor="mcp-name">Server name</label><input id="mcp-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="mcp-transport">Transport</label><select id="mcp-transport" value={draft.transport} onChange={(e) => setDraft({ ...draft, transport: e.target.value as 'stdio' | 'http' })}><option value="stdio">Local stdio</option><option value="http">Streamable HTTP</option></select></div>
      <label className="stage-toggle"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />Enabled for new runs</label>
      {draft.transport === 'stdio' ? <>
        <div className="field"><label htmlFor="mcp-command">Executable (not a shell command)</label><input id="mcp-command" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} /><p className="hint">For Node servers use the node executable and pass the server script in Arguments. Paths with spaces do not need quoting here.</p></div>
        <div className="field"><label htmlFor="mcp-args">Arguments (JSON string array)</label><textarea id="mcp-args" rows={4} value={args} onChange={(e) => setArgs(e.target.value)} style={{ width: '100%', fontSize: 14 }} /></div>
        <div className="field"><label htmlFor="mcp-cwd">Working directory (empty = task workspace)</label><input id="mcp-cwd" value={draft.cwd} onChange={(e) => setDraft({ ...draft, cwd: e.target.value })} /></div>
      </> : <div className="field"><label htmlFor="mcp-url">Streamable HTTP endpoint</label><input id="mcp-url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></div>}
      {(['env', 'headers'] as const).map((kind) => {
        const replace = kind === 'env' ? replaceEnv : replaceHeaders;
        const setReplace = kind === 'env' ? setReplaceEnv : setReplaceHeaders;
        const value = kind === 'env' ? env : headers;
        const setValue = kind === 'env' ? setEnv : setHeaders;
        return <div className="field" key={kind}>
          <label className="stage-toggle"><input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setValue(e.target.checked ? '{}' : JSON.stringify(draft[kind], null, 2)); }} />Explicitly replace all {kind === 'env' ? 'environment variables' : 'HTTP headers'}</label>
          <label htmlFor={'mcp-' + kind}>{kind === 'env' ? 'Environment variables' : 'HTTP headers'} (JSON string map)</label>
          <textarea id={'mcp-' + kind} rows={4} value={value} readOnly={!replace} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} style={{ width: '100%', fontSize: 14 }} />
          <p className="hint">Unchecked preserves stored values. Replacement sends a new complete map; {'{}'} explicitly clears all entries. Stored values are never fetched into this editor.</p>
        </div>;
      })}
      <p className="hint">All budgets and timeouts below accept 0 for unlimited. Stop still cancels active requests. Discovery fails visibly rather than silently dropping schemas.</p>
      <div className="field-grid">{(Object.keys(CUSTOM_MCP_LIMIT_LABELS) as Array<keyof typeof CUSTOM_MCP_LIMIT_LABELS>).map((key) => <div className="field" key={key}><label htmlFor={'mcp-limit-' + key}>{CUSTOM_MCP_LIMIT_LABELS[key]}</label><input id={'mcp-limit-' + key} type="number" min="0" step="1" value={draft.limits[key]} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [key]: Number(e.target.value) } })} /></div>)}</div>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn primary" onClick={save}>Save server</button><button className="btn" onClick={() => { setDraft(null); setEnv('{}'); setHeaders('{}'); }}>Discard edits</button></div>
    </fieldset>}
  </fieldset>;
}
