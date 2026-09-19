// Tool registry. Plain JSON-schema tools (local-model safe). Mode permissions are enforced HERE,
// not just in prompts: ask/plan are read-only and cannot reach arbitrary shell or writes.
import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult, Mode } from '@/shared/contracts';
import type { ContextToolSettings } from '@/shared/settings-schema';
import { runProcess, pmCommand } from './process';
import { startShell, inspectShell, fullShellOutput } from './managed-shell';
import { overlayRead, editFile, writeFile, deleteFile, type JournalEnv } from '../workspace/change-journal';
import { resolveInWorkspace } from '../workspace/path-policy';
import { readMcpServers, discoverMcpTools, callCustomMcpTool, redactMcp, type McpTool } from '../custom-mcp';
import type { CustomMcpServer } from '@/shared/settings-schema';
import { createOutputCapture, withOutputCapture, captureOutput, redactOutputValue, type OutputArtifact } from '../output-artifacts';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; mutating: boolean }

/** v1.13 token diet: cap what a tool's output may contribute to conversation history. Full output
 * still reaches the UI/event log; only the replayed copy is bounded. Shell output is tail-capped
 * in managed-shell (errors live at the end of build logs); everything else is head-capped here. */
const OUTPUT_CAPS: Partial<Record<string, number>> = {
  codegraph_explore: 12000,
  context7_docs: 12000,
  ponytail_instructions: 12000,
  read_skill: 12000,
  list_files: 8000,
  web_search: 6000,
  syntax_check: 4000,
  todo: 4000,
};
function capToolOutput(name: string, text: string, configured?: number): string {
  const cap = configured ?? OUTPUT_CAPS[name];
  if (!cap || !text || text.length <= cap) return text;
  return text.slice(0, cap) + `\n…[output truncated at ${cap} characters for context; full text retained in output artifact; narrow the query or increase toolOutputMaxChars]`;
}

export const TOOLS: ToolDef[] = [
  { name: 'mcp_discover_tools', description: 'Discover tools from user-configured custom MCP servers for this run. Returns namespaced names, input schemas and visible server errors. Call before mcp_call_tool. Configuration and credentials are server-owned.', mutating: false, parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'mcp_call_tool', description: 'Execute a namespaced tool returned by mcp_discover_tools with its documented arguments. Only trusted user-configured servers are available; command, URL and credentials cannot be supplied here. No approval is required in Code mode.', mutating: false, parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object', additionalProperties: true } }, required: ['name', 'arguments'] } },
  { name: 'search_files', description: 'Search text across workspace files. Returns file paths, line numbers and matching lines. Ignores dependencies/build outputs; offset supports paging.', mutating: false, parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'attempt_completion', description: 'Finish the coding task with a summary and exact run command. The harness independently verifies the changes before accepting completion.', mutating: false, parameters: { type: 'object', properties: { result: { type: 'string' }, command: { type: 'string' } }, required: ['result'] } },
  { name: 'read_file', description: 'Read a workspace file and full-file hash. offset is a 1-based line; limit counts lines; character_offset continues inside a long line.', mutating: false, parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 }, character_offset: { type: 'integer', minimum: 0 } }, required: ['path'] } },
  { name: 'list_files', description: 'List a workspace directory.', mutating: false, parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] } },
  { name: 'edit_file', description: 'Exact literal replacement in an existing file. old_string must be unique unless replace_all. Pass before_hash from read_file to detect stale edits.', mutating: true, parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' }, before_hash: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } },
  { name: 'write_file', description: 'Create or overwrite a file.', mutating: true, parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, before_hash: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'delete_file', description: 'Delete a workspace file.', mutating: true, parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'shell_command', description: 'Run PowerShell in the workspace. Long commands yield a process_id and keep running, without an execution timeout. Use shell_process to poll builds/tests until they exit. For dev servers/quickstart, launch here then check readiness separately. Do not use Unix trailing & in Windows PowerShell.', mutating: true, parameters: { type: 'object', properties: { command: { type: 'string' }, yield_ms: { type: 'number', description: 'How long to await initial output (0 to 10000 ms, default 1000). Does not kill or time-limit the command.' } }, required: ['command'] } },
  { name: 'shell_process', description: 'Read output and status of a process returned by shell_command. Use action wait for builds/tests until an exit code is available, or stop to terminate a server. Running is not a passed check. action read_full returns every character of output so far plus recorded workspace changes.', mutating: true, parameters: { type: 'object', properties: { process_id: { type: 'string' }, action: { type: 'string', enum: ['wait', 'stop', 'read_full'] }, wait_ms: { type: 'number', description: 'Response wait only, 0 to 10000 ms; default 1000.' } }, required: ['process_id'] } },
  { name: 'syntax_check', description: 'Syntax-check a file (node --check for JS, py_compile for Python).', mutating: false, parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'todo', description: 'Record the plan as a list of steps.', mutating: false, parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } } }, required: ['steps'] } },
  { name: 'ask_user', description: 'Ask the user a question when a requirement or permission is genuinely missing.', mutating: false, parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] } },
  { name: 'report_verdict', description: 'Report the stage verdict. Authoritative and structured.', mutating: false, parameters: { type: 'object', properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, summary: { type: 'string' } }, required: ['verdict', 'summary'] } },
  { name: 'web_search', description: 'Search the web for current information.', mutating: false, parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'ponytail_instructions', description: 'Fetch the official Ponytail coding rules through its local MCP server. Call before planning or editing when Ponytail is enabled.', mutating: false, parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['lite', 'full', 'ultra'] } }, required: [] } },
  { name: 'context7_docs', description: 'Fetch current library docs via Context7.', mutating: false, parameters: { type: 'object', properties: { libraryName: { type: 'string' }, libraryId: { type: 'string' }, query: { type: 'string' } }, required: ['query'] } },
  { name: 'codegraph_explore', description: 'Explore the official CodeGraph semantic index. Ask a concrete question about definitions, callers, callees, impact, or architecture.', mutating: false, parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_skills', description: 'List global skills.', mutating: false, parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'read_skill', description: 'Read a global skill (SKILL.md or a file inside it).', mutating: false, parameters: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' } }, required: ['name'] } },
];

