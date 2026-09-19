// Node ESM loader: resolves the '@/' alias and extensionless relative imports to TypeScript files.
// Used by `npm test` (node --test) so the server core can be tested without a bundler.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const srcRoot = path.join(root, 'src');

function tryFiles(base) {
  for (const c of [base, base + '.ts', base + '.tsx', base + '.mjs', base + '.js', path.join(base, 'index.ts')]) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* keep trying */ }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const found = tryFiles(path.join(srcRoot, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const baseDir = context.parentURL ? path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Za-z]:)/, '$1')) : root;
    const found = tryFiles(path.resolve(baseDir, specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return next(specifier, context);
}
