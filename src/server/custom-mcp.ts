import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_CUSTOM_MCP_LIMITS, MCP_REDACTED, type CustomMcpServer } from '@/shared/settings-schema';
import type { ToolResult } from '@/shared/contracts';
import { dataDir, readJson } from './store';
import { captureOutput } from './output-artifacts';
import { McpStdioClient, MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, mcpResultText } from './mcp-stdio';

export type McpTool = { name: string; remoteName: string; serverId: string; description: string; parameters: Record<string, unknown>; mutating: boolean };
const configFile = () => dataDir('custom-mcp.json');
export function readMcpServers(): CustomMcpServer[] { return readJson<CustomMcpServer[]>(configFile(), []); }
function persist(servers: CustomMcpServer[]) {
  const file = configFile();
  const tmp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(servers, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function redactMcp(text: string, server: CustomMcpServer): string {
  const values = [...Object.values(server.env), ...Object.values(server.headers)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of values) {
    for (const value of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) text = text.split(value).join(MCP_REDACTED);
  }
  return text;
}
export function publicMcpServer(server: CustomMcpServer): CustomMcpServer {
  return { ...server, env: Object.fromEntries(Object.keys(server.env).map((k) => [k, MCP_REDACTED])), headers: Object.fromEntries(Object.keys(server.headers).map((k) => [k, MCP_REDACTED])) };
}
export function listMcpServers() { return readMcpServers().map(publicMcpServer); }
function secretMap(value: unknown, old: Record<string, string>, replace: boolean, headers: boolean): Record<string, string> {
  if (value === undefined) return old;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Credentials must be a JSON object of strings.');
  const entries = Object.entries(value);
  for (const [key, val] of entries) {
    if (!(headers ? /^[!#$%&'*+.^_`|~0-9a-z-]+$/i : /^[A-Za-z_][A-Za-z0-9_]*$/).test(key) || typeof val !== 'string') throw new Error('Invalid credential name or value.');
    if (headers && (/[\r\n]/.test(val) || ['host', 'content-length', 'connection', 'transfer-encoding', 'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version'].includes(key.toLowerCase()))) throw new Error('Invalid or reserved HTTP header.');
    if (!replace && val !== MCP_REDACTED) throw new Error('New credential values require explicit replaceEnv or replaceHeaders.');
    if (!replace && !(key in old)) throw new Error('Cannot preserve a credential that does not exist.');
  }
  return Object.fromEntries(entries.map(([key, val]) => [headers ? key.toLowerCase() : key, !replace ? old[key] : val as string]));
}
export function saveMcpServer(input: any, id?: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Server configuration must be an object.');
  const servers = readMcpServers();
  const old = id ? servers.find((s) => s.id === id) : undefined;
  if (id && !old) throw new Error('MCP server not found.');
  const value = { ...old, ...input };
  const name = value.name;
  if (typeof name !== 'string' || !name.trim()) throw new Error('Server name is required.');
  if (!['stdio', 'http'].includes(value.transport)) throw new Error('Transport must be stdio or http.');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('Enabled must be a boolean.');
  for (const key of ['command', 'cwd', 'url']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('Command, directory and URL must be strings.');
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((a: unknown) => typeof a !== 'string' || a.includes('\0')))) throw new Error('Arguments must be a JSON array of strings.');
  if (value.transport === 'stdio' && (!value.command?.trim() || value.command.includes('\0'))) throw new Error('An executable command is required.');
  if (value.cwd && !path.isAbsolute(value.cwd)) throw new Error('Working directory must be absolute or empty to use the task workspace.');
  if (value.transport === 'http') {
    let url: URL;
    try { url = new URL(value.url); } catch { throw new Error('A valid HTTP endpoint is required.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) URL without credentials, query or fragment; put credentials in headers.');
  }
  const limits = { ...DEFAULT_CUSTOM_MCP_LIMITS, ...old?.limits, ...input.limits };
  for (const key of Object.keys(DEFAULT_CUSTOM_MCP_LIMITS) as Array<keyof typeof limits>) if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new Error('MCP limits must be nonnegative safe integers; 0 means unlimited.');
  const server: CustomMcpServer = {
    id: old?.id || randomUUID(), name: name.trim(), transport: value.transport, enabled: value.enabled ?? true,
    command: value.command || '', args: value.args || [], cwd: value.cwd || '', url: value.url || '', limits,
    env: secretMap(input.env, old?.env || {}, input.replaceEnv === true, false),
    headers: secretMap(input.headers, old?.headers || {}, input.replaceHeaders === true, true),
  };
  if (old) servers[servers.indexOf(old)] = server; else servers.push(server);
  persist(servers);
  return publicMcpServer(server);
}
export function deleteMcpServer(id: string) {
  const servers = readMcpServers();
  if (!servers.some((s) => s.id === id)) throw new Error('MCP server not found.');
  persist(servers.filter((s) => s.id !== id));
}
export function mcpToolName(serverId: string, remoteName: string) {
  return 'mcp_' + createHash('sha256').update(JSON.stringify([serverId, remoteName])).digest('hex').slice(0, 56);
}
interface Connection {
  initialize(signal?: AbortSignal): Promise<any>;
  request(method: string, params: any, signal?: AbortSignal): Promise<any>;
  close(signal?: AbortSignal): Promise<void>;
}
class HttpMcpClient implements Connection {
  private sequence = 0;
  private sid?: string;
  private protocol = MCP_PROTOCOL_VERSION;
  private server: CustomMcpServer;
  private signal?: AbortSignal;
  constructor(server: CustomMcpServer, signal?: AbortSignal) { this.server = server; this.signal = signal; }
  private headers() {
    return { ...this.server.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocol, ...(this.sid ? { 'Mcp-Session-Id': this.sid } : {}) };
  }
  private async post(method: string, params: any, signal?: AbortSignal, notify = false): Promise<any> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const ms = this.server.limits.timeoutMs;
    const timer = ms > 0 ? setTimeout(abort, ms) : undefined;
    const id = ++this.sequence;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch(this.server.url, { method: 'POST', headers: this.headers(), redirect: 'error', body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, params }), signal: controller.signal });
      if (!res.ok) throw new Error(`MCP HTTP ${res.status}${res.status === 404 ? ' (session or endpoint missing)' : ''}.`);
      if (method === 'initialize') this.sid = res.headers.get('mcp-session-id') || undefined;
      if (notify) { await res.body?.cancel(); return {}; }
      if (!res.body) throw new Error('MCP response has no body.');
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      const sse = res.headers.get('content-type')?.includes('text/event-stream');
      let text = '', bytes = 0;
      const unwrap = (message: any) => {
        if (message?.jsonrpc !== '2.0') throw new Error('Invalid MCP JSON-RPC envelope.');
        if (message.id !== id || message.method) return undefined;
        if (message.error) throw new Error(String(message.error.message || 'MCP request failed.'));
        if (message.result === undefined) throw new Error('MCP response has no result.');
        return { result: message.result };
      };
      while (true) {
        const chunk = await reader.read();
        bytes += chunk.value?.byteLength || 0;
        if (this.server.limits.maxFrameBytes > 0 && bytes > this.server.limits.maxFrameBytes) throw new Error('MCP response exceeds configured maxFrameBytes.');
        text += decoder.decode(chunk.value, { stream: !chunk.done });
        if (sse) {
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/.exec(text))) {
            const event = text.slice(0, match.index); text = text.slice(match.index + match[0].length);
            const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
            if (data) { const result = unwrap(JSON.parse(data)); if (result) return result.result; }
          }
        }
        if (chunk.done) break;
      }
      if (!sse) { const result = unwrap(JSON.parse(text)); if (result) return result.result; }
      throw new Error('MCP returned no matching JSON-RPC response.');
    } catch (e) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'MCP call cancelled.' : 'MCP configured request timeout exceeded.');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      await reader?.cancel().catch(() => {});
    }
  }
  async initialize(signal?: AbortSignal) {
    const result = await this.post('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'ECLucky13', version: '1.16' } }, signal);
    if (!MCP_PROTOCOL_VERSIONS.includes(result.protocolVersion)) throw new Error('Unsupported MCP protocol.');
    this.protocol = result.protocolVersion;
    await this.post('notifications/initialized', {}, signal, true);
    return result;
  }
  request(method: string, params: any, signal?: AbortSignal) { return this.post(method, params, signal); }
  async close(signal = this.signal) {
    if (!this.sid) return;
    const ms = this.server.limits.shutdownGraceMs;
    const controller = new AbortController();
    const timer = ms > 0 ? setTimeout(() => controller.abort(), ms) : undefined;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try { const res = await fetch(this.server.url, { method: 'DELETE', headers: this.headers(), redirect: 'error', signal: controller.signal }); await res.body?.cancel(); }
    catch {} finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
async function connected<T>(server: CustomMcpServer, workspace: string, signal: AbortSignal | undefined, use: (client: Connection) => Promise<T>): Promise<T> {
  if (!server.enabled) throw new Error('MCP server is disabled. Enable it in Settings > MCP servers for the next run.');
  if (signal?.aborted) throw new Error('MCP call cancelled.');
  let client: Connection | undefined;
  try {
    client = server.transport === 'http' ? new HttpMcpClient(server, signal) : new McpStdioClient({ label: server.name, command: server.command, args: server.args, cwd: server.cwd || workspace, env: server.env, ...server.limits, shutdownGraceMs: server.limits.shutdownGraceMs });
    await client.initialize(signal);
    return await use(client);
  } catch (e: any) {
    await client?.close(AbortSignal.abort());
    throw new Error(redactMcp(String(e?.message || e), server));
  }
  finally { await client?.close(signal); }
}
export async function discoverMcpTools(server: CustomMcpServer, workspace: string, signal?: AbortSignal): Promise<McpTool[]> {
  return connected(server, workspace, signal, async (client) => {
    const tools: McpTool[] = [];
    const names = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined, pages = 0, chars = 0;
    do {
      signal?.throwIfAborted();
      if (server.limits.maxDiscoveryPages > 0 && ++pages > server.limits.maxDiscoveryPages) throw new Error('MCP discovery exceeds maxDiscoveryPages; increase it in Settings.');
      const result = await client.request('tools/list', cursor ? { cursor } : {}, signal);
      if (!Array.isArray(result.tools)) throw new Error('MCP tools/list returned invalid tools.');
      for (const tool of result.tools) {
        if (!tool || typeof tool.name !== 'string' || !tool.name || !tool.inputSchema || tool.inputSchema.type !== 'object' || Array.isArray(tool.inputSchema)) throw new Error('MCP tool has an invalid name or object input schema.');
        if (names.has(tool.name)) throw new Error('MCP server returned duplicate tool names.');
        names.add(tool.name);
        const clean = JSON.parse(redactMcp(JSON.stringify({ description: typeof tool.description === 'string' ? tool.description : tool.name, parameters: tool.inputSchema }), server));
        const def = { name: mcpToolName(server.id, tool.name), remoteName: tool.name, serverId: server.id, description: clean.description, parameters: clean.parameters, mutating: tool.annotations?.readOnlyHint !== true };
        chars += JSON.stringify(def).length;
        if (server.limits.schemaMaxChars > 0 && chars > server.limits.schemaMaxChars) throw new Error('MCP discovery exceeds schemaMaxChars; increase it in Settings.');
        tools.push(def);
        if (server.limits.maxTools > 0 && tools.length > server.limits.maxTools) throw new Error('MCP discovery exceeds maxTools; increase it in Settings.');
      }
      cursor = result.nextCursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursors.has(cursor))) throw new Error('MCP returned an invalid or repeated discovery cursor.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  });
}
export async function callCustomMcpTool(server: CustomMcpServer, tool: McpTool, args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<ToolResult> {
  try {
    if (tool.serverId !== server.id || tool.name !== mcpToolName(server.id, tool.remoteName)) throw new Error('MCP tool namespace mismatch.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('MCP arguments must be an object.');
    const result = await connected(server, workspace, signal, (client) => client.request('tools/call', { name: tool.remoteName, arguments: args }, signal));
    captureOutput('mcp.result', JSON.parse(redactMcp(JSON.stringify(result), server)));
    const text = redactMcp(mcpResultText(result) || JSON.stringify(result), server);
    const cap = server.limits.outputMaxChars;
    const output = cap > 0 && text.length > cap ? text.slice(0, cap) + '\n[MCP output truncated; increase outputMaxChars in Settings or use 0 for unlimited.]' : text;
    return result.isError ? { ok: false, output: '', error: output } : { ok: true, output };
  } catch (e: any) { return { ok: false, output: '', error: redactMcp(String(e?.message || e), server) }; }
}