export function allowedForMode(mode: Mode, tool: ToolDef): boolean {
  if (mode === 'code') return true;
  return !tool.mutating; // ask/plan: read-only
}

const CONTEXT_TOOL_GATES: Partial<Record<string, keyof ContextToolSettings>> = {
  web_search: 'search',
  ponytail_instructions: 'ponytail',
  context7_docs: 'context7',
  codegraph_explore: 'codegraph',
  list_skills: 'skills',
  read_skill: 'skills',
};

export function contextGateForTool(name: string): keyof ContextToolSettings | undefined {
  return CONTEXT_TOOL_GATES[name];
}

export function isToolEnabled(name: string, settings: Partial<ContextToolSettings>): boolean {
  const gate = contextGateForTool(name);
  return !gate || settings[gate] === true;
}

/** The same allow-list drives provider schemas and execution, so a disabled tool cannot be called by name. */
export function toolsForRun(mode: Mode, settings: Partial<ContextToolSettings>, includeVerdict = false): ToolDef[] {
  captureMcpSnapshot(settings);
  return TOOLS.filter((tool) => allowedForMode(mode, tool)
    && (includeVerdict || tool.name !== 'report_verdict')
    && isToolEnabled(tool.name, settings));
}

export interface ToolContext {
  env: JournalEnv;
  mode: Mode;
  contextTools: Partial<ContextToolSettings>;
  signal?: AbortSignal;
  toolCallId?: string;
  onAskUser?: (q: string, options?: string[]) => Promise<string>;
}

