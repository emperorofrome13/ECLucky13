// Append-only event log per run. Persist BEFORE publish; support replay after a sequence number.
// Clients deduplicate by (runId, sequence) / eventId, so attaching a listener before replay is safe.
//
// Reads are incremental. The SSE route polls `history()` several times a second per connected
// client; re-reading and re-parsing the whole JSONL file each time made a long run (large shell
// logs, diffs) burn the event loop in the same process that drives the agent, so a healthy run
// slowed to a crawl and looked stalled. Recent events are served from memory and anything older is
// read from the file once, from a byte offset, instead of from the top.
import type { EventEnvelope } from '@/shared/contracts';
import { appendJsonl, dataDir, readJsonl } from './store';
import fs from 'node:fs';

type Listener = (e: EventEnvelope) => void;

function newId(): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

/** Events kept in memory per run for replay without touching the disk. */
const MEMORY_WINDOW = 2000;

interface RunLog { seq: number; recent: EventEnvelope[]; offset: number; loaded: boolean }

function deltaStream(e: EventEnvelope): string | null {
  if (e.type !== 'assistant.delta' && e.type !== 'reasoning.delta') return null;
  const d = (e.data || {}) as Record<string, unknown>;
  if (typeof d.text !== 'string') return null;
  return [e.type, d.phase, d.stageId, d.stageAttempt, d.requestId, d.turnId].map((v) => String(v ?? '')).join('|');
}

function cloneEnvelope(e: EventEnvelope): EventEnvelope {
  return { ...e, data: e.data && typeof e.data === 'object' ? { ...(e.data as Record<string, unknown>) } : e.data };
}

/**
 * Merge consecutive same-stream text deltas. Text is preserved exactly; the merged
 * event keeps the first eventId (client dedup keys stay stable) and the last
 * sequence (resume offsets stay correct). Clones: shared memory-window objects
 * are never mutated.
 */
export function coalesceDeltas(events: EventEnvelope[]): EventEnvelope[] {
  const out: EventEnvelope[] = [];
  for (const e of events) {
    const key = deltaStream(e);
    const prev = out[out.length - 1];
    if (key && prev && deltaStream(prev) === key) {
      (prev.data as { text: string }).text += ((e.data as { text: string }).text);
      prev.sequence = e.sequence;
      continue;
    }
    out.push(cloneEnvelope(e));
  }
  return out;
}

/** Replace an embedded full request payload with a summary (old log format). */
export function stripRequestPayload(e: EventEnvelope): EventEnvelope {
  const d = (e.data || {}) as Record<string, unknown>;
  if ((e.type === 'request.started' || e.type === 'request_payload') && Array.isArray(d.messages)) {
    const messages = d.messages as unknown[];
    const tools = Array.isArray(d.tools) ? d.tools as unknown[] : [];
    const rest: Record<string, unknown> = { ...d };
    delete rest.messages; delete rest.tools;
    return { ...e, data: { ...rest, messageCount: messages.length, toolCount: tools.length, payloadBytes: JSON.stringify(d).length, stripped: true } };
  }
  return cloneEnvelope(e);
}

class EventStore {
  private logs = new Map<string, RunLog>();
  private listeners = new Map<string, Set<Listener>>();

  private file(runId: string): string { return dataDir('runs', runId + '.events.jsonl'); }

  /** Load a run's existing log exactly once per process (after a restart or for another worker). */
  private log(runId: string): RunLog {
    let log = this.logs.get(runId);
    if (log) return log;
    const existing = readJsonl<EventEnvelope>(this.file(runId));
    let offset = 0;
    try { offset = fs.statSync(this.file(runId)).size; } catch { offset = 0; }
    log = {
      seq: existing.length ? existing[existing.length - 1].sequence : 0,
      recent: existing.slice(-MEMORY_WINDOW),
      offset,
      loaded: true,
    };
    this.logs.set(runId, log);
    return log;
  }

  append(runId: string, sessionId: string, type: string, data: unknown): EventEnvelope {
    const log = this.log(runId);
    this.ingestExternal(log, runId);
    const env: EventEnvelope = {
      version: 1, eventId: newId(), sequence: ++log.seq,
      timestamp: new Date().toISOString(), sessionId, runId, type, data,
    };
    appendJsonl(this.file(runId), env); // persisted before any listener runs
    log.recent.push(env);
    if (log.recent.length > MEMORY_WINDOW) log.recent.splice(0, log.recent.length - MEMORY_WINDOW);
    try { log.offset = fs.statSync(this.file(runId)).size; } catch { /* offset stays conservative */ }
    for (const l of this.listeners.get(runId) || []) { try { l(env); } catch { /* isolate */ } }
    return env;
  }

  history(runId: string, after = 0): EventEnvelope[] {
    const log = this.log(runId);
    // Another process may have appended to this run's file (route bundles, workers, restarts).
    this.ingestExternal(log, runId);
    const oldest = log.recent.length ? log.recent[0].sequence : Infinity;
    if (after >= oldest - 1 || !log.recent.length) return log.recent.filter((e) => e.sequence > after);
    // Asked for events older than the memory window: fall back to a single full read.
    return readJsonl<EventEnvelope>(this.file(runId)).filter((e) => e.sequence > after);
  }

  /**
   * Replay with transfer/structure cost removed for slow clients. Merges consecutive
   * same-stream text deltas (tens of thousands collapse to a handful; text preserved
   * exactly, merged event keeps the first eventId and the last sequence) and replaces
   * embedded full request payloads with summaries. The UI fetches payloads on demand.
   */
  replay(runId: string, after = 0, compact = false): EventEnvelope[] {
    const events = this.history(runId, after);
    if (!compact) return events;
    return coalesceDeltas(events.map(stripRequestPayload));
  }

  /** Pick up appends made outside this EventStore instance without rescanning the whole file. */
  private ingestExternal(log: RunLog, runId: string) {
    let size = 0;
    try { size = fs.statSync(this.file(runId)).size; } catch { return; }
    if (size <= log.offset) return;
    let tail = '';
    try {
      const fd = fs.openSync(this.file(runId), 'r');
      try {
        const buf = Buffer.alloc(size - log.offset);
        fs.readSync(fd, buf, 0, buf.length, log.offset);
        tail = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { return; }
    const complete = tail.lastIndexOf('\n');
    if (complete < 0) return; // a partial line: wait for the writer to finish it
    for (const line of tail.slice(0, complete).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as EventEnvelope;
        if (e.sequence > log.seq) { log.seq = e.sequence; log.recent.push(e); }
      } catch { /* skip corrupt line */ }
    }
    if (log.recent.length > MEMORY_WINDOW) log.recent.splice(0, log.recent.length - MEMORY_WINDOW);
    log.offset += Buffer.byteLength(tail.slice(0, complete + 1), 'utf8');
  }

  subscribe(runId: string, after: number, cb: Listener): () => void {
    const set = this.listeners.get(runId) || new Set<Listener>();
    set.add(cb);
    this.listeners.set(runId, set);
    for (const e of this.history(runId, after)) { try { cb(e); } catch { /* isolate */ } }
    // Note: append() publishes to listeners directly, so a subscriber sees replay then live events.
    return () => { set.delete(cb); };
  }
}

const shared = globalThis as typeof globalThis & { ec12Events?: EventStore };
export const eventStore = shared.ec12Events ??= new EventStore();
