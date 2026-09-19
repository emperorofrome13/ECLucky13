import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from '@/shared/contracts';
import { McpStdioClient, type McpOptions } from './mcp-stdio';
import { runProcess } from './tools/process';

const bundleRoot = path.join(process.cwd(), 'vendor', 'codegraph', 'node_modules', '@colbymchenry', `codegraph-${process.platform}-${process.arch}`);
const bundledNode = path.join(bundleRoot, process.platform === 'win32' ? 'node.exe' : 'node');
const serverEntry = path.join(bundleRoot, 'lib', 'dist', 'bin', 'codegraph.js');
const flags = ['--liftoff-only', '--disable-warning=ExperimentalWarning'];
export const CODEGRAPH_INSTALL_HINT = 'Run npm run install:mcp -- codegraph.';
export interface CodegraphHealth {
  installed: boolean; transport: 'unverified' | 'ready' | 'failed' | 'stopped';
  indexed: boolean; freshness: 'unknown' | 'snapshot' | 'stale';
  status: 'unavailable' | 'unindexed' | 'authorization-required' | 'ready' | 'failed' | 'busy';
  verifiedAt?: string; fileCount?: number; error?: string;
}
type Entry = { client: McpStdioClient; health: CodegraphHealth; tail: Promise<unknown> };
const shared = globalThis as typeof globalThis & { luckyCodegraphs?: Map<string, Entry>; luckyCodegraphOperations?: Set<string> };
const servers = shared.luckyCodegraphs ??= new Map<string, Entry>();
const operations = shared.luckyCodegraphOperations ??= new Set<string>();
const keyFor = (workspace: string) => fs.realpathSync(workspace);
export function codegraphMcpInstalled(): boolean {
  return [serverEntry, bundledNode, path.join(bundleRoot, 'lib', 'package.json')].every((f) => fs.existsSync(f));
}
export function codegraphMcpStatus(): ToolResult {
  return codegraphMcpInstalled() ? { ok: true, output: 'CodeGraph installed; transport and workspace index have not been tested.' } : { ok: false, output: '', error: CODEGRAPH_INSTALL_HINT };
}
export function codegraphHealth(workspace: string): CodegraphHealth {
  const installed = codegraphMcpInstalled();
  const indexed = fs.existsSync(path.join(workspace, '.codegraph', 'codegraph.db'));
  let key: string;
  try { key = keyFor(workspace); } catch { return { installed, indexed: false, transport: 'unverified', freshness: 'unknown', status: 'unindexed' }; }
  const entry = servers.get(key);
  if (operations.has(key)) return { installed, indexed, transport: 'unverified', freshness: 'unknown', status: 'busy' };
  if (entry?.client.alive) return { ...entry.health, indexed, freshness: entry.health.freshness === 'stale' ? 'stale' : 'unknown' };
  return { installed, indexed, transport: entry ? 'stopped' : 'unverified', freshness: 'unknown', status: !installed ? 'unavailable' : !indexed ? 'unindexed' : 'authorization-required' };
}
export async function shutdownCodegraph(workspace?: string): Promise<void> {
  const keys = workspace ? [keyFor(workspace)] : [...servers.keys()];
  await Promise.all(keys.map(async (key) => { const entry = servers.get(key); servers.delete(key); await entry?.client.close(); }));
}
export async function codegraphControl(workspace: string, action: 'index' | 'initialize' | 'refresh' | 'stop', authorized: boolean, signal?: AbortSignal, options: Partial<McpOptions> = {}): Promise<ToolResult & { health: CodegraphHealth }> {
  const key = keyFor(workspace);
  if (!authorized) return { ok: false, output: '', error: 'Explicit authorization is required to start CodeGraph or write its index.', health: codegraphHealth(key) };
  if (operations.has(key)) return { ok: false, output: '', error: 'A CodeGraph operation is already active for this workspace.', health: codegraphHealth(key) };
  operations.add(key);
  try {
    await shutdownCodegraph(key);
    if (action === 'stop') return { ok: true, output: 'CodeGraph stopped.', health: { ...codegraphHealth(key), status: 'authorization-required', transport: 'stopped' } };
    if (!codegraphMcpInstalled()) throw new Error(CODEGRAPH_INSTALL_HINT);
    signal?.throwIfAborted();
    const indexed = fs.existsSync(path.join(key, '.codegraph', 'codegraph.db'));
    if (action === 'refresh' && !indexed) throw new Error('No index at this workspace root. Authorize initialize first.');
    const env = { CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_NO_WATCH: '1', CODEGRAPH_CATCHUP_GATE_TIMEOUT_MS: '0', CODEGRAPH_MCP_TOOLS: 'explore,status', NODE_DISABLE_COMPILE_CACHE: '1', DO_NOT_TRACK: '1' };
    const run = async (args: string[]) => {
      const r = await runProcess({ command: bundledNode, args: [...flags, serverEntry, ...args], cwd: key, env, signal, timeoutMs: options.timeoutMs ?? 120000, label: 'codegraph-control' });
      if (r.exitCode !== 0 || r.terminationReason !== 'exited') throw new Error(`CodeGraph ${args[0]} failed (${r.terminationReason}): ${r.stderr || r.stdout}`);
      return r.stdout;
    };
    await run(!indexed ? ['init', key, '--yes'] : ['sync', key]);
    const status = JSON.parse(await run(['status', key, '--json']));
    if (!status.initialized || !status.fileCount || status.index?.state !== 'complete' || status.index?.pendingRefs || status.index?.reindexRecommended || Object.values(status.pendingChanges || {}).some((n) => Number(n) > 0)) throw new Error('CodeGraph index is empty, incomplete, outdated, or still has pending changes. Rebuild the index explicitly before using it.');
    const client = new McpStdioClient({ label: 'CodeGraph', command: bundledNode, args: [...flags, serverEntry, 'serve', '--mcp', '--path', key, '--no-watch'], cwd: key, env, timeoutMs: options.timeoutMs ?? 120000, maxFrameBytes: options.maxFrameBytes, shutdownGraceMs: options.shutdownGraceMs });
    const health: CodegraphHealth = { installed: true, indexed: true, transport: 'unverified', freshness: 'snapshot', status: 'ready', fileCount: status.fileCount, verifiedAt: new Date().toISOString() };
    servers.set(key, { client, health, tail: Promise.resolve() });
    const probe = await client.tool('codegraph_status', {}, signal);
    if (!probe.ok || !/\*\*Files indexed:\*\* [1-9]/.test(probe.output) || /catch-up sync failed|auto-sync error/i.test(client.diagnostics)) throw new Error(probe.error || 'CodeGraph could not verify its loaded index.');
    health.transport = 'ready';
    return { ok: true, output: 'CodeGraph is ready against an explicitly refreshed snapshot. Watching is disabled; authorize refresh after edits.\n' + probe.output, health };
  } catch (e: any) {
    await shutdownCodegraph(key);
    return { ok: false, output: '', error: e.message, health: { installed: codegraphMcpInstalled(), indexed: fs.existsSync(path.join(key, '.codegraph', 'codegraph.db')), transport: 'failed', freshness: 'unknown', status: 'failed', error: e.message } };
  } finally { operations.delete(key); }
}
export async function codegraphExplore(workspace: string, query: string, signal?: AbortSignal, timeoutMs = 120000): Promise<ToolResult> {
  if (!query.trim()) return { ok: false, output: '', error: 'A CodeGraph query is required.' };
  const key = keyFor(workspace);
  const health = codegraphHealth(key);
  const entry = servers.get(key);
  if (health.status !== 'ready' || !entry?.client.alive) return { ok: false, output: '', error: `CodeGraph ${health.status}. Use Settings to authorize initialize/refresh. Read-only queries never start or refresh indexes.` };
  const operation = entry.tail.then(async () => {
    signal?.throwIfAborted();
    const r = await entry.client.tool('codegraph_explore', { query }, signal, timeoutMs);
    if (r.ok && /No relevant code found|isn't indexed|No CodeGraph project/.test(r.output)) return { ok: false, output: r.output, error: 'CodeGraph returned no usable indexed context.' };
    return r.ok ? { ok: true, output: `CodeGraph snapshot verified ${entry.health.verifiedAt}; current freshness unknown. Confirm edited files directly or authorize refresh.\n${r.output}` } : r;
  });
  entry.tail = operation.catch(() => {});
  try { return await operation; } catch (e: any) { return { ok: false, output: '', error: e.message }; }
}