type McpSnapshot = { servers: CustomMcpServer[]; error?: string; runs: Map<string, Promise<CustomRegistry>> };
type CustomRegistry = { tools: McpTool[]; errors: string[]; servers: CustomMcpServer[] };
const mcpSnapshots = new WeakMap<object, McpSnapshot>();
function captureMcpSnapshot(settings: Partial<ContextToolSettings>): McpSnapshot {
  let snapshot = mcpSnapshots.get(settings);
  if (!snapshot) {
    try { snapshot = { servers: readMcpServers(), runs: new Map() }; }
    catch (e: any) { snapshot = { servers: [], error: String(e.message), runs: new Map() }; }
    mcpSnapshots.set(settings, snapshot);
  }
  return snapshot;
}
async function customRegistry(ctx: ToolContext): Promise<CustomRegistry> {
  const snapshot = captureMcpSnapshot(ctx.contextTools);
  const key = ctx.env.runId + ':' + ctx.env.workspacePath;
  let pending = snapshot.runs.get(key);
  if (!pending) {
    pending = (async () => {
      const tools: McpTool[] = [], errors: string[] = snapshot.error ? [snapshot.error] : [];
      const names = new Set(TOOLS.map((tool) => tool.name));
      for (const server of snapshot.servers) {
        if (!server.enabled) { errors.push(`${server.name}: disabled for this run.`); continue; }
        if (ctx.signal?.aborted) throw new Error('MCP discovery cancelled.');
        try {
          const discovered = await discoverMcpTools(server, ctx.env.workspacePath, ctx.signal);
          for (const tool of discovered) {
            if (names.has(tool.name)) throw new Error('MCP tool namespace collision.');
            names.add(tool.name);
          }
          tools.push(...discovered);
        } catch (e: any) { errors.push(`${server.name}: ${redactMcp(String(e.message), server)}`); }
      }
      return { tools, errors, servers: snapshot.servers };
    })();
    snapshot.runs.set(key, pending);
  }
  return pending;
}
export async function buildRegistry(ctx: ToolContext, includeVerdict = false) {
  const builtin = toolsForRun(ctx.mode, ctx.contextTools, includeVerdict);
  const custom = await customRegistry(ctx);
  return { tools: [...builtin, ...custom.tools.filter((tool) => allowedForMode(ctx.mode, tool))], errors: custom.errors, execute: (name: string, args: any) => executeTool(ctx, name, args) };
}
async function executeCustomMcp(ctx: ToolContext, name: string, args: any): Promise<ToolExecution> {
  try {
    const registry = await customRegistry(ctx);
    if (name === 'mcp_discover_tools') {
      const tools = registry.tools.filter((tool) => allowedForMode(ctx.mode, tool));
      const output = JSON.stringify({ tools, errors: registry.errors, message: tools.length ? 'Call mcp_call_tool with a returned name and arguments matching its parameters.' : 'No custom MCP tools available. Configure or enable servers in Settings > MCP servers for the next run.' });
      return { result: { ok: registry.errors.length === 0, output, ...(registry.errors.length ? { error: registry.errors.join('\n') } : {}) } };
    }
    const toolName = name === 'mcp_call_tool' ? args?.name : name;
    const tool = registry.tools.find((item) => item.name === toolName);
    if (!tool) return { result: { ok: false, output: '', error: 'MCP tool unavailable: missing, disabled, or discovery failed. Use mcp_discover_tools. ' + registry.errors.join('\n') } };
    if (!allowedForMode(ctx.mode, tool)) return { result: { ok: false, output: '', error: `MCP tool is not allowed in ${ctx.mode} mode (read-only).` } };
    const server = registry.servers.find((item) => item.id === tool.serverId);
    if (!server) return { result: { ok: false, output: '', error: 'MCP server is missing from this run snapshot.' } };
    return { result: await callCustomMcpTool(server, tool, name === 'mcp_call_tool' ? args.arguments : args, ctx.env.workspacePath, ctx.signal) };
  } catch (e: any) { return { result: { ok: false, output: '', error: String(e.message) } }; }
}

export interface ToolExecution { result: ToolResult; changeId?: string; path?: string; artifact?: OutputArtifact; processArtifact?: OutputArtifact; artifactError?: string }

const arg = (a: any, ...names: string[]) => { for (const n of names) if (a?.[n] !== undefined && a[n] !== null) return a[n]; return undefined; };

