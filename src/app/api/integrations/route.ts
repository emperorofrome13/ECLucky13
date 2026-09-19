import { checkRequest, forbidden } from '@/server/security/auth';
import { ponytailMcpInstalled, ponytailMcpStatus } from '@/server/ponytail-mcp';
import { codegraphMcpInstalled, codegraphHealth } from '@/server/codegraph-mcp';
import { getWorkspace } from '@/server/workspace/path-policy';
import { readFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import type { IntegrationStatus } from '@/shared/contexttools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function probe(port: number, host = '127.0.0.1', timeout = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    let done = false;
    const fin = (v: boolean) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeout); s.on('connect', () => fin(true)); s.on('error', () => fin(false)); s.on('timeout', () => fin(false));
  });
}

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  let lmStudio = false;
  try { lmStudio = await probe(1234); } catch { lmStudio = false; }
  let browser = false;
  try {
    const { createRequire } = await import('node:module');
    const req2 = createRequire(import.meta.url);
    const pw = req2('playwright-core');
    const exe = pw.chromium?.executablePath?.();
    browser = !!exe && existsSync(exe);
  } catch { browser = false; }
  let rtk = false;
  try {
    const { execSync } = await import('node:child_process');
    execSync(process.platform === 'win32' ? 'where rtk' : 'command -v rtk', { stdio: 'ignore', timeout: 4000 });
    rtk = true;
  } catch { rtk = false; }

  const details: IntegrationStatus['details'] = {
    rtk: { installed: rtk, status: rtk ? 'installed' : 'unavailable', message: rtk ? 'RTK found on PATH; use Test to verify the rewrite integration.' : 'Not installed. Run: winget install rtk-ai.rtk' },
    ponytail: { ...ponytailMcpStatus(), installed: ponytailMcpInstalled(), status: ponytailMcpInstalled() ? 'installed' : 'unavailable', actions: ['test'] },
  };
  const ponytailResult = details.ponytail!;
  ponytailResult.message = ponytailResult.installed ? ponytailResult.output : ponytailResult.error;

  const workspace = getWorkspace(String(new URL(req.url).searchParams.get('workspaceId') || ''));
  const health = workspace ? codegraphHealth(workspace.path) : null;
  details.codegraph = health
    ? {
        installed: health.installed,
        status: health.status === 'ready' ? 'ready' : health.status === 'failed' ? 'failed' : health.status === 'unavailable' ? 'unavailable' : 'installed',
        message: !health.installed
          ? 'Not installed. Run npm run install:mcp -- codegraph.'
          : health.status === 'unindexed'
            ? 'Installed. This workspace has no CodeGraph index yet — use Index to create one explicitly.'
            : health.status === 'authorization-required'
              ? 'Installed and indexed, but the MCP server is not running. Use Refresh to verify it explicitly. Read-only queries never start it.'
              : health.status === 'busy'
                ? 'A CodeGraph operation is already running for this workspace.'
                : health.status === 'ready'
                  ? `Ready against a verified snapshot${health.fileCount ? ` (${health.fileCount} files)` : ''}${health.verifiedAt ? ` at ${health.verifiedAt}` : ''}.`
                  : health.error || 'CodeGraph is not ready.',
        error: health.error,
        actions: health.installed ? ['test', 'index', 'refresh'] : [],
        workspaceId: workspace?.id,
      }
    : { installed: codegraphMcpInstalled(), status: codegraphMcpInstalled() ? 'installed' : 'unavailable', actions: [], message: 'Open a workspace to see CodeGraph index state.' };

  for (const id of ['search', 'context7', 'skills'] as const) {
    details[id] = { status: 'not-tested', actions: ['test'] };
  }

  let note = 'Arbitrary shell commands run with your OS privileges; there is no sandbox.';
  try {
    const versionPath = process.cwd() + '/VERSION';
    if (existsSync(versionPath)) note = readFileSync(versionPath, 'utf8').trim();
  } catch { /* note unchanged */ }

  return Response.json({ ok: true, lmStudio, browser, rtk, ponytail: ponytailMcpInstalled(), codegraph: codegraphMcpInstalled(), editor: 'codemirror', note, details });
}
