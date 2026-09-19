// Full model-request payloads live in sidecar files, not in the event log.
// v1.18: request.started events carry a summary (counts + byte size); the complete
// payload is written here once per request and served on demand by
// /api/runs/[id]/requests/[key]. Older logs still embed full payloads; the lookup
// falls back to scanning the run's own event log for those.
import fs from 'node:fs';
import { assertPersistentId, dataDir, readJsonl, validPersistentId } from './store';

export interface RequestPayloadSummary {
  messageCount: number;
  toolCount: number;
  maxTokens?: number;
  payloadBytes: number;
  payloadKey: string;
}

export function requestPayloadFile(key: string): string {
  return dataDir('request-payloads', assertPersistentId(key) + '.json');
}

/** Persist a full payload. Never throws: event logging must not break runs. */
export function saveRequestPayload(requestId: string, payload: unknown): { key: string; bytes: number } {
  const safe = validPersistentId(requestId) && requestId ? requestId : '';
  const key = 'req_' + (safe || Math.random().toString(36).slice(2) + Date.now().toString(36));
  try {
    const text = JSON.stringify(payload);
    fs.writeFileSync(requestPayloadFile(key), text, 'utf8');
    return { key, bytes: text.length };
  } catch { return { key: '', bytes: 0 }; }
}

export function readRequestPayload(key: string): unknown | undefined {
  if (!validPersistentId(key)) return undefined;
  try { return JSON.parse(fs.readFileSync(requestPayloadFile(key), 'utf8')); } catch { return undefined; }
}

function hasFullPayload(data: unknown): data is { messages: unknown[] } {
  return !!data && typeof data === 'object' && Array.isArray((data as { messages?: unknown }).messages);
}

/** Resolve a downloadable payload: sidecar first, then the run's own event log (old runs). */
export function findRequestPayload(runId: string, key: string): unknown | undefined {
  if (!validPersistentId(runId) || !validPersistentId(key)) return undefined;
  if (key.startsWith('req_')) {
    const direct = readRequestPayload(key);
    if (direct !== undefined) return direct;
  }
  try {
    const file = dataDir('runs', assertPersistentId(runId) + '.events.jsonl');
    for (const e of readJsonl<{ eventId?: unknown; runId?: unknown; data?: unknown }>(file)) {
      if (e.runId !== runId) continue;
      const d = e.data as { requestId?: unknown; payloadKey?: unknown } | null | undefined;
      if (e.eventId !== key && (!d || d.requestId !== key)) continue;
      if (hasFullPayload(d)) return d;
      if (d && typeof d.payloadKey === 'string') {
        const via = readRequestPayload(d.payloadKey);
        if (via !== undefined) return via;
      }
    }
  } catch { /* fall through to undefined */ }
  return undefined;
}
