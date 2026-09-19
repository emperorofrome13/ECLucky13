import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ToolResult } from '@/shared/contracts';
import { captureOutput, outputStream } from './output-artifacts';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const MCP_CALL_TIMEOUT_MS = 60000;
export interface McpOptions {
  label: string; command: string; args: string[]; cwd: string;
  env?: Record<string, string>; timeoutMs?: number; maxFrameBytes?: number;
  shutdownGraceMs?: number; stderrMaxChars?: number;
}
export interface McpStdioCall extends McpOptions {
  tool: string; arguments: Record<string, unknown>; signal?: AbortSignal;
}
export function mcpResultText(result: any): string {
  const text = (Array.isArray(result?.content) ? result.content : []).filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
  if (text.trim()) return text;
  const s = result?.structuredContent;
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object') {
    for (const key of ['instructions', 'text', 'output', 'result']) if (typeof s[key] === 'string') return s[key];
    return JSON.stringify(s);
  }
  return '';
}
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; cleanup: () => void }>();
  private sequence = 0;
  private buffer = '';
  private stderr = '';
  private failure?: Error;
  private closing?: Promise<void>;
  private closed: Promise<void>;
  private ended = false;
  private initialized?: Promise<any>;
  private options: McpOptions;
  constructor(options: McpOptions) {
    this.options = options;
    this.child = spawn(options.command, options.args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    this.closed = new Promise((resolve) => {
      this.child.on('close', (code) => {
        this.ended = true;
        if (this.buffer.trim()) this.parse(this.buffer.trim());
        this.fail(new Error(`${options.label} MCP closed (${code ?? 'unknown'}).`));
        resolve();
      });
    });
    const streamError = (e: Error) => this.fail(e);
    this.child.on('error', streamError);
    this.child.stdin.on('error', streamError);
    this.child.stdout.on('error', streamError);
    this.child.stderr.on('error', streamError);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    const diagnostics = outputStream('mcp.stderr');
    this.child.stderr.on('data', (s: string) => {
      try { this.stderr = (this.stderr + diagnostics.push(s)).slice(-(options.stderrMaxChars ?? 8000)); }
      catch { this.fail(new Error('MCP diagnostic archive write failed.')); }
    });
    this.child.stderr.on('end', () => {
      try { this.stderr = (this.stderr + diagnostics.end()).slice(-(options.stderrMaxChars ?? 8000)); }
      catch { this.fail(new Error('MCP diagnostic archive write failed.')); }
    });
    this.child.stdout.on('data', (s: string) => {
      this.buffer += s;
      const cap = options.maxFrameBytes ?? 4194304;
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (cap > 0 && Buffer.byteLength(line) > cap) return this.fail(new Error('MCP frame exceeds configured maxFrameBytes.'));
        this.parse(line);
      }
      if (cap > 0 && Buffer.byteLength(this.buffer) > cap) this.fail(new Error('MCP frame exceeds configured maxFrameBytes.'));
    });
  }
  get alive() { return !this.failure && !this.closing && !this.ended; }
  get diagnostics() { return this.stderr; }
  private fail(error: Error) {
    this.failure ??= error;
    for (const p of this.pending.values()) { p.cleanup(); p.reject(error); }
    this.pending.clear();
  }
  private send(message: any) {
    if (!this.alive) throw this.failure || new Error('MCP is closing.');
    this.child.stdin.write(JSON.stringify(message) + '\n', (e) => { if (e) this.fail(e); });
  }
  private parse(line: string) {
    if (!line.trim()) return;
    let m: any;
    try { m = JSON.parse(line); } catch { this.fail(new Error('MCP emitted invalid JSON on stdout.')); return; }
    if (m?.jsonrpc !== '2.0') { this.fail(new Error('Invalid MCP JSON-RPC envelope.')); return; }
    if (m.method) {
      if (m.id !== undefined) {
        try { this.send(m.method === 'ping' ? { jsonrpc: '2.0', id: m.id, result: {} } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Unsupported client method' } }); } catch {}
      }
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id); p.cleanup();
    if (m.error) p.reject(new Error(String(m.error.message || 'MCP request failed')));
    else if (m.result === undefined) p.reject(new Error('MCP response has no result.'));
    else p.resolve(m.result);
  }
  request(method: string, params: any, signal?: AbortSignal, timeoutMs = this.options.timeoutMs ?? MCP_CALL_TIMEOUT_MS): Promise<any> {
    if (signal?.aborted) return Promise.reject(new Error('MCP call cancelled.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const stop = (message: string) => {
        this.pending.delete(id); cleanup();
        try { this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: message } }); } catch {}
        reject(new Error(message));
        void this.close(AbortSignal.abort());
      };
      const abort = () => stop('MCP call cancelled.');
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      if (timeoutMs > 0) timer = setTimeout(() => stop(`${this.options.label} MCP did not respond within ${timeoutMs}ms.`), timeoutMs);
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (e) { this.pending.delete(id); cleanup(); reject(e); }
    });
  }
  initialize(signal?: AbortSignal) {
    return this.initialized ??= this.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'ECLucky13', version: '1.16' } }, signal).then((r) => {
      if (!MCP_PROTOCOL_VERSIONS.includes(r.protocolVersion)) throw new Error(`Unsupported MCP protocol: ${r.protocolVersion}`);
      this.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      return r;
    });
  }
  async tool(name: string, args: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number): Promise<ToolResult & { structured?: any }> {
    try {
      await this.initialize(signal);
      const r = await this.request('tools/call', { name, arguments: args }, signal, timeoutMs);
      captureOutput('mcp.result', r);
      const output = mcpResultText(r);
      if (r.isError || !output.trim()) throw new Error(output || 'MCP returned an empty result.');
      return { ok: true, output, structured: r.structuredContent };
    } catch (e: any) { return { ok: false, output: '', error: `${this.options.label}: ${e.message}` }; }
  }
  close(signal?: AbortSignal): Promise<void> {
    return this.closing ??= (async () => {
      this.fail(new Error('MCP session closed.'));
      try { this.child.stdin.end(); } catch {}
      const wait = async (ms: number) => {
        if (signal?.aborted) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort = () => {};
        try {
          await Promise.race([this.closed, new Promise<void>((resolve) => {
            abort = resolve;
            signal?.addEventListener('abort', abort, { once: true });
            if (ms > 0) timer = setTimeout(resolve, ms);
          })]);
        } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      };
      await wait(this.options.shutdownGraceMs ?? 1000);
      if (!this.ended) {
        if (process.platform === 'win32' && this.child.pid) {
          await new Promise<void>((resolve) => {
            const killer = spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => { this.child.kill(); resolve(); });
            killer.on('close', () => resolve());
          });
        } else {
          try { process.kill(-this.child.pid!, 'SIGKILL'); } catch { this.child.kill('SIGKILL'); }
        }
        await wait(this.options.shutdownGraceMs ?? 1000);
      }
      if (!this.ended) { this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy(); this.child.unref(); }
    })();
  }
}
export async function callMcpTool(call: McpStdioCall): Promise<ToolResult & { structured?: any }> {
  let client: McpStdioClient | undefined;
  try { client = new McpStdioClient(call); return await client.tool(call.tool, call.arguments, call.signal, call.timeoutMs); }
  catch (e: any) { return { ok: false, output: '', error: `${call.label}: ${e.message}` }; }
  finally { await client?.close(); }
}
