// Client for the official Ponytail stdio MCP server bundled under vendor/ponytail.
// The server owns the ruleset and mode resolution; EC12 only speaks MCP and returns its result.
import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from '@/shared/contracts';
import { callMcpTool } from './mcp-stdio';

const serverDir = path.join(process.cwd(), 'vendor', 'ponytail', 'ponytail-mcp');
const serverEntry = path.join(serverDir, 'index.js');

export const PONYTAIL_INSTALL_HINT = 'Run `npm run install:mcp` (or `node scripts/install-mcp.mjs ponytail`) to install it.';

export function ponytailMcpInstalled(): boolean {
  return [serverEntry, path.join(serverDir, 'instructions.js'), path.join(serverDir, '..', 'package.json'), path.join(serverDir, 'node_modules', '@modelcontextprotocol', 'sdk'), path.join(serverDir, 'node_modules', 'zod')].every((f) => fs.existsSync(f));
}

export function ponytailMcpStatus(): ToolResult {
  if (!fs.existsSync(serverEntry)) {
    return { ok: false, output: '', error: `Ponytail MCP is not installed at vendor/ponytail/ponytail-mcp. ${PONYTAIL_INSTALL_HINT}` };
  }
  if (!fs.existsSync(path.join(serverDir, 'node_modules', '@modelcontextprotocol', 'sdk'))) {
    return { ok: false, output: '', error: `Ponytail MCP dependencies are missing. ${PONYTAIL_INSTALL_HINT}` };
  }
  return ponytailMcpInstalled() ? { ok: true, output: 'Ponytail files installed; transport unverified.' } : { ok: false, output: '', error: `Ponytail server assets or dependencies are incomplete. ${PONYTAIL_INSTALL_HINT}` };
}

/** Invoke the official read-only Ponytail MCP tool through its stdio JSON-RPC transport. */
export async function ponytailInstructions(mode = 'full', signal?: AbortSignal, timeoutMs = 60000): Promise<ToolResult> {
  const status = ponytailMcpStatus();
  if (!status.ok) return status;
  if (!['lite', 'full', 'ultra'].includes(mode)) return { ok: false, output: '', error: 'Ponytail mode must be lite, full, or ultra.' };

  const call = await callMcpTool({
    label: 'Ponytail', command: process.execPath, args: ['index.js'], cwd: serverDir,
    tool: 'ponytail_instructions', arguments: { mode }, signal, timeoutMs,
  });
  if (!call.ok) return { ok: false, output: '', error: call.error || 'Ponytail MCP call failed.' };
  const resolvedMode = typeof call.structured?.mode === 'string' ? call.structured.mode : mode;
  return { ok: true, output: `Ponytail MCP (${resolvedMode}):\n${call.output}` };
}