async function syntaxCheck(env: JournalEnv, rel: string, signal?: AbortSignal): Promise<ToolResult> {
  const abs = resolveInWorkspace(env.workspacePath, rel);
  if (!fs.existsSync(abs)) return { ok: false, output: '', error: 'file not found: ' + rel };
  const ext = path.extname(abs).toLowerCase();
  let r;
  if (['.js', '.mjs', '.cjs'].includes(ext)) r = await runProcess({ command: process.execPath, args: ['--check', abs], cwd: env.workspacePath, timeoutMs: 0, signal, label: 'nodecheck' });
  else if (ext === '.py') r = await runProcess({ command: 'python', args: ['-m', 'py_compile', abs], cwd: env.workspacePath, timeoutMs: 0, signal, label: 'pycompile' });
  else return { ok: true, output: `no syntax check available for ${ext || 'this file type'} (not claiming it passed)` };
  return { ok: r.exitCode === 0, output: r.exitCode === 0 ? 'syntax ok' : '', error: r.exitCode === 0 ? undefined : (r.stderr || r.stdout).slice(0, 2000) || 'check failed' };
}

/** Errors are replayed to the model too, so a failing tool must not be able to flood the context
 * with an unbounded stack trace or a megabyte of stderr. */
const ERROR_CAP = 4000;

export async function executeTool(ctx: ToolContext, name: string, args: any): Promise<ToolExecution> {
  let capture;
  try { capture = createOutputCapture(ctx.env, ctx.toolCallId || '', name, [ctx.contextTools.context7ApiKey || '']); }
  catch { return { result: { ok: false, output: '', error: 'Tool was not executed: output archive could not be created.' }, artifactError: 'Output archive unavailable.' }; }
  return withOutputCapture(capture, async () => {
    let exec: ToolExecution;
    try {
      exec = name === 'mcp_discover_tools' || name === 'mcp_call_tool' || /^mcp_[a-f0-9]{56}$/.test(name)
        ? await executeCustomMcp(ctx, name, args) : await executeToolInner(ctx, name, args);
      exec.result = redactOutputValue(exec.result, capture.secrets);
      capture.append('result', exec.result);
    } catch {
      return { result: { ok: false, output: '', error: 'Tool output persistence failed; the archive may be incomplete. Check storage before retrying.' }, artifact: capture.artifact, artifactError: 'Output archive may be incomplete.' };
    }
    if (exec.artifact && exec.artifact.artifactId !== capture.artifact.artifactId) exec.processArtifact = exec.artifact;
    exec.artifact = capture.artifact;
    if (exec.result.output && !['read_file', 'search_files', 'shell_command', 'shell_process'].includes(name)) exec.result.output = capToolOutput(name, exec.result.output, ctx.contextTools.toolOutputMaxChars);
    const errorCap = ctx.contextTools.toolOutputMaxChars ?? ERROR_CAP;
    if (errorCap > 0 && exec.result.error && exec.result.error.length > errorCap) {
      exec.result.error = exec.result.error.slice(0, errorCap) + '\n[error preview truncated; full detail retained in output artifact]';
    }
    return exec;
  });
}

