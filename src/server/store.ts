// File-backed persistence. Chosen over SQLite to guarantee install reliability on Windows/Node
// (no native modules). Writes are atomic (temp + rename); append-only JSONL journals keep events.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = () => process.env.EC12_DATA_DIR || path.join(process.cwd(), 'data');

function ensure(dir: string) { fs.mkdirSync(dir, { recursive: true }); }

export function validPersistentId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

export function assertPersistentId(id: string): string {
  if (!validPersistentId(id)) throw new Error('Invalid persistent ID.');
  return id;
}

export function dataDir(...parts: string[]): string {
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(part)) throw new Error('Invalid data path component.');
  }
  if (parts.length > 1 && ['sessions', 'runs', 'changes'].includes(parts[0])) {
    const id = parts[1].replace(/\.(?:events\.jsonl|changes\.jsonl|json)$/, '');
    assertPersistentId(id);
  }
  if (parts[0] === 'staging' && parts.length > 1) assertPersistentId(parts[1]);
  const root = path.resolve(ROOT());
  const p = path.resolve(root, ...parts);
  ensure(root);
  const realRoot = fs.realpathSync(root);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      fs.lstatSync(current);
    } catch (e: any) {
      if (e.code === 'ENOENT') break;
      throw e;
    }
    const relative = path.relative(realRoot, fs.realpathSync(current));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Data path escapes storage.');
  }
  ensure(path.dirname(p));
  return p;
}

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch (e: any) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error('Stored JSON could not be read. Restore the file from backup before retrying.');
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensure(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function appendJsonl(file: string, obj: unknown): void {
  ensure(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

export function readJsonl<T>(file: string): T[] {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as T); } catch { /* skip corrupt line */ }
  }
  return out;
}

export function rmFile(file: string): void { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }
