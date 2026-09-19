// Workspace registry + canonical path policy. File APIs use workspace ids + validated relative
// paths only. Rejects traversal, UNC, drive-relative, alternate-data-stream, and symlink/junction
// escapes (by realpath-ing the nearest existing parent).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataDir, readJson, writeJsonAtomic } from '../store';

export interface Workspace { id: string; path: string; label: string; createdAt: string }

const FILE = () => dataDir('workspaces.json');

function newId(): string { return 'ws_' + Math.random().toString(36).slice(2, 8); }

export function listWorkspaces(): Workspace[] { return readJson<Workspace[]>(FILE(), []); }

export function registerWorkspace(rawPath: string): Workspace {
  const abs = path.resolve(rawPath);
  const st = fs.statSync(abs); // throws if missing
  if (!st.isDirectory()) throw new Error('Not a directory: ' + abs);
  const real = fs.realpathSync(abs);
  const existing = listWorkspaces().find((w) => w.path.toLowerCase() === real.toLowerCase());
  if (existing) return existing;
  const ws: Workspace = { id: newId(), path: real, label: path.basename(real) || real, createdAt: new Date().toISOString() };
  const all = listWorkspaces(); all.push(ws); writeJsonAtomic(FILE(), all);
  return ws;
}

export function getWorkspace(id: string): Workspace | undefined {
  return listWorkspaces().find((w) => w.id === id);
}

function realpathNearest(p: string): string {
  let cur = path.resolve(p);
  const missing: string[] = [];
  for (;;) {
    let exists = true;
    try { fs.lstatSync(cur); } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      exists = false;
    }
    if (exists) return path.join(fs.realpathSync(cur), ...missing.reverse());
    const parent = path.dirname(cur);
    if (parent === cur) throw new Error('Cannot resolve path.');
    missing.push(path.basename(cur));
    cur = parent;
  }
}

/** Resolve a workspace-relative path, enforcing confinement. Throws on any policy violation. */
export function resolveInWorkspace(workspacePath: string, rel: string): string {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('A relative path is required.');
  if (rel.includes('\0')) throw new Error('Invalid path.');
  // Reject absolute, drive-relative, UNC, and alternate data streams.
  if (/^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) throw new Error('Absolute paths are not allowed.');
  if (rel.includes(':')) throw new Error('Alternate data streams are not allowed.');
  if (rel.includes('..')) {
    // allow only if it still resolves inside; we check below, but reject obvious escapes early
    const normalized = path.normalize(rel);
    if (normalized.startsWith('..')) throw new Error('Path escapes the workspace.');
  }
  const wsReal = realpathNearest(workspacePath);
  const abs = path.resolve(wsReal, rel);
  if (abs === wsReal) return abs; // the workspace root itself
  const parentReal = realpathNearest(path.dirname(abs));
  const within = path.relative(wsReal, parentReal);
  if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('Path escapes the workspace.');
  // If the target already exists, ensure its own realpath is inside too (guards symlinked files).
  const targetReal = realpathNearest(abs);
  const w2 = path.relative(wsReal, targetReal);
  if (w2 === '..' || w2.startsWith('..' + path.sep) || path.isAbsolute(w2)) throw new Error('Path escapes the workspace.');
  return abs;
}

export function relPath(workspacePath: string, abs: string): string {
  return path.relative(realpathNearest(workspacePath), abs).split(path.sep).join('/');
}

/** Lightweight, bounded workspace revision (sizes+mtimes) for associating verification with files. */
export function workspaceRevision(workspacePath: string, maxFiles = 4000): string {
  const h = createHash('sha1');
  let count = 0;
  const skip = new Set(['node_modules', '.git', '.next', '.next-build', 'dist', 'build', '__pycache__', '.venv', 'venv', 'data', 'workspaces']);
  const walk = (dir: string, depth: number) => {
    if (count > maxFiles || depth > 8) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (count > maxFiles) return;
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      try { const st = fs.statSync(full); h.update(`${relPath(workspacePath, full)}:${st.size}:${Math.floor(st.mtimeMs)}`); count++; } catch { /* skip */ }
    }
  };
  walk(realpathNearest(workspacePath), 0);
  return h.digest('hex').slice(0, 16);
}