async function executeToolInner(ctx: ToolContext, name: string, args: any): Promise<ToolExecution> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { result: { ok: false, output: '', error: `Unknown tool: ${name}` } };
  if (!allowedForMode(ctx.mode, def)) return { result: { ok: false, output: '', error: `Tool "${name}" is not allowed in ${ctx.mode} mode (read-only).` } };
  const gate = contextGateForTool(name);
  if (gate && !isToolEnabled(name, ctx.contextTools)) {
    return { result: { ok: false, output: '', error: `Context tool "${name}" is disabled. Enable ${gate} in Settings > Tools.` } };
  }
  const env = ctx.env;
  try {
    switch (name) {
      case 'search_files': return { result: await searchFiles(env.workspacePath, args, ctx.signal, ctx.contextTools.searchOutputMaxChars) };
      case 'attempt_completion': return { result: { ok: true, output: String(args.result || args.summary || 'Ready for verification.') } };
      case 'read_file': {
        const rel = String(arg(args, 'path', 'file_path') || '');
        const r = overlayRead(env, rel);
        if (!r.exists) return { result: { ok: false, output: '', error: `File not found: ${rel}` } };
        const { createHash } = await import('node:crypto');
        const hash = createHash('sha1').update(r.text).digest('hex');
        captureOutput('file', { path: rel, hash, text: r.text });
        const legacy = !args.offset && !args.limit && !args.character_offset;
        const lines = r.text.split('\n');
        const offset = Math.max(1, Math.floor(Number(args.offset) || 1));
        const limit = Math.max(1, Math.floor(Number(args.limit) || lines.length));
        if (legacy) {
          const max = ctx.contextTools.readFileMaxChars ?? 24000;
          const body = max > 0 && r.text.length > max
            ? r.text.slice(0, Math.floor(max * 0.8)) + `\n[middle truncated (${r.text.length} characters total); re-read with offset to page through]` + r.text.slice(-Math.floor(max * 0.2))
            : r.text;
          return { result: { ok: true, output: `path: ${rel}\nhash: ${hash}\n---\n${body}` } };
        }
        let line = offset - 1;
        let column = Math.max(0, Math.floor(Number(args.character_offset) || 0));
        const max = ctx.contextTools.readFileMaxChars ?? 24000;
        let remaining = max > 0 ? max : Infinity;
        const chunks: string[] = [];
        while (line < lines.length && line < offset - 1 + limit && remaining > 0) {
          const text = lines[line].slice(column);
          const take = Math.min(text.length, remaining);
          chunks.push(`${line + 1}: ${text.slice(0, take)}`);
          remaining -= take + 1;
          if (take < text.length) { column += take; break; }
          column = 0; line++;
        }
        const more = line < lines.length;
        const next = more ? `\n[more content: offset ${line + 1}, character_offset ${column}; full file remains in workspace]` : '';
        return { result: { ok: true, output: `path: ${rel}\nhash: ${hash}\n---\n${chunks.join('\n')}${next}` } };
      }
      case 'list_files': {
        const rel = String(arg(args, 'path') || '.');
        const abs = resolveInWorkspace(env.workspacePath, rel);
        if (!fs.existsSync(abs)) return { result: { ok: true, output: '(empty)' } };
        const items = fs.readdirSync(abs, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name));
        return { result: { ok: true, output: items.join('\n') } };
      }
      case 'edit_file': {
        const rel = String(arg(args, 'path', 'file_path') || '');
        const r = editFile(env, rel, String(arg(args, 'old_string', 'old_text') ?? ''), String(arg(args, 'new_string', 'new_text') ?? ''), !!arg(args, 'replace_all'), arg(args, 'before_hash'));
        if (!r.ok) return { result: { ok: false, output: '', error: (r as { error: string }).error } };
        return { result: { ok: true, output: `edited ${rel}` }, changeId: r.record.changeId, path: rel };
      }
      case 'write_file': {
        const rel = String(arg(args, 'path', 'file_path') || '');
        const r = writeFile(env, rel, String(arg(args, 'content', 'text') ?? ''), arg(args, 'before_hash'));
        if (!r.ok) return { result: { ok: false, output: '', error: (r as { error: string }).error } };
        return { result: { ok: true, output: `wrote ${rel}` }, changeId: r.record.changeId, path: rel };
      }
      case 'delete_file': {
        const rel = String(arg(args, 'path', 'file_path') || '');
        const r = deleteFile(env, rel);
        if (!r.ok) return { result: { ok: false, output: '', error: (r as { error: string }).error } };
        return { result: { ok: true, output: `deleted ${rel}` }, changeId: r.record.changeId, path: rel };
      }
      case 'shell_command': {
        const requestedCommand = String(arg(args, 'command') || '');
        let command = requestedCommand;
        if (!command.trim()) return { result: { ok: false, output: '', error: 'command required' } };
        let rtkNote = '';
        if (ctx.contextTools.rtk) {
          // RTK's supported integration contract is `rtk rewrite <command>`. It fails open:
          // absent/old RTK or a command without a rewrite keeps the original PowerShell command.
          const rewrite = await runProcess({ command: 'rtk', args: ['rewrite', command], cwd: env.workspacePath, timeoutMs: 5000, signal: ctx.signal, label: 'rtk-rewrite', maxPreviewChars: 8000 });
          const candidate = rewrite.stdout.trim();
          if (rewrite.terminationReason === 'exited' && candidate && !/[\r\n]/.test(candidate) && /^rtk\s/.test(candidate) && candidate !== command) {
            command = candidate;
            rtkNote = `\n[RTK rewrote: ${requestedCommand} -> ${command}]`;
          } else {
            rtkNote = '\n[RTK did not produce a successful supported rewrite; command unchanged]';
          }
        }
        const execution = await startShell(env, command, ctx.signal, Number.isFinite(args.yield_ms) ? args.yield_ms : 1000, ctx.contextTools.shellOutputMaxChars);
        execution.result.output += rtkNote;
        return execution;
      }
      case 'shell_process': if (args.action === 'read_full') {
        const full = fullShellOutput(env, String(args.process_id || ''));
        return full.ok ? { result: { ok: true, output: full.output + (full.changes?.length ? '\nWorkspace change IDs: ' + full.changes.join(', ') : '') } } : { result: { ok: false, output: '', error: full.error } };
      } return inspectShell(env, String(args.process_id || ''), args.action === 'stop', Number.isFinite(args.wait_ms) ? args.wait_ms : 1000, ctx.signal, ctx.contextTools.shellOutputMaxChars);
      case 'syntax_check':
        return { result: await syntaxCheck(env, String(arg(args, 'path') || ''), ctx.signal) };
      case 'todo':
        return { result: { ok: true, output: 'TODO:\n' + (Array.isArray(args?.steps) ? args.steps.join('\n') : String(args?.steps || '')) } };
      case 'ask_user': {
        const q = String(arg(args, 'question') || '');
        if (!ctx.onAskUser) return { result: { ok: false, output: '', error: 'Interactive questions are unavailable in this stage. Explain what is missing in your result.' } };
        const answer = await ctx.onAskUser(q, arg(args, 'options'));
        return { result: { ok: true, output: 'User answer: ' + answer } };
      }
      case 'report_verdict':
        return { result: { ok: true, output: `VERDICT:${String(arg(args, 'verdict') || 'FAIL')}|${String(arg(args, 'summary') || '')}` } };
      case 'web_search':
        return { result: await webSearch(String(arg(args, 'query') || ''), ctx.signal, ctx.contextTools.webTimeoutMs) };
      case 'ponytail_instructions': {
        const { ponytailInstructions } = await import('../ponytail-mcp');
        return { result: await ponytailInstructions(String(arg(args, 'mode') || 'full'), ctx.signal, ctx.contextTools.mcpTimeoutMs) };
      }
      case 'codegraph_explore': {
        const { codegraphExplore } = await import('../codegraph-mcp');
        return { result: await codegraphExplore(env.workspacePath, String(arg(args, 'query') || ''), ctx.signal, ctx.contextTools.codegraphTimeoutMs) };
      }
      case 'list_skills': {
        const { listSkills } = await import('../prompts');
        const s = listSkills();
        return { result: { ok: true, output: s.length ? s.map((x) => `- ${x.name}: ${x.description}`).join('\n') : 'No global skills found.' } };
      }
      case 'read_skill': {
        const { readSkill } = await import('../prompts');
        const r = readSkill(String(arg(args, 'name') || ''), String(arg(args, 'file') || 'SKILL.md'));
        return { result: r.ok ? { ok: true, output: `# SKILL: ${r.skill}\n\n${r.content}` } : { ok: false, output: '', error: r.error } };
      }
      case 'context7_docs': {
        const { context7Docs } = await import('../context7');
        return { result: await context7Docs(String(arg(args, 'query') || ''), arg(args, 'libraryName'), arg(args, 'libraryId'), ctx.contextTools.context7ApiKey || '', { signal: ctx.signal, timeoutMs: ctx.contextTools.context7TimeoutMs }) };
      }
      default:
        return { result: { ok: false, output: '', error: 'Unknown tool: ' + name } };
    }
  } catch (e: any) {
    return { result: { ok: false, output: '', error: String(e?.message || e) } };
  }
}

