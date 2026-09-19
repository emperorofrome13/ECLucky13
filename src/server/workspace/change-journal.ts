import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ChangeRecord } from '@/shared/contracts';
import { appendJsonl, assertPersistentId, dataDir, readJson, readJsonl, writeJsonAtomic } from '../store';
import { resolveInWorkspace, relPath } from './path-policy';

export interface JournalEnv { workspacePath: string; runId: string; sessionId: string; reviewMode: boolean }
export interface OverlayRead { exists: boolean; text: string; staged: boolean }
export interface WorkspaceSnapshot {
  files: Map<string, { hash: string; text: string | null }>;
  incomplete: Set<string>;
  complete: boolean;
  workspacePath: string;
  skipped: number;
}

const hash = (s: string | null): string | null => s === null ? null : createHash('sha1').update(s).digest('hex');
const recFile = (id: string) => dataDir('changes', assertPersistentId(id) + '.json');
const indexFile = (id: string) => dataDir('sessions', assertPersistentId(id) + '.changes.jsonl');
const stagingDir = (id: string) => dataDir('staging', assertPersistentId(id));
const SENSITIVE = /(?:^\.env(?:\.|$)|\.(?:env|pem|key|pfx|p12|keystore)$)/i;
const SNAPSHOT_MAX_FILES = 3000;
const SNAPSHOT_MAX_BYTES = 512 * 1024;
const SNAPSHOT_SKIP = new Set(['node_modules', '.git', '.next', '.next-build', 'dist', 'build', 'out', '__pycache__', '.venv', 'venv', 'target', 'data', 'workspaces', '.ec11-tmp', '.ec12-tmp']);
const shared = globalThis as typeof globalThis & { ec12WorkspaceLocks?: Map<string, Promise<void>> };
const locks = shared.ec12WorkspaceLocks ??= new Map<string, Promise<void>>();
const workspaceKey = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

