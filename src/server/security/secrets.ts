// Server-side credential storage. Keys are stored under data/ (local machine) and referenced by a
// key id, so the browser does not persist API keys in localStorage. Keys are never logged or echoed.
import { createHash } from 'node:crypto';
import { dataDir, readJson, writeJsonAtomic } from '../store';

export interface StoredCredential { keyRef: string; baseUrl: string; apiKeyHash: string; apiKey: string; updatedAt: string }

interface CredFile { creds: Record<string, StoredCredential> }

const FILE = () => dataDir('credentials.json');

function keyRef(baseUrl: string): string {
  return 'cred_' + createHash('sha1').update(baseUrl.toLowerCase()).digest('hex').slice(0, 12);
}

/** Store (upsert) a credential for a base URL. Returns only the reference, never the key. */
export function storeCredential(baseUrl: string, apiKey: string): { keyRef: string } {
  const ref = keyRef(baseUrl);
  const creds = readAll();
  creds[ref] = { keyRef: ref, baseUrl, apiKeyHash: createHash('sha1').update(apiKey || '').digest('hex').slice(0, 12), apiKey, updatedAt: new Date().toISOString() };
  writeJsonAtomic(FILE(), { creds });
  return { keyRef: ref };
}

export function getCredential(ref: string): StoredCredential | undefined { return readAll()[ref]; }

/** Resolve an apiKey for a run: explicit key wins; otherwise the stored one for that base URL. */
export function resolveApiKey(baseUrl: string, explicitKey: string, keyRef?: string): string {
  if (explicitKey) return explicitKey;
  const credential = getCredential(keyRef || keyRefFor(baseUrl));
  if (!credential) return '';
  try {
    const requested = new URL(baseUrl); const stored = new URL(credential.baseUrl);
    if (requested.origin !== stored.origin || requested.pathname.replace(/\/$/, '') !== stored.pathname.replace(/\/$/, '')) return '';
  } catch { return ''; }
  return credential.apiKey || '';
}

function readAll(): Record<string, StoredCredential> { return readJson<{ creds: Record<string, StoredCredential> }>(FILE(), { creds: {} }).creds; }
function keyRefFor(baseUrl: string): string { return keyRef(baseUrl); }