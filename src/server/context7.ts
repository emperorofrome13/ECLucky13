import type { ToolResult } from '@/shared/contracts';
import { captureOutput } from './output-artifacts';
import { createHash } from 'node:crypto';
import { MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, mcpResultText } from './mcp-stdio';

export const CONTEXT7_ENDPOINT = 'https://mcp.context7.com/mcp';
export interface Context7Options { signal?: AbortSignal; timeoutMs?: number; cacheTtlMs?: number; endpoint?: string }
type Tool = { name: string; inputSchema?: { properties?: Record<string, any>; required?: string[] } };
type Session = { sid?: string; protocol: string; tools?: Tool[]; expires: number };
const sessions = new Map<string, Session>();
export function clearContext7Cache() { sessions.clear(); }
export function parseContext7Response(raw: string, id: number): any {
  const candidates: any[] = [];
  try { const parsed = JSON.parse(raw); candidates.push(...(Array.isArray(parsed) ? parsed : [parsed])); } catch {}
  for (const event of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (data) { try { candidates.push(JSON.parse(data)); } catch {} }
  }
  const response = candidates.find((c) => c?.id === id);
  if (!response) throw new Error('Context7 returned no matching JSON-RPC response.');
  if (response.error) throw new Error(String(response.error.message || 'Context7 RPC error'));
  if (response.result === undefined) throw new Error('Context7 returned no result.');
  if (response.result.isError) throw new Error(mcpResultText(response.result) || 'Context7 tool error.');
  return response.result;
}
export function context7LibraryId(text: string, libraryName: string): string {
  const ids = [...text.matchAll(/(?:Context7-compatible library ID|Library ID):\s*`?(\/[\w.-]+\/[\w.-]+(?:\/[\w.+-]+)?)/gi)].map((m) => m[1]);
  const unique = [...new Set(ids)];
  const normalized = libraryName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = unique.filter((id) => id.split('/')[2].toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
  if (exact.length === 1) return exact[0];
  if (unique.length === 1) return unique[0];
  throw new Error(unique.length ? `Ambiguous library lookup. Supply an exact libraryId: ${unique.join(', ')}` : 'No library ID resolved; refine the library name.');
}
export async function context7Docs(query: string, libraryName?: string, libraryId?: string, apiKey = '', options: Context7Options = {}): Promise<ToolResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = options.timeoutMs ?? 30000;
  const timer = timeout > 0 ? setTimeout(abort, timeout) : undefined;
  const endpoint = options.endpoint || CONTEXT7_ENDPOINT;
  const key = createHash('sha256').update(endpoint + '\0' + apiKey).digest('hex');
  let id = 0;
  const post = async (body: any, session?: Session) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': session?.protocol || MCP_PROTOCOL_VERSION };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (session?.sid) headers['mcp-session-id'] = session.sid;
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await res.text();
    if (!res.ok) { const e: any = new Error(`Context7 HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`); e.status = res.status; throw e; }
    return { res, raw };
  };
  const open = async () => {
    const cached = sessions.get(key);
    if (cached && cached.expires > Date.now()) return cached;
    const requestId = ++id;
    const { res, raw } = await post({ jsonrpc: '2.0', id: requestId, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'ECLucky13', version: '1.16' } } });
    const result = parseContext7Response(raw, requestId);
    if (!MCP_PROTOCOL_VERSIONS.includes(result.protocolVersion)) throw new Error(`Unsupported Context7 protocol ${result.protocolVersion}`);
    const session: Session = { sid: res.headers.get('mcp-session-id') || undefined, protocol: result.protocolVersion, expires: Date.now() + (options.cacheTtlMs ?? 300000) };
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, session);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
    sessions.set(key, session);
    return session;
  };
  const rpc = async (method: string, params: any) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await open();
      const requestId = ++id;
      try {
        const { raw } = await post({ jsonrpc: '2.0', id: requestId, method, params }, session);
        if (method === 'tools/call') captureOutput('context7.response', apiKey ? raw.split(apiKey).join('[redacted]') : raw);
        return parseContext7Response(raw, requestId);
      } catch (e: any) {
        sessions.delete(key);
        if (session.sid && [404, 410].includes(e.status) && attempt === 0) continue;
        throw e;
      }
    }
    throw new Error('Context7 session expired.');
  };
  try {
    if (!query.trim()) throw new Error('A documentation query is required.');
    let session = await open();
    if (!session.tools) {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const result = await rpc('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(result.tools)) throw new Error('Context7 tools/list returned an invalid schema.');
        tools.push(...result.tools);
        cursor = result.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('Context7 repeated a tools/list cursor.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      session = await open(); session.tools = tools;
    }
    const call = async (name: string, values: Record<string, string>) => {
      const tool = session.tools!.find((t) => t.name === name);
      if (!tool?.inputSchema?.properties) throw new Error(`Context7 does not expose a usable schema for ${name}.`);
      const args = Object.fromEntries(Object.entries(values).filter(([k]) => k in tool.inputSchema!.properties!));
      for (const required of tool.inputSchema.required || []) if (!(required in args)) throw new Error(`Unsupported Context7 required argument: ${required}`);
      const result = await rpc('tools/call', { name, arguments: args });
      const text = mcpResultText(result);
      if (!text.trim()) throw new Error('Context7 returned empty documentation.');
      return text;
    };
    let lib = libraryId?.trim();
    if (!lib && libraryName) lib = context7LibraryId(await call('resolve-library-id', { libraryName, query }), libraryName);
    if (!lib || !/^\/[\w.-]+\/[\w.-]+(?:\/[\w.+-]+)?$/.test(lib)) throw new Error('Supply a valid libraryName or exact /org/project[/version] libraryId.');
    const name = session.tools!.some((t) => t.name === 'query-docs') ? 'query-docs' : 'get-library-docs';
    const text = await call(name, { libraryId: lib, context7CompatibleLibraryID: lib, query, topic: query });
    if (/^(?:error\b|no (?:documentation|context|libraries)|failed\b|rate limit)/i.test(text.trim())) throw new Error(text);
    return { ok: true, output: `Context7 docs for ${lib}:\n${text}` };
  } catch (e: any) {
    const message = controller.signal.aborted ? (options.signal?.aborted ? 'Cancelled.' : 'Configured Context7 deadline exceeded.') : String(e.message || e);
    return { ok: false, output: '', error: 'Context7 failed: ' + (apiKey ? message.split(apiKey).join('[redacted]') : message) };
  } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
