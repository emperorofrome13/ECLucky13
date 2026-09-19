// Workspace file access: tree/read/save. All paths are workspace-relative and policy-checked;
// saves go through the change journal (diffed + revertible).
import { checkRequest, forbidden } from '@/server/security/auth';
import { getWorkspace, resolveInWorkspace, relPath } from '@/server/workspace/path-policy';
import { saveManual, workspaceLocked } from '@/server/workspace/change-journal';
import { runs } from '@/server/runs/manager';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IGNORE = new Set(['node_modules', '.git', '.next', '.next-build', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache', 'data', 'workspaces']);

interface TreeNode { name: string; path: string; type: 'dir' | 'file'; children?: TreeNode[] }
function buildTree(abs: string, depth: number, maxDepth: number, root = abs): TreeNode[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return []; }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = path.join(abs, e.name);
    if (e.isDirectory()) nodes.push({ name: e.name, path: relPath(root, full), type: 'dir', children: depth < maxDepth ? buildTree(full, depth + 1, maxDepth, root) : [] });
    else nodes.push({ name: e.name, path: relPath(root, full), type: 'file' });
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return nodes;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const ws = getWorkspace(params.id);
  if (!ws) return Response.json({ ok: false, error: 'Unknown workspace.' }, { status: 404 });
  const url = new URL(req.url);
  const rel = url.searchParams.get('path') || '.';
  try {
    if (url.searchParams.get('tree') === '1') {
      const depth = Math.min(Math.max(parseInt(url.searchParams.get('depth') || '4', 10), 1), 8);
      return Response.json({ ok: true, type: 'tree', tree: buildTree(ws.path, 0, depth) });
    }
    const abs = resolveInWorkspace(ws.path, rel);
    if (!fs.existsSync(abs)) return Response.json({ ok: false, error: 'not found' });
    const st = fs.statSync(abs);
    if (st.isDirectory()) return Response.json({ ok: true, type: 'dir', entries: fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })) });
    if (st.size > 2 * 1024 * 1024) return Response.json({ ok: false, error: 'File too large to open.' });
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return Response.json({ ok: false, error: 'Binary file cannot be displayed.' });
    const { createHash } = await import('node:crypto');
    return Response.json({ ok: true, type: 'file', path: rel, content: buf.toString('utf8'), hash: createHash('sha1').update(buf.toString('utf8')).digest('hex'), size: st.size });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const ws = getWorkspace(params.id);
  if (!ws) return Response.json({ ok: false, error: 'Unknown workspace.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const rel = String(body.path || '');
  if (!rel) return Response.json({ ok: false, error: 'path required' }, { status: 400 });
  runs.ensureRecovered();
  if (workspaceLocked(ws.path) || runs.activeForWorkspace(ws.path)) return Response.json({ ok: false, error: 'Wait for the workspace operation to finish before saving.' }, { status: 409 });
  const env = { workspacePath: ws.path, runId: 'manual', sessionId: 'manual', reviewMode: false };
  const r = saveManual(env, rel, String(body.content ?? ''), body.beforeHash);
  if (!r.ok) return Response.json({ ok: false, error: (r as { error: string }).error, conflict: (r as { conflict?: boolean }).conflict }, { status: (r as { conflict?: boolean }).conflict ? 409 : 400 });
  return Response.json({ ok: true, changeId: r.record.changeId, hash: r.record.afterHash });
}