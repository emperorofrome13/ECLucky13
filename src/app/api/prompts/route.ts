import * as fs from 'fs';
import * as path from 'path';
import { PROMPT_FILES, appAutopromptDir, workspaceAutopromptDir, readPrompt, promptSource, loadAgentsDocs, appRoot } from '@/server/prompt-files';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { checkRequest, forbidden } from '@/server/security/auth';

const LABELS: Record<string, string> = {
  system: 'system.md — main agent system prompt',
  review: 'review.md — Review stage',
  completeness: 'completeness.md — Completeness stage',
  senior_review: 'senior_review.md — Senior Review stage',
  run_fix: 'run_fix.md — Run / Fix stage',
  'AGENTS.md': 'AGENTS.md — EC11 app conventions (applies to every run)',
  'PROJECT_AGENTS.md': 'AGENTS.md — target project conventions (this workspace)',
};

export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const url = new URL(req.url);
  const workspace = url.searchParams.get('workspace') || undefined;
  const files: Array<{ name: string; label: string; content: string; source: string; writable: boolean }> = PROMPT_FILES.map((name) => ({
    name,
    label: LABELS[name] || name,
    content: readPrompt(name, workspace),
    source: promptSource(name, workspace),
    writable: true,
  }));
  const agents = loadAgentsDocs(workspace);
  files.push({ name: 'AGENTS.md', label: LABELS['AGENTS.md'], content: agents.app, source: 'app', writable: true });
  if (workspace) {
    files.push({ name: 'PROJECT_AGENTS.md', label: LABELS['PROJECT_AGENTS.md'], content: agents.project, source: agents.project ? 'workspace' : 'builtin', writable: true });
  }
  return Response.json({
    ok: true,
    appDir: appAutopromptDir(),
    appRoot: appRoot(),
    files,
  });
}

export async function PUT(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '');
  const content = String(body.content ?? '');
  const scope = String(body.scope || 'app');
  const workspace = body.workspace ? String(body.workspace) : undefined;

  let file: string;
  if (name === 'AGENTS.md') {
    file = path.join(appRoot(), 'AGENTS.md');
  } else if (name === 'PROJECT_AGENTS.md') {
    if (!workspace) return Response.json({ ok: false, error: 'workspace is required for PROJECT_AGENTS.md' }, { status: 400 });
    file = path.join(workspace, 'AGENTS.md');
  } else if ((PROMPT_FILES as readonly string[]).includes(name)) {
    let dir = appAutopromptDir();
    if (scope === 'workspace') {
      const wsDir = workspaceAutopromptDir(workspace);
      if (!wsDir) return Response.json({ ok: false, error: 'workspace is required for scope=workspace' }, { status: 400 });
      dir = wsDir;
    }
    file = path.join(dir, name + '.md');
  } else {
    return Response.json({ ok: false, error: `Unknown prompt "${name}".` }, { status: 400 });
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return Response.json({ ok: true, file, scope });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}