export function workspaceLocked(workspace: string): boolean { return locks.has(workspaceKey(workspace)); }
export async function withWorkspaceLock<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  const key = workspaceKey(workspace);
  const previous = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  locks.set(key, tail);
  await previous;
  try { return await fn(); } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export function getChange(id: string): ChangeRecord | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return undefined;
  return readJson<ChangeRecord | undefined>(recFile(id), undefined);
}
export function listChanges(sessionId: string): ChangeRecord[] {
  const ids = new Set(readJsonl<{ changeId: string }>(indexFile(sessionId)).map((x) => x?.changeId));
  return [...ids].filter((id) => typeof id === 'string').map(getChange).filter((c): c is ChangeRecord => !!c);
}
function persist(rec: ChangeRecord) {
  const file = recFile(rec.changeId);
  const isNew = !fs.existsSync(file);
  writeJsonAtomic(file, rec);
  if (isNew) appendJsonl(indexFile(rec.sessionId), { changeId: rec.changeId });
}
function normalizedRel(env: JournalEnv, rel: string): string {
  assertPersistentId(env.runId);
  assertPersistentId(env.sessionId);
  const abs = resolveInWorkspace(env.workspacePath, rel);
  const normalized = relPath(env.workspacePath, abs);
  if (!normalized) throw new Error('A file path is required.');
  return normalized;
}
function samePath(c: ChangeRecord, env: JournalEnv, rel: string): boolean {
  return c.runId === env.runId && !!c.workspacePath && workspaceKey(c.workspacePath) === workspaceKey(env.workspacePath)
    && workspaceKey(path.join(env.workspacePath, c.path)) === workspaceKey(path.join(env.workspacePath, rel));
}
function pending(env: JournalEnv, rel: string): ChangeRecord[] {
  return listChanges(env.sessionId).filter((c) => c.status === 'pending' && samePath(c, env, rel));
}
function diskText(env: JournalEnv, rel: string): string | null {
  const abs = resolveInWorkspace(env.workspacePath, rel);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  if (!st.isFile()) throw new Error('The path is not a regular file.');
  if (st.size > 2 * 1024 * 1024) throw new Error('File too large to edit (over 2 MB).');
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw new Error('Binary file cannot be edited as text.');
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error('File is not valid UTF-8 text.');
  return text;
}
function validateText(text: string) {
  if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('File too large to edit (over 2 MB).');
  if (text.includes('\0')) throw new Error('Binary file cannot be edited as text.');
}
export function overlayRead(env: JournalEnv, rel: string): OverlayRead {
  rel = normalizedRel(env, rel);
  const records = pending(env, rel);
  const latest = records[records.length - 1];
  if (env.reviewMode && latest) {
    if (latest.operation === 'delete') return { exists: false, text: '', staged: true };
    const text = latest.afterText ?? '';
    validateText(text);
    return { exists: true, text, staged: true };
  }
  const text = diskText(env, rel);
  return { exists: text !== null, text: text ?? '', staged: false };
}
function refreshStaging(env: JournalEnv, rel: string) {
  rel = normalizedRel(env, rel);
  const root = stagingDir(env.runId);
  fs.mkdirSync(root, { recursive: true });
  const file = resolveInWorkspace(root, rel);
  const records = pending(env, rel);
  const latest = records[records.length - 1];
  if (!latest || latest.operation === 'delete') {
    fs.rmSync(file, { force: true });
  } else {
    validateText(latest.afterText ?? '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, latest.afterText ?? '', 'utf8');
  }
}
function writeWorkspace(env: JournalEnv, rel: string, text: string) {
  const abs = resolveInWorkspace(env.workspacePath, rel);
  validateText(text);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.ec12-tmp-' + randomUUID();
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
    resolveInWorkspace(env.workspacePath, rel);
    fs.renameSync(tmp, abs);
  } finally { fs.rmSync(tmp, { force: true }); }
}
function applyToDisk(env: JournalEnv, rec: ChangeRecord) {
  if (rec.operation === 'delete') fs.rmSync(resolveInWorkspace(env.workspacePath, rec.path), { force: true });
  else writeWorkspace(env, rec.path, rec.afterText ?? '');
}
function commit(env: JournalEnv, tool: string, rel: string, operation: ChangeRecord['operation'], beforeText: string | null, afterText: string | null): ChangeRecord {
  rel = normalizedRel(env, rel);
  if (afterText !== null) validateText(afterText);
  const rec: ChangeRecord = {
    changeId: 'chg_' + randomUUID(), sessionId: env.sessionId, runId: env.runId, tool, path: rel, operation,
    beforeExists: beforeText !== null, beforeText, beforeHash: hash(beforeText), afterText, afterHash: hash(afterText),
    createdAt: new Date().toISOString(), appliedAt: null, status: env.reviewMode ? 'pending' : 'applying', workspacePath: env.workspacePath,
  };
  persist(rec);
  if (env.reviewMode) refreshStaging(env, rel);
  else {
    applyToDisk(env, rec);
    rec.appliedAt = new Date().toISOString(); rec.status = 'applied'; persist(rec);
  }
  return rec;
}
export function recoverUnfinished(): number {
  const dir = dataDir('changes');
  let files: string[];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (e: any) { if (e.code === 'ENOENT') return 0; throw e; }
  let recovered = 0;
  for (const file of files) {
    const rec = readJson<ChangeRecord | undefined>(path.join(dir, file), undefined);
    if (!rec || rec.status !== 'applying' || !rec.workspacePath) continue;
    const env: JournalEnv = { workspacePath: rec.workspacePath, runId: rec.runId, sessionId: rec.sessionId, reviewMode: false };
    try {
      const currentHash = hash(diskText(env, rec.path));
      const expectedAfterHash = hash(rec.operation === 'delete' ? null : rec.afterText ?? '');
      if (rec.afterHash !== null && rec.afterHash !== expectedAfterHash) throw new Error('Invalid after-image hash.');
      rec.afterHash = expectedAfterHash;
      if (currentHash !== expectedAfterHash) {
        if (currentHash !== rec.beforeHash || (rec.operation !== 'create' && rec.beforeText === null)) {
          rec.status = 'conflict'; persist(rec); continue;
        }
        applyToDisk(env, rec);
      }
      rec.status = 'applied'; rec.appliedAt = new Date().toISOString(); persist(rec);
      refreshStaging(env, rec.path);
      recovered++;
    } catch {
      rec.status = 'conflict'; persist(rec);
    }
  }
  return recovered;
}
export function literalReplace(content: string, oldStr: string, newStr: string, replaceAll: boolean): { ok: true; content: string; count: number } | { ok: false; error: string } {
  if (!oldStr) return { ok: false, error: 'old_string is required.' };
  let count = 0; let i = 0;
  while ((i = content.indexOf(oldStr, i)) !== -1) { count++; i += oldStr.length; }
  if (!count) return { ok: false, error: 'old_string not found. It must match exactly, including whitespace.' };
  if (count > 1 && !replaceAll) return { ok: false, error: `old_string matched ${count} times. Add surrounding context to make it unique, or set replace_all.` };
  if (replaceAll) return { ok: true, content: content.split(oldStr).join(newStr), count };
  const at = content.indexOf(oldStr);
  return { ok: true, content: content.slice(0, at) + newStr + content.slice(at + oldStr.length), count: 1 };
}
export function editFile(env: JournalEnv, rel: string, oldStr: string, newStrRaw: string, replaceAll: boolean, expectedBeforeHash?: string): { ok: true; record: ChangeRecord } | { ok: false; error: string; conflict?: boolean } {
  try {
    const cur = overlayRead(env, rel);
    if (!cur.exists) return { ok: false, error: `File not found: ${rel}. Read it first.` };
    if (expectedBeforeHash && hash(cur.text) !== expectedBeforeHash) return { ok: false, error: 'The file changed since you read it. Read it again before editing.', conflict: true };
    const crlf = (cur.text.match(/\r\n/g) || []).length;
    const lf = (cur.text.replace(/\r\n/g, '').match(/\n/g) || []).length;
    const newStr = newStrRaw.replace(/\r\n/g, '\n').replace(/\n/g, crlf > 0 && crlf >= lf ? '\r\n' : '\n');
    const r = literalReplace(cur.text, oldStr, newStr, replaceAll);
    if (!r.ok) return r as { ok: false; error: string };
    return { ok: true, record: commit(env, 'edit_file', rel, 'modify', cur.text, r.content) };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
export function writeFile(env: JournalEnv, rel: string, content: string, expectedBeforeHash?: string): { ok: true; record: ChangeRecord } | { ok: false; error: string; conflict?: boolean } {
  try {
    const cur = overlayRead(env, rel);
    if (expectedBeforeHash && hash(cur.exists ? cur.text : null) !== expectedBeforeHash) return { ok: false, error: 'The file changed since you read it. Read it again before writing.', conflict: true };
    return { ok: true, record: commit(env, 'write_file', rel, cur.exists ? 'modify' : 'create', cur.exists ? cur.text : null, content) };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
export function deleteFile(env: JournalEnv, rel: string): { ok: true; record: ChangeRecord } | { ok: false; error: string } {
  try {
    const cur = overlayRead(env, rel);
    if (!cur.exists) return { ok: false, error: `File not found: ${rel}` };
    return { ok: true, record: commit(env, 'delete_file', rel, 'delete', cur.text, null) };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
function validateEnv(rec: ChangeRecord, env: JournalEnv) {
  if (!rec.workspacePath || workspaceKey(rec.workspacePath) !== workspaceKey(env.workspacePath) || rec.runId !== env.runId || rec.sessionId !== env.sessionId) throw new Error('Change does not belong to this workspace/run/session.');
}
export function approveChange(id: string, env: JournalEnv): { ok: boolean; error?: string; conflict?: boolean; record?: ChangeRecord } {
  const rec = getChange(id);
  if (!rec) return { ok: false, error: 'Unknown change.' };
  try {
    validateEnv(rec, env);
    if (rec.status === 'applied') return { ok: true, record: rec };
    if (rec.status !== 'pending') return { ok: false, conflict: true, error: `Change is ${rec.status}, not pending.` };
    if (pending(env, rec.path)[0]?.changeId !== id) return { ok: false, conflict: true, error: 'Approve the earlier pending change for this file first.' };
    if (hash(diskText(env, rec.path)) !== rec.beforeHash) return { ok: false, conflict: true, error: 'The file changed since staging; refusing to overwrite newer content.' };
    rec.status = 'applying'; persist(rec);
    applyToDisk(env, rec);
    rec.status = 'applied'; rec.appliedAt = new Date().toISOString(); persist(rec);
    refreshStaging(env, rec.path);
    return { ok: true, record: rec };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
export function rejectChange(id: string): { ok: boolean; error?: string; record?: ChangeRecord; invalidatedChangeIds?: string[] } {
  const rec = getChange(id);
  if (!rec) return { ok: false, error: 'Unknown change.' };
  if (rec.status === 'reverted') return { ok: true, record: rec };
  if (rec.status !== 'pending') return { ok: false, error: `Change is ${rec.status}, not pending.` };
  if (!rec.workspacePath) return { ok: false, error: 'Change has no recorded workspace.' };
  const env: JournalEnv = { workspacePath: rec.workspacePath, runId: rec.runId, sessionId: rec.sessionId, reviewMode: true };
  try {
    const queue = pending(env, rec.path);
    const later = queue.slice(queue.findIndex((c) => c.changeId === id) + 1);
    rec.status = 'reverted'; persist(rec);
    for (const c of later) { c.status = 'conflict'; persist(c); }
    refreshStaging(env, rec.path);
    return { ok: true, record: rec, invalidatedChangeIds: later.map((c) => c.changeId) };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
export function revertChange(id: string, env: JournalEnv): { ok: boolean; error?: string; conflict?: boolean; record?: ChangeRecord } {
  const rec = getChange(id);
  if (!rec) return { ok: false, error: 'Unknown change.' };
  try {
    validateEnv(rec, env);
    if (rec.status !== 'applied') return { ok: false, error: `Change is ${rec.status}, not applied.` };
    if (rec.operation === 'create' && (rec.beforeExists || rec.beforeHash !== null || rec.beforeText !== null)) return { ok: false, error: 'No proof that this change created the file; refusing to delete it.' };
    if (rec.operation !== 'create' && rec.beforeText === null) return { ok: false, error: 'No before-image recorded; this change cannot be reverted.' };
    const current = diskText(env, rec.path);
    if (hash(current) !== rec.afterHash) return { ok: false, conflict: true, error: 'The file changed after this edit; refusing to overwrite newer content.' };
    if (rec.operation === 'create') {
      if (current === null) return { ok: false, error: 'File already gone.' };
      fs.rmSync(resolveInWorkspace(env.workspacePath, rec.path), { force: true });
    } else writeWorkspace(env, rec.path, rec.beforeText!);
    rec.status = 'reverted'; persist(rec);
    return { ok: true, record: rec };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
export function saveManual(env: JournalEnv, rel: string, content: string, expectedBeforeHash?: string) {
  return writeFile({ ...env, reviewMode: false }, rel, content, expectedBeforeHash);
}
export function workspaceFileHash(workspacePath: string, rel: string): string | null {
  return hash(diskText({ workspacePath, runId: 'manual', sessionId: 'manual', reviewMode: false }, rel));
}
export function snapshotWorkspace(workspacePath: string): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = { files: new Map(), incomplete: new Set(), complete: true, workspacePath, skipped: 0 };
  let count = 0;
  const walk = (dir: string, depth: number) => {
    if (count >= SNAPSHOT_MAX_FILES || depth > 10) { snapshot.complete = false; snapshot.skipped++; return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { snapshot.complete = false; snapshot.skipped++; return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (count >= SNAPSHOT_MAX_FILES) { snapshot.complete = false; snapshot.skipped++; return; }
      if (SNAPSHOT_SKIP.has(e.name) || SENSITIVE.test(e.name) || (e.name.startsWith('.') && e.name !== '.gitignore')) continue;
      const full = path.join(dir, e.name);
      const rel = relPath(workspacePath, full);
      if (e.isSymbolicLink()) { snapshot.incomplete.add(rel); snapshot.skipped++; continue; }
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      count++;
      try {
        const st = fs.lstatSync(full);
        if (!st.isFile() || st.size > SNAPSHOT_MAX_BYTES) throw new Error('Uncaptured file.');
        const buf = fs.readFileSync(full);
        const text = buf.toString('utf8');
        if (buf.includes(0) || !Buffer.from(text).equals(buf)) throw new Error('Non-text file.');
        snapshot.files.set(rel, { hash: hash(text)!, text });
      } catch { snapshot.incomplete.add(rel); snapshot.skipped++; }
    }
  };
  walk(resolveInWorkspace(workspacePath, '.'), 0);
  return snapshot;
}
export function reconcileShellChanges(env: JournalEnv, before: WorkspaceSnapshot, label: string): { changes: ChangeRecord[]; skipped: number } {
  if (before.workspacePath && workspaceKey(before.workspacePath) !== workspaceKey(env.workspacePath)) throw new Error('Snapshot belongs to a different workspace.');
  const after = snapshotWorkspace(env.workspacePath);
  const changes: ChangeRecord[] = [];
  let skipped = before.skipped + after.skipped;
  const unknownBefore = before.incomplete || new Set<string>();
  const touch = (rel: string, operation: ChangeRecord['operation'], beforeText: string | null, afterText: string | null, beforeExists: boolean) => {
    if (changes.length >= 500) { skipped++; return; }
    const rec: ChangeRecord = {
      changeId: 'chg_' + randomUUID(), sessionId: env.sessionId, runId: env.runId, workspacePath: env.workspacePath, tool: label, path: rel, operation,
      beforeExists, beforeText, beforeHash: hash(beforeText), afterText, afterHash: hash(afterText), createdAt: new Date().toISOString(), appliedAt: new Date().toISOString(), status: 'applied',
    };
    persist(rec); changes.push(rec);
  };
  for (const [rel, meta] of after.files) {
    const b = before.files.get(rel);
    if (b) { if (b.hash !== meta.hash) touch(rel, 'modify', b.text, meta.text, true); }
    else if (unknownBefore.has(rel) || before.complete !== true) touch(rel, 'modify', null, meta.text, true);
    else touch(rel, 'create', null, meta.text, false);
  }
  for (const [rel, meta] of before.files) {
    if (after.files.has(rel) || after.incomplete.has(rel)) continue;
    try { fs.lstatSync(resolveInWorkspace(env.workspacePath, rel)); skipped++; }
    catch (e: any) { if (e.code === 'ENOENT') touch(rel, 'delete', meta.text, null, true); else skipped++; }
  }
  return { changes, skipped };
}
