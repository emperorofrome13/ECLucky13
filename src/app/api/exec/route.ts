import { checkRequest, forbidden } from '@/server/security/auth';
import { getWorkspace } from '@/server/workspace/path-policy';
import { runPowerShell } from '@/server/tools/process';
import { runs } from '@/server/runs/manager';
import { snapshotWorkspace, reconcileShellChanges, withWorkspaceLock, type JournalEnv } from '@/server/workspace/change-journal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const ws = getWorkspace(String(body?.workspaceId || ''));
  if (!ws) return Response.json({ ok: false, error: 'Unknown workspace.' }, { status: 404 });
  const command = String(body?.command || '').trim();
  if (!command) return Response.json({ ok: false, error: 'command required' }, { status: 400 });
  const timeoutMs = body.timeoutMs === undefined ? 120000 : Number(body.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Response.json({ ok: false, error: 'timeoutMs must be a non-negative number.' }, { status: 400 });
  return withWorkspaceLock(ws.path, async () => {
    runs.ensureRecovered();
    if (runs.activeForWorkspace(ws.path)) return Response.json({ ok: false, error: 'Stop the active workspace run before using the terminal.' }, { status: 409 });
    if (req.signal.aborted) return Response.json({ ok: false, cancelled: true, error: 'Request cancelled before execution.' }, { status: 409 });
    let before: ReturnType<typeof snapshotWorkspace>;
    try { before = snapshotWorkspace(ws.path); } catch (e: any) {
      return Response.json({ ok: false, error: 'Command was not started: snapshot failed. ' + String(e?.message || e) }, { status: 500 });
    }
    const env: JournalEnv = { workspacePath: ws.path, runId: 'terminal', sessionId: 'terminal', reviewMode: false };
    let result: Awaited<ReturnType<typeof runPowerShell>> | undefined;
    let executionError: string | undefined;
    let reconciliationError: string | undefined;
    let skipped = before.skipped;
    let changeIds: string[] = [];
    try { result = await runPowerShell(command, ws.path, { timeoutMs, signal: req.signal, label: 'terminal' }); }
    catch (e: any) { executionError = String(e?.message || e); }
    finally {
      try {
        const rec = reconcileShellChanges(env, before, 'terminal:' + command.slice(0, 60));
        changeIds = rec.changes.map((c) => c.changeId); skipped = rec.skipped;
      } catch (e: any) { reconciliationError = String(e?.message || e); }
    }
    const commandOk = !!result && result.exitCode === 0 && !result.cancelled && !result.timedOut;
    return Response.json({
      ok: commandOk && !reconciliationError, commandOk, error: executionError || reconciliationError,
      exitCode: result?.exitCode ?? null, output: [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim() || '(no output)',
      durationMs: result?.durationMs, timedOut: result?.timedOut ?? false, cancelled: result?.cancelled ?? req.signal.aborted,
      artifactPath: result?.artifactPath, workspaceChanges: changeIds.length, changeIds,
      reconciliation: { ok: !reconciliationError, complete: !reconciliationError && skipped === 0, skipped, error: reconciliationError },
    });
  });
}
