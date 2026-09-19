import { checkRequest, forbidden } from '@/server/security/auth';
import { getWorkspace } from '@/server/workspace/path-policy';
import { executeTool } from '@/server/tools/registry';
import { runProcess } from '@/server/tools/process';
import { resolveApiKey } from '@/server/security/secrets';
import { CONTEXT7_ENDPOINT } from '@/server/context7';
import { normalizeSettings, type ContextToolSettings } from '@/shared/settings-schema';
import { ponytailInstructions } from '@/server/ponytail-mcp';
import { codegraphControl, codegraphHealth } from '@/server/codegraph-mcp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TEST_CALLS: Record<string, { tool: string; args: Record<string, unknown>; setting: keyof ContextToolSettings }> = {
  search: { tool: 'web_search', args: { query: 'EC12 local coding agent' }, setting: 'search' },
  context7: { tool: 'context7_docs', args: { libraryId: '/vercel/next.js', query: 'How does the App Router define a route handler?' }, setting: 'context7' },
  codegraph: { tool: 'codegraph_explore', args: { query: 'Describe the main application entry point and its direct dependencies.' }, setting: 'codegraph' },
  skills: { tool: 'list_skills', args: {}, setting: 'skills' },
};

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const limits = normalizeSettings({ contextTools: body.contextTools }).contextTools;
  const id = String(body.tool || '').toLowerCase();
  const action = body.action === 'index' || body.action === 'refresh' || body.action === 'stop' ? body.action : 'test';
  const ws = getWorkspace(String(body.workspaceId || ''));
  const note = (d: Record<string, unknown>) => ({ ...d, action: action === 'test' ? undefined : action });

  if (id === 'ponytail') {
    const result = await ponytailInstructions('full', req.signal, limits.mcpTimeoutMs);
    return Response.json(note(result.ok ? { ok: true, status: 'ready', output: result.output } : { ok: false, status: 'failed', error: result.error }), { status: result.ok ? 200 : 503 });
  }
  if (id === 'rtk') {
    const result = await runProcess({ command: 'rtk', args: ['--version'], cwd: ws?.path || process.cwd(), timeoutMs: 5000, label: 'rtk-test', maxPreviewChars: 2000 });
    if (result.terminationReason === 'spawn-error') return Response.json(note({ ok: false, status: 'unavailable', error: 'RTK is not installed or is not on PATH. Install it with: winget install rtk-ai.rtk' }));
    if (result.exitCode !== 0 || result.terminationReason !== 'exited') return Response.json(note({ ok: false, status: 'failed', error: (result.stderr || result.stdout || 'rtk --version failed').trim() }));
    const banner = result.stdout.trim() || 'RTK is installed.';
    if (!/rtk/i.test(banner)) return Response.json(note({ ok: false, status: 'failed', error: `An unrelated "rtk" program answered --version. Output was: ${banner.slice(0, 200)}` }));
    const rewrite = await runProcess({ command: 'rtk', args: ['rewrite', 'git status'], cwd: ws?.path || process.cwd(), timeoutMs: 5000, label: 'rtk-rewrite-test', maxPreviewChars: 2000 });
    const candidate = rewrite.stdout.trim();
    const rewriteOk = rewrite.terminationReason === 'exited' && candidate && !/[\r\n]/.test(candidate) && /^rtk\s+git\s+status/.test(candidate);
    return Response.json(note({
      ok: rewriteOk, status: rewriteOk ? 'ready' : 'failed',
      output: banner + '\n' + rewrite.stdout.trim(),
      error: rewriteOk ? undefined : 'RTK did not verify a supported rewrite; commands will run unchanged (fail-open).',
    }));
  }
  if (id === 'codegraph' && action !== 'test') {
    if (!ws) return Response.json({ ok: false, error: 'Open a workspace first.' }, { status: 400 });
    const result = await codegraphControl(ws.path, action, true, req.signal, { timeoutMs: limits.codegraphTimeoutMs });
    const health = result.health;
    return Response.json(note({
      ok: result.ok,
      status: result.ok ? 'ready' : 'failed',
      output: result.output || undefined,
      error: result.error,
      detail: health,
    }));
  }

  const call = TEST_CALLS[id];
  if (!call) return Response.json({ ok: false, error: 'Unknown context tool.' }, { status: 400 });
  if (!ws) return Response.json({ ok: false, error: 'Open a workspace before testing context tools.' }, { status: 400 });

  const contextTools: ContextToolSettings = { ...limits, [call.setting]: true };

  if (id === 'codegraph') {
    const health = codegraphHealth(ws.path);
    if (health.status !== 'ready') {
      return Response.json(note({
        ok: false, status: health.status === 'unavailable' ? 'unavailable' : 'failed',
        output: JSON.stringify(health),
        error: health.error || (health.status === 'unindexed'
          ? 'This workspace has no CodeGraph index yet. Use Index to create one explicitly; testing does not build indexes.'
          : health.status === 'authorization-required'
            ? 'An index exists but the CodeGraph server is not running. Use Refresh to verify it explicitly.'
            : `CodeGraph is ${health.status}. Use Index/Refresh or check the install.`),
      }), { status: 503 });
    }
    // A transport probe, not a content assertion: the fixture workspace may legitimately have
    // no answer for the canned query, so "no usable indexed context" still proves the MCP
    // round-trip works and must not fail the readiness check.
    const probe = await executeTool({
      env: { workspacePath: ws.path, runId: 'context-tool-test', sessionId: 'context-tool-test', reviewMode: false },
      mode: 'ask',
      contextTools,
      signal: req.signal,
    }, 'codegraph_explore', call.args);
    const transport = probe.result.ok || /no usable indexed context|No relevant code found/.test(probe.result.error || '');
    return Response.json(note({
      ok: transport, status: transport ? 'ready' : 'failed',
      output: transport ? (probe.result.output || probe.result.error || '').slice(0, 2400) : undefined,
      error: transport ? undefined : probe.result.error,
    }));
  }

  if (id === 'context7') {
    contextTools.context7ApiKey = resolveApiKey(CONTEXT7_ENDPOINT, String(body.apiKey || ''));
  }
  const executed = await executeTool({
    env: { workspacePath: ws.path, runId: 'context-tool-test', sessionId: 'context-tool-test', reviewMode: false },
    mode: 'ask',
    contextTools,
    signal: req.signal,
  }, call.tool, call.args);
  const result = executed.result;
  return Response.json(note({ ok: result.ok, status: result.ok ? 'ready' : 'failed', output: result.output.slice(0, 2400), error: result.error }));
}