export async function webSearch(query: string, signal?: AbortSignal, timeoutMs = 15000): Promise<ToolResult> {
  if (!query.trim()) return { ok: false, output: '', error: 'query required' };
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: timeoutMs > 0 ? AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]) : signal });
    if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
    const html = await res.text();
    if (/anomaly-modal|captcha|challenge-form/i.test(html)) throw new Error('Search provider requires a browser challenge.');
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    const results: string[] = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < 5) {
      let url = m[1]; const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
      results.push(`${results.length + 1}. ${strip(m[2])}\n   ${url}`);
    }
    if (!results.length && !/no-results|No results found/i.test(html)) throw new Error('Search returned an unrecognized response, not verified empty results.');
    return { ok: true, output: results.length ? results.join('\n\n') : 'No results found.' };
  } catch (e: any) { return { ok: false, output: '', error: 'web_search failed: ' + String(e?.message || e) }; }
}

export async function searchFiles(workspace: string, args: any, signal?: AbortSignal, outputMaxChars = 16000): Promise<ToolResult> {
  const query = String(args.query || '');
  if (!query) return { ok: false, output: '', error: 'A search query is required.' };
  const root = resolveInWorkspace(workspace, String(args.path || '.'));
  const skip = new Set(['node_modules', '.git', '.next', '.next-build', 'dist', 'build', 'backup', '.npm-cache', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', 'vendor', '.codegraph', 'data', 'test-output']);
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(args.limit) || 100)));
  let matches = 0, more = false;
  const found: string[] = [];
  const MAX_OUTPUT_CHARS = outputMaxChars > 0 ? outputMaxChars : Infinity;
  let outputChars = 0;
  let rootStat: fs.Stats;
  try { rootStat = await fs.promises.stat(root); await fs.promises.access(root, fs.constants.R_OK); }
  catch (e: any) { return { ok: false, output: '', error: `Search root is unreadable: ${e.message}` }; }
  if (!rootStat.isFile() && !rootStat.isDirectory()) return { ok: false, output: '', error: 'Search path is not a regular file or directory.' };
  const visit = async (dir: string): Promise<void> => {
    signal?.throwIfAborted();
    // Any Python environment name is supported, including project-specific ones.
    if (rootStat.isDirectory() && await fs.promises.stat(path.join(dir, 'pyvenv.cfg')).then(() => true, () => false)) return;
    let entries: import('node:fs').Dirent[];
    try { entries = rootStat.isFile() ? [Object.assign(await fs.promises.stat(root), { name: path.basename(root) }) as any] : await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { if (dir === root || rootStat.isFile()) throw e; return; }
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.isSymbolicLink() || skip.has(entry.name) || more) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { await visit(abs); continue; }
      if (!entry.isFile()) continue;
      // A single unreadable file (permissions, a vanished temp file, a device node) must not abort
      // the whole search; skip it and keep going.
      let text: string;
      try {
        if ((await fs.promises.stat(abs)).size > 2_000_000) continue;
        text = await fs.promises.readFile(abs, 'utf8');
      } catch { continue; }
      signal?.throwIfAborted();
      if (text.includes('\0')) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) if (lines[i].includes(query)) {
        if (matches++ < offset) continue;
        if (found.length >= limit) { more = true; break; }
        const line = `${(path.relative(workspace, abs) || path.basename(abs)).replace(/\\/g, '/')}:${i + 1}: ${lines[i].slice(0, 300)}`;
        if (outputChars + line.length > MAX_OUTPUT_CHARS && found.length) { more = true; break; }
        outputChars += line.length + 1;
        found.push(line);
      }
    }
  };
  await visit(rootStat.isFile() ? path.dirname(root) : root);
  const emitted = found.length;
  return { ok: true, output: (found.join('\n') || 'No matches.') + (more ? `\nMore matches available; use offset ${offset + emitted}, or narrow the query/path/limit.` : '') };
}
