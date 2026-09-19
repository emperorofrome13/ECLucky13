import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { checkRequest, forbidden } from '@/server/security/auth';

// Directory browser + creator for the working-folder picker.
export async function GET(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const url = new URL(req.url);
  const requested = url.searchParams.get('path');
  const target = requested && requested.trim() ? requested : process.cwd();
  const abs = path.resolve(target);
  try {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name).sort((a, b) => a.localeCompare(b));
    const files = entries.filter((e) => e.isFile()).map((e) => e.name).slice(0, 100);
    const parent = path.dirname(abs);
    return Response.json({ ok: true, path: abs, parent: parent === abs ? null : parent, dirs, files, drives: listDrives() });
  } catch (e: any) {
    return Response.json({ ok: false, path: abs, error: String(e?.message || e), drives: listDrives() }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const auth = checkRequest(req); if (!auth.ok) return forbidden(auth);
  const body = await req.json().catch(() => ({}));
  const parent = String(body.parent || process.cwd());
  const name = String(body.name || '').trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) {
    return Response.json({ ok: false, error: 'Invalid folder name.' });
  }
  const target = path.join(parent, name);
  try {
    fs.mkdirSync(target, { recursive: true });
    return Response.json({ ok: true, path: target });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) });
  }
}

function listDrives(): string[] {
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    try { if (fs.existsSync(d)) drives.push(d); } catch { /* ignore */ }
  }
  return drives;
}
