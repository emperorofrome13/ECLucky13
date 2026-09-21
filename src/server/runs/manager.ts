// Server-owned run manager. A run's lifecycle lives outside the HTTP request: clients subscribe for
// events and can reconnect. Cancellation cannot become success; a failed required check/stage cannot
// become success; budget exhaustion cannot become success.
import { readJson, writeJsonAtomic, dataDir, readJsonl, appendJsonl, assertPersistentId } from '../store';
import { attachmentMessage, resolveAttachments } from '../attachments';
import { workspaceLocked } from '../workspace/change-journal';
import path from 'node:path';
import { resolveInWorkspace } from '../workspace/path-policy';
import { eventStore } from '../events';
import { assertTransition } from './state-machine';
import { compactConversation, newConversation, estimateTokens, resolveReasoningReplay, type Conversation } from '../agent/context-manager';
import { runMainLoop, runStageWithRepair, type Emit, type EventScope, type LoopOutcome } from '../agent/loop';
import { OpenAICompatProvider } from '../providers/openai-compatible';
import { discoverModels, getCatalog, getLoadedModels, resolveEffectiveModel, providerKind, isLocal } from '../providers/model-discovery';
import { discoverChecks } from '../verification/discover';
import { runVerification } from '../verification/execute';
import { canonicalizeStages, STAGE_DEFS } from '@/shared/stage-definitions';
import type { EC12Settings } from '@/shared/settings-schema';
import type { RunState, RunSummary, TokenUsage, VerificationResult, VerificationCheck, CheckStatus } from '@/shared/contracts';
import { zeroUsage } from '@/shared/contracts';
import type { JournalEnv } from '../workspace/change-journal';
import { loadSystemPrompt, buildAgentsBlock, buildSkillsIndex } from '../prompts';
import { contextToolPrompts } from '@/shared/contexttools';
import { resolveApiKey } from '../security/secrets';
import { CONTEXT7_ENDPOINT } from '../context7';
import { ponytailMcpInstalled, PONYTAIL_INSTALL_HINT } from '../ponytail-mcp';
import { codegraphMcpInstalled, CODEGRAPH_INSTALL_HINT } from '../codegraph-mcp';
import { recoverUnfinished, listChanges } from '../workspace/change-journal';
import fs from 'node:fs';

interface RequestUsage extends EventScope {
  runId: string;
  usage: TokenUsage;
  usageStatus: 'unknown' | 'reported';
  completed?: boolean;
  cancelled?: boolean;
  price: { model: string; inPrice: number; outPrice: number; currency: string };
  ts: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  workspaceId: string;
  workspacePath: string;
  conversation: Conversation;
  usage: TokenUsage;
  usageEvents?: Array<{ usage: TokenUsage; price: { model: string; inPrice: number; outPrice: number; currency: string }; ts: string } & Partial<EventScope> & { runId?: string }>;
  usageRequests?: Record<string, RequestUsage>;
  pinned?: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Failure memo: set when a run ends blocked by repeated tool failure, cleared
   * on the next succeeded run. Injected into the next run's context so the model
   * does not blindly repeat the same doomed commands ("continue" → blocked again).
   */
  failureMemo?: { tool: string; reason: string; lastError: string; runId: string; at: string };
}

export interface RunRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  mode: 'ask' | 'plan' | 'code';
  state: RunState;
  clientRequestId: string;
  ownerPid?: number;
  configuredModel: string;
  effectiveModel: string;
  createdAt: string;
  updatedAt: string;
  summary?: RunSummary;
  error?: string;
  /** The original user prompt (truncated), so history shows what was asked. */
  task?: string;
  /** Truncated final assistant text, so replies survive session reloads and never vanish. */
  finalText?: string;
  pendingQuestion?: { question: string; options?: string[] };
  attachmentIds?: string[];
  branchOf?: { sessionId: string; runId: string };
}

const sessionFile = (id: string) => dataDir('sessions', id + '.json');
const runFile = (id: string) => dataDir('runs', id + '.json');
const newId = (p: string) => p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const queuedInputFile = (id: string) => dataDir('run-private', assertPersistentId(id) + '.json');
const snapshotFile = (id: string) => dataDir('run-context', assertPersistentId(id) + '.json');
const workspaceKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

export function branchSession(sessionId: string, input: { runId: string; task?: string; retry?: boolean }) {
  assertPersistentId(sessionId); assertPersistentId(input.runId);
  const source = loadSession(sessionId);
  const run = loadRun(input.runId);
  if (!source || source.deletedAt || !run || run.sessionId !== sessionId) throw new Error('Session or run not found.');
  const snapshot = readJson<Conversation | undefined>(snapshotFile(run.id), undefined);
  if (!snapshot) throw new Error('This older run has no pre-run context snapshot; it cannot be branched without including later context.');
  const task = input.task === undefined ? run.task || '' : input.task;
  if (!task.trim()) throw new Error('A task is required.');
  const branch = getOrCreateSession({ workspaceId: source.workspaceId, workspacePath: source.workspacePath, title: task.slice(0, 60) });
  branch.conversation = structuredClone(snapshot);
  saveSession(branch);
  return { ok: true, sessionId: branch.id, task, attachmentIds: run.attachmentIds || [] };
}

export function loadSession(id: string): SessionRecord | undefined { return readJson<SessionRecord | undefined>(sessionFile(id), undefined); }
export function saveSession(s: SessionRecord) { s.updatedAt = new Date().toISOString(); writeJsonAtomic(sessionFile(s.id), s); }

export type FailureMemo = NonNullable<SessionRecord['failureMemo']>;

/**
 * User-visible message for a blocked/exhausted run. A blocked run must never end
 * silent: the message names the cause, the failing tool and its last error, and
 * lists the concrete ways forward. The session stays alive — this is a stop to
 * save tokens, not a death.
 */
export function buildBlockedMessage(o: LoopOutcome): string {
  const cause = o.exhausted ? 'the iteration budget ran out' : (o.error || 'repeated tool failures');
  const lines = [
    `I stopped ${o.exhausted ? 'because ' + cause : 'to save your tokens: ' + cause} after ${o.turns} turn${o.turns === 1 ? '' : 's'}.`,
  ];
  if (o.blockedTool) lines.push(`Failing tool: ${o.blockedTool}.`);
  if (o.lastError) lines.push(`Last error:\n${o.lastError.slice(0, 600)}`);
  lines.push('The session is still open. Ways forward: fix the failing command and say "continue", ask me to take a different approach, or paste the error output so we can diagnose it together. I will not repeat the same failing call unchanged.');
  return lines.join('\n\n');
}

/** System-context reminder injected into the run after a blocked run. */
export function buildFailureMemoText(m: FailureMemo): string {
  return `SYSTEM (previous run was blocked — do not ignore this): run ${m.runId} stopped because: ${m.reason}. `
    + `Failing tool: ${m.tool}. Last error: ${m.lastError.slice(0, 600)}. `
    + `Do NOT repeat the same failing call unchanged: first diagnose (read the error, run a smaller probe, check quoting/paths), or take a different approach, or ask the user. `
    + `Repeating the identical failing command will block this run again.`;
}

// Request events fire three times per model request (started/usage/finished); rewriting
// the whole session file synchronously each time blocked the agent loop for seconds
// per run, growing with session size. Coalesce to at most one write per 2s; usage rows
// are already durable in the usage-archive files, and finished requests save now.
const sessionSaveAt = new Map<string, number>();
const sessionSaveTimer = new Map<string, ReturnType<typeof setTimeout>>();
const SESSION_SAVE_MIN_MS = 2000;
function saveSessionSoon(s: SessionRecord, immediate = false) {
  const now = Date.now();
  const last = sessionSaveAt.get(s.id) || 0;
  const pending = sessionSaveTimer.get(s.id);
  if (pending) { clearTimeout(pending); sessionSaveTimer.delete(s.id); }
  if (immediate || now - last >= SESSION_SAVE_MIN_MS) {
    sessionSaveAt.set(s.id, now);
    saveSession(s);
    return;
  }
  sessionSaveTimer.set(s.id, setTimeout(() => {
    sessionSaveTimer.delete(s.id);
    sessionSaveAt.set(s.id, Date.now());
    try { saveSession(s); } catch { /* the next save retries */ }
  }, SESSION_SAVE_MIN_MS - (now - last)));
}
export function getOrCreateSession(input: { id?: string; workspaceId: string; workspacePath: string; title?: string }): SessionRecord {
  if (input.id) { const s = loadSession(input.id); if (s?.deletedAt) throw new Error('This session was deleted. Start a new session or undo deletion.'); if (s) return s; }
  const s: SessionRecord = {
    id: input.id || newId('ses'), title: input.title || 'New session', workspaceId: input.workspaceId, workspacePath: input.workspacePath,
    conversation: newConversation(), usage: zeroUsage(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  saveSession(s);
  return s;
}

export function listSessions(workspaceId?: string, query = ''): SessionRecord[] {
  try {
    const needle = query.trim().toLowerCase();
    return fs.readdirSync(dataDir('sessions')).filter((f) => f.endsWith('.json')).map((f) => readJson<SessionRecord | undefined>(dataDir('sessions', f), undefined)).filter((s): s is SessionRecord => !!s)
      .filter((s) => !workspaceId || s.workspaceId === workspaceId)
      .filter((s) => !s.deletedAt)
      .filter((s) => !needle || s.title.toLowerCase().includes(needle) || (s.conversation.originalTask || '').toLowerCase().includes(needle))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
}

export function updateSession(id: string, patch: { title?: string; pinned?: boolean }): SessionRecord | undefined {
  const session = loadSession(id);
  if (!session || session.deletedAt) return undefined;
  if (typeof patch.title === 'string') session.title = patch.title.trim().slice(0, 120) || 'New session';
  if (typeof patch.pinned === 'boolean') session.pinned = patch.pinned;
  saveSession(session);
  return session;
}

export function compactStoredSession(id: string, contextWindow: number, keepRecentTurns: number) {
  const session = loadSession(id);
  if (!session || session.deletedAt) return undefined;
  const result = compactConversation(session.conversation, contextWindow, keepRecentTurns, contextWindow * 0.8);
  if (result.compacted) saveSession(session);
  return { session, result };
}

/** Soft deletion preserves transcript and change history, without touching workspace files. */
export function setSessionDeleted(id: string, deleted: boolean) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return { ok: false, status: 400, error: 'Invalid session ID.' } as const;
  const session = loadSession(id);
  if (!session) return { ok: false, status: 404, error: 'Session not found.' } as const;
  if (runs.activeForWorkspace(session.workspacePath)?.sessionId === id) return { ok: false, status: 409, error: 'Stop the running task before deleting this session.' } as const;
  if (deleted) session.deletedAt = new Date().toISOString();
  else delete session.deletedAt;
  saveSession(session);
  return { ok: true, session } as const;
}

export function loadRun(id: string): RunRecord | undefined { return readJson<RunRecord | undefined>(runFile(id), undefined); }
function saveRun(r: RunRecord) { r.updatedAt = new Date().toISOString(); writeJsonAtomic(runFile(r.id), r); }
export function listRuns(): RunRecord[] {
  try {
    const dir = dataDir('runs');
    return fs.readdirSync(dir).filter((f: string) => f.endsWith('.json') && !f.includes('.events.')).map((f: string) => readJson<RunRecord | undefined>(dataDir('runs', f), undefined)).filter(Boolean) as RunRecord[];
  } catch { return []; }
}

export interface CreateRunInput {
  clientRequestId: string;
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  mode: 'ask' | 'plan' | 'code';
  task: string;
  attachmentIds?: string[];
  settings: EC12Settings;
}

/** Split final required-check failures into pre-existing baseline vs new regressions. */
export function splitCheckFailures(baseline: VerificationCheck[], final: Array<{ checkId: string; name: string; status: CheckStatus; required: boolean }>): { preExisting: string[]; regressions: string[] } {
  const byId = new Map(baseline.map((b) => [b.checkId, b]));
  const preExisting: string[] = [];
  const regressions: string[] = [];
  for (const c of final) {
    if (c.status !== 'failed') continue;
    const b = byId.get(c.checkId);
    if (b && b.status === 'failed') preExisting.push(`${c.name} (failed before the task too)`);
    else if (b && b.status === 'passed') regressions.push(`${c.name} (passed before, fails now)`);
    else if (!b) preExisting.push(`${c.name} (no baseline recorded)`);
  }
  return { preExisting, regressions };
}

export function markUnfinishedInterrupted(): number {
  let runs = 0;
  try { recoverUnfinished(); } catch { /* ignore */ }
  for (const r of listRuns()) {
    if (r.ownerPid) {
      try { process.kill(r.ownerPid, 0); continue; } catch (e: any) { if (e.code !== 'ESRCH') continue; }
    }
    if (r.state === 'queued' && fs.existsSync(queuedInputFile(r.id))) continue;
    if (!['succeeded', 'failed', 'cancelled', 'blocked', 'unverified', 'interrupted'].includes(r.state)) {
      r.state = 'interrupted'; r.error = 'Server restarted while this run was active.'; saveRun(r);
      eventStore.append(r.id, r.sessionId, 'run.state', { state: 'interrupted', detail: r.error });
      runs++;
    }
  }
  return runs;
}

/**
 * Output cap when the provider's catalogue does not state one.
 *
 * A local server can genuinely generate up to its loaded context, so nothing changes there. A
 * remote API cannot: assuming "max output = context window" sends `max_tokens: 190000` to an API
 * whose real ceiling is a fraction of that, which is rejected outright (HTTP 400) by most hosted
 * providers and, where accepted, invites an unbounded — and unbudgeted — generation.
 */
/** Per-request usage rows are unbounded by nature; a long-lived session must not grow forever.
 * The rolling window keeps recent cost detail while `session.usage` keeps the lifetime totals. */
export const MAX_USAGE_EVENTS = 500;
function recordUsageEvent(session: SessionRecord, event: NonNullable<SessionRecord['usageEvents']>[number]) {
  const events = session.usageEvents || (session.usageEvents = []);
  events.push(event);
  if (events.length > MAX_USAGE_EVENTS) events.splice(0, events.length - MAX_USAGE_EVENTS);
}

export const REMOTE_DEFAULT_MAX_OUTPUT = 32768;
export function defaultMaxOutput(local: boolean, contextWindow: number): number {
  return local ? contextWindow : Math.min(REMOTE_DEFAULT_MAX_OUTPUT, contextWindow);
}

export interface RequestUsageInput {
  requestId: string;
  runId: string;
  phase: 'main' | 'stage';
  stageId: string | null;
  stageAttempt: number;
  turnId?: string;
  requestAttempt?: number;
  usage?: TokenUsage;
  completed?: boolean;
  cancelled?: boolean;
  finished?: boolean;
  price: { model: string; inPrice: number; outPrice: number; currency: string };
  ts: string;
}

export function recordRequestUsage(session: SessionRecord, input: RequestUsageInput): RequestUsage {
  const requests = session.usageRequests || (session.usageRequests = {});
  const key = `${input.runId}:${input.requestId}`;
  const archived = dataDir('usage-archive', assertPersistentId(session.id), assertPersistentId(input.runId) + '_' + assertPersistentId(input.requestId) + '.json');
  const row: RequestUsage = requests[key] || readJson<RequestUsage | undefined>(archived, undefined) || {
    runId: input.runId, phase: input.phase, stageId: input.stageId, stageAttempt: input.stageAttempt,
    requestId: input.requestId, turnId: input.turnId, requestAttempt: input.requestAttempt,
    usage: zeroUsage(), usageStatus: 'unknown', price: input.price, ts: input.ts,
  };
  if (input.usage) {
    const before = row.usage;
    const next = {
      promptTokens: Math.max(before.promptTokens, input.usage.promptTokens),
      completionTokens: Math.max(before.completionTokens, input.usage.completionTokens),
      totalTokens: Math.max(before.totalTokens, input.usage.totalTokens),
      cachedTokens: Math.max(before.cachedTokens || 0, input.usage.cachedTokens || 0),
    };
    session.usage = {
      promptTokens: session.usage.promptTokens + next.promptTokens - before.promptTokens,
      completionTokens: session.usage.completionTokens + next.completionTokens - before.completionTokens,
      totalTokens: session.usage.totalTokens + next.totalTokens - before.totalTokens,
      cachedTokens: (session.usage.cachedTokens || 0) + next.cachedTokens - (before.cachedTokens || 0),
    };
    row.usage = next;
    row.usageStatus = 'reported';
    const recent = session.usageEvents?.find((e) => e.requestId === input.requestId && e.phase === input.phase && e.stageId === input.stageId);
    if (recent) recent.usage = next;
    else recordUsageEvent(session, { usage: next, price: input.price, ts: input.ts, runId: input.runId, phase: input.phase, stageId: input.stageId, stageAttempt: input.stageAttempt, requestId: input.requestId });
  }
  if (input.finished) { row.completed = input.completed; row.cancelled = input.cancelled; }
  writeJsonAtomic(archived, row);
  requests[key] = row;
  const ids = Object.keys(requests);
  if (ids.length > MAX_USAGE_EVENTS) for (const stale of ids.slice(0, ids.length - MAX_USAGE_EVENTS)) delete requests[stale];
  return row;
}

class RunManager {
  private answers = new Map<string, (answer: string) => void>();
  answer(runId: string, answer: string) {
    const resolve = this.answers.get(runId);
    if (!resolve || !answer.trim()) return { ok: false, error: 'There is no pending question, or the answer is empty.' };
    resolve(answer.trim());
    return { ok: true };
  }
  private live = new Map<string, { record: RunRecord; controller: AbortController }>();
  private sessions = new Map<string, SessionRecord>();
  private approvalContinuations = new Map<string, () => Promise<void>>();

private recovered = false;
  ensureRecovered() {
    if (this.recovered) return;
    this.recovered = true;
    markUnfinishedInterrupted();
    const queued = listRuns().filter(record => record.state === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const record of queued) {
      if (record.ownerPid && record.ownerPid !== process.pid) {
        try { process.kill(record.ownerPid, 0); continue; } catch (error: any) { if (error.code !== 'ESRCH') continue; }
      }
      record.ownerPid = process.pid;
      saveRun(record);
      this.live.set(record.id, { record, controller: new AbortController() });
    }
    for (const record of queued) this.drain(record.workspacePath);
  }

  get(runId: string): RunRecord | undefined { this.ensureRecovered(); return this.live.get(runId)?.record || loadRun(runId); }
  activeForWorkspace(workspacePath: string): RunRecord | undefined {
    return [...this.live.values()].map((v) => v.record).find((r) => r.workspacePath === workspacePath && !['succeeded', 'failed', 'cancelled', 'blocked', 'unverified', 'interrupted'].includes(r.state));
  }
  findByClientRequest(clientRequestId: string): RunRecord | undefined { return listRuns().find((r) => r.clientRequestId === clientRequestId); }

  create(input: CreateRunInput): { ok: true; record: RunRecord } | { ok: false; error: string; record?: RunRecord } {
    this.ensureRecovered();
    const existing = this.findByClientRequest(input.clientRequestId);
    if (existing) return { ok: true, record: existing }; // idempotent
    const active = [...this.live.values()].map(value => value.record).find(record => record.sessionId === input.sessionId);
    if (active) return { ok: false, error: `This session already has an active or queued task (${active.id}).`, record: active };
    resolveAttachments(input.attachmentIds || [], input.workspaceId);
    const record: RunRecord = {
      id: newId('run'), sessionId: input.sessionId, workspaceId: input.workspaceId, workspacePath: input.workspacePath,
      mode: input.mode, state: 'queued', clientRequestId: input.clientRequestId, ownerPid: process.pid,
      configuredModel: input.settings.provider.model, effectiveModel: input.settings.provider.model,
      task: input.task, attachmentIds: [...(input.attachmentIds || [])],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(queuedInputFile(record.id), input);
    writeJsonAtomic(snapshotFile(record.id), this.session(input).conversation);
    saveRun(record);
    const controller = new AbortController();
    this.live.set(record.id, { record, controller });
    eventStore.append(record.id, record.sessionId, 'run.created', { mode: record.mode, workspace: record.workspacePath, model: record.configuredModel, task: input.task, attachmentIds: record.attachmentIds });
    this.drain(input.workspacePath);
    return { ok: true, record };
  }

  private busy = new Set<string>();
  private drain(workspacePath: string) {
    const key = workspaceKey(workspacePath);
    if (this.busy.has(key)) return;
    const next = [...this.live.values()].find(value => workspaceKey(value.record.workspacePath) === key && value.record.state === 'queued');
    if (!next) return;
    this.busy.add(key);
    void (async () => {
      try {
        while (workspaceLocked(workspacePath) && !next.controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 100));
        if (next.controller.signal.aborted) return;
        const input = readJson<CreateRunInput | undefined>(queuedInputFile(next.record.id), undefined);
        if (!input) throw new Error('Queued task configuration is missing.');
        await this.execute(next.record, input);
      } catch (error) {
        this.finish(next.record, next.controller.signal.aborted ? 'cancelled' : 'failed', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.busy.delete(key);
        this.drain(workspacePath);
      }
    })();
  }

  cancel(runId: string): { ok: boolean; error?: string } {
    const entry = this.live.get(runId);
    if (!entry) return { ok: false, error: 'Run is not active.' };
    if (entry.record.state === 'cancelling') return { ok: true };
    if (entry.record.state === 'queued') { entry.controller.abort(); this.finish(entry.record, 'cancelled', { error: 'Cancelled before execution.' }); this.drain(entry.record.workspacePath); return { ok: true }; }
    if (entry.record.state === 'waiting_for_approval') { entry.controller.abort(); this.finish(entry.record, 'cancelled', { error: 'Cancelled.' }); return { ok: true }; }
    try { assertTransition(entry.record.state, 'cancelling'); } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
    entry.record.state = 'cancelling'; saveRun(entry.record);
    eventStore.append(runId, entry.record.sessionId, 'run.state', { state: 'cancelling', detail: 'Cancellation requested.' });
    entry.controller.abort();
    return { ok: true };
  }

  private emit(record: RunRecord, type: string, data: unknown) { eventStore.append(record.id, record.sessionId, type, data); }
  private setState(record: RunRecord, state: RunState, detail?: string) {
    if (record.state === 'cancelling' || ['succeeded', 'failed', 'cancelled', 'blocked', 'unverified', 'interrupted'].includes(record.state)) return;
    try { assertTransition(record.state, state); } catch { return; }
    record.state = state; saveRun(record);
    eventStore.append(record.id, record.sessionId, 'run.state', { state, detail });
  }

  private session(input: CreateRunInput): SessionRecord {
    let s = loadSession(input.sessionId) || this.sessions.get(input.sessionId);
    if (!s) s = getOrCreateSession({ id: input.sessionId, workspaceId: input.workspaceId, workspacePath: input.workspacePath });
    this.sessions.set(s.id, s);
    return s;
  }

  private async execute(record: RunRecord, input: CreateRunInput): Promise<void> {
    const { settings } = input;
    const entry = this.live.get(record.id)!;
    const signal = entry.controller.signal;
    const session = this.session(input);
    const journalEnv: JournalEnv = { workspacePath: record.workspacePath, runId: record.id, sessionId: record.sessionId, reviewMode: false };
    const emit: Emit = (type, data) => {
      const payload = { phase: 'main', stageId: null, stageAttempt: 0, requestId: null, ...(data && typeof data === 'object' ? data : {}) } as EventScope & { usage?: TokenUsage; completed?: boolean; cancelled?: boolean };
      if (payload.requestId && ['request.started', 'usage', 'request.finished'].includes(type)) {
        recordRequestUsage(session, {
          runId: record.id, phase: payload.phase, stageId: payload.stageId, stageAttempt: payload.stageAttempt,
          requestId: payload.requestId, turnId: payload.turnId, requestAttempt: payload.requestAttempt,
          usage: payload.usage, completed: payload.completed, cancelled: payload.cancelled,
          finished: type === 'request.finished',
          price: { model: record.effectiveModel, inPrice, outPrice, currency: settings.provider.currency },
          ts: new Date().toISOString(),
        });
        saveSessionSoon(session, type === 'request.finished');
      }
      if (type === 'context.compacted') saveSession(session);
      this.emit(record, type, payload);
    };

    this.setState(record, 'preparing');

    // Resolve the effective model (fresh loaded state; never substitutes for a pinned choice).
    let effective = settings.provider.model;
    let ctx = settings.provider.contextWindow;
    let maxOut = settings.provider.maxTokens;
    let inPrice = settings.provider.inputCostPer1M;
    let outPrice = settings.provider.outputCostPer1M;
    const apiKey = resolveApiKey(settings.provider.baseUrl, settings.provider.apiKey, (settings.provider as any).keyRef);
    const contextTools = {
      ...settings.contextTools,
      context7ApiKey: resolveApiKey(CONTEXT7_ENDPOINT, settings.contextTools.context7ApiKey),
    };
    // An MCP server that is not installed cannot answer. Leaving its tool in the schema costs tokens
    // on every request and buys the model a guaranteed-failing call, so drop it and say so once.
    if (contextTools.ponytail && !ponytailMcpInstalled()) {
      contextTools.ponytail = false;
      emit('error', { message: `Ponytail MCP is enabled but not installed, so its tool was not offered this run. ${PONYTAIL_INSTALL_HINT}`, fatal: false });
    }
    if (contextTools.codegraph && !codegraphMcpInstalled()) {
      contextTools.codegraph = false;
      emit('error', { message: `CodeGraph MCP is enabled but not installed, so its tool was not offered this run. ${CODEGRAPH_INSTALL_HINT}`, fatal: false });
    }
    const local = isLocal(settings.provider.baseUrl);
    let catalogMaxOut = 0;
    try {
      const cat = await discoverModels(settings.provider.baseUrl, apiKey); const loaded = cat.loaded;
      const res = resolveEffectiveModel(settings.provider.modelSelection, settings.provider.model, loaded, cat.catalog);
      effective = res.effective || effective;
      catalogMaxOut = res.maxOut || 0;
      if (settings.provider.autoModelLimits) {
        if (res.ctx) ctx = res.ctx;
        maxOut = Math.min(res.maxOut || defaultMaxOutput(local, ctx), ctx);
      } else {
        if (res.ctx) ctx = Math.min(ctx, res.ctx);
        maxOut = Math.min(maxOut || defaultMaxOutput(local, ctx), res.maxOut || defaultMaxOutput(local, ctx), ctx);
      }
      if (res.inPrice !== undefined) inPrice = res.inPrice;
      if (res.outPrice !== undefined) outPrice = res.outPrice;
      record.effectiveModel = effective; record.configuredModel = settings.provider.model;
      if (res.changed) emit('error', { message: `Using loaded model "${effective}" (configured "${settings.provider.model}").`, fatal: false });
    } catch { /* keep configured */ }
    // Discovery can fail (offline catalogue, gateway error); the output budget must still be sane.
    // An output limit the catalogue actually stated is authoritative and is never clamped down.
    maxOut = Math.min(maxOut || defaultMaxOutput(local, ctx), catalogMaxOut || defaultMaxOutput(local, ctx), ctx);
    if (!effective) { this.finish(record, 'failed', { error: 'No model configured. Pick a model in Settings.' }); return; }
    signal.throwIfAborted();
    saveRun(record);
    const tokenModel = settings.provider.baseUrl + '|' + effective;
    if (session.conversation.tokenModel !== tokenModel) { session.conversation.tokenModel = tokenModel; session.conversation.tokenScale = 1; }
    emit('model.resolved', { model: effective, contextWindow: ctx, maxTokens: maxOut, local: isLocal(settings.provider.baseUrl) });

    const provider = new OpenAICompatProvider({
      baseUrl: settings.provider.baseUrl, apiKey, model: effective,
      maxTokens: maxOut, temperature: settings.provider.temperature,
      connectTimeoutMs: settings.provider.connectTimeoutMs, firstTokenTimeoutMs: settings.provider.firstTokenTimeoutMs,
      streamIdleTimeoutMs: settings.provider.streamIdleTimeoutMs, requestTimeoutMs: settings.provider.requestTimeoutMs,
      retries: settings.provider.retries, cacheBreakpoints: settings.provider.costSaver === true,
    });

    const systemBlocks = [
      loadSystemPrompt(record.workspacePath),
      buildAgentsBlock(record.workspacePath),
      contextTools.skills ? buildSkillsIndex() : '',
      contextToolPrompts(contextTools),
      `MODE: ${record.mode}${record.mode === 'ask' ? ' — answer only; you cannot modify files.' : record.mode === 'plan' ? ' — inspect and propose a plan; you cannot modify files.' : ' — implement and verify.'}`,
      ...(session.failureMemo ? [buildFailureMemoText(session.failureMemo)] : []),
    ];

    this.setState(record, 'generating');
    // Baseline: run the deterministic checks BEFORE the agent mutates anything, so final
    // failures can be split into pre-existing vs regressions. Boot/browser are skipped here
    // (environmental/long); the final pass runs the full discovered set.
    let baseline: VerificationCheck[] = [];
    try {
      const baseChecks = record.mode === 'code' ? discoverChecks(record.workspacePath).filter((c) => c.kind !== 'boot' && c.kind !== 'browser') : [];
      if (baseChecks.length) {
        emit('verification.baseline', { checks: [] });
        const base = await runVerification(record.workspacePath, baseChecks, signal, () => {});
        baseline = base.checks;
        emit('verification.baseline', { checks: baseline });
      }
    } catch { baseline = []; }
    const reasoningReplay = resolveReasoningReplay(settings.provider.reasoningReplay, local);
    const recoveryLimits = {
      turnRecoveryAttempts: settings.agent.turnRecoveryAttempts,
      maxRequestAttempts: settings.agent.maxRequestAttempts,
      duplicateObservationLimit: settings.agent.duplicateObservationLimit,
      protocolRecoveryAttempts: settings.agent.protocolRecoveryAttempts,
      noProgressTurnLimit: settings.agent.noProgressTurnLimit,
      repeatedFailureLimit: settings.agent.repeatedFailureLimit,
    };
    const outcome = await runMainLoop({
      runId: record.id, sessionId: record.sessionId, workspace: record.workspacePath, mode: record.mode, signal,
      provider, contextWindow: ctx, requestedMaxTokens: maxOut,
      reasoningReplay,
      costSaver: settings.provider.costSaver === true,
      softTurnLimit: settings.provider.costSaver === true ? settings.provider.saverTurnBudget : 0,
      autoCompact: settings.provider.autoCompact, autoCompactAtPercent: settings.provider.autoCompactAtPercent, keepRecentTurns: settings.provider.keepRecentTurns,
      maxIterations: settings.agent.maxIterations, ...recoveryLimits,
      outputContinuationLimit: settings.agent.outputContinuationLimit,
      contextTools, journalEnv, conversation: session.conversation, systemBlocks, task: input.task,
      taskMessage: attachmentMessage(input.task, input.attachmentIds || [], input.workspaceId), emit,
      onAskUser: (question, options) => new Promise<string>((resolve, reject) => {
        record.pendingQuestion = { question, options }; saveRun(record);
        emit('question.asked', record.pendingQuestion);
        const cleanup = () => { this.answers.delete(record.id); delete record.pendingQuestion; saveRun(record); signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(new Error('Cancelled.')); };
        this.answers.set(record.id, (answer) => { cleanup(); emit('question.answered', { answer }); resolve(answer); });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    });
    saveSession(session);
    // Preserve the reply on the record itself so it survives reloads and later runs.
    record.finalText = outcome.content || '';
    saveRun(record);

    if (outcome.cancelled || signal.aborted) { this.finish(record, 'cancelled', { error: 'Cancelled.' }); return; }
    if (outcome.blocked || outcome.exhausted) {
      // A blocked run is a token-saving stop, not a death: explain itself in chat,
      // and leave a failure memo so the next run in this session does not repeat it.
      const reason = outcome.blocked ? (outcome.error || 'Blocked after repeated failures.') : 'Iteration budget exhausted before completion.';
      session.failureMemo = { tool: outcome.blockedTool || 'unknown tool', reason, lastError: (outcome.lastError || '').slice(0, 600), runId: record.id, at: new Date().toISOString() };
      const message = buildBlockedMessage(outcome);
      emit('assistant.delta', { text: message });
      record.finalText = ((outcome.content ? outcome.content + '\n\n' : '') + message).slice(0, 12000);
      saveRun(record); saveSession(session);
      this.finishSuccess(record, session, effective, [], null, 'blocked', [], reason);
      return;
    }
    if (outcome.error) { this.finish(record, 'failed', { error: outcome.error }); return; }

    // ask/plan: a natural-language answer is the deliverable.
    if (record.mode !== 'code') { this.finishSuccess(record, session, effective, [], null); return; }


    // Verification (project-aware). Zero checks = unverified.
    this.setState(record, 'verifying');
    const checks = discoverChecks(record.workspacePath);
    let verification: VerificationResult = { outcome: 'unverified', checks: [], revision: '' };
    emit('verification.started', { revision: '' });
    verification = await runVerification(record.workspacePath, checks, signal, (c) => emit('verification.check', { check: c }));
    emit('verification.finished', { result: verification });
    if (signal.aborted) { this.finish(record, 'cancelled', { error: 'Cancelled.' }); return; }

    // Autoprompt stages (canonical order). A failed required stage blocks success.
    const stageResults: Array<{ stage: string; passed: boolean; summary: string }> = [];
    const stages = canonicalizeStages(settings.autoPrompt.stages);
    if (settings.autoPrompt.enabled && stages.length) {
      this.setState(record, 'reviewing');
      const prior: string[] = [];
      for (const stage of stages) {
        if (signal.aborted) break;
        const def = STAGE_DEFS.find((s) => s.id === stage)!;
        const refreshContext = async () => {
          const changed = listChanges(record.sessionId).filter(c => c.runId === record.id);
          const files = [...new Set(changed.map(c => c.path))].map(file => {
            try {
              const text = fs.readFileSync(resolveInWorkspace(record.workspacePath, file), 'utf8');
              return `${file}:\n${text}`;
            } catch (error: any) { return `${file}: ${error.code === 'ENOENT' ? '(deleted)' : '(unreadable: ' + error.message + ')'}`; }
          }).join('\n\n') || '(none)';
          return `Session goal:\n${session.conversation.originalTask || input.task}\n\nCurrent request:\n${attachmentMessage(input.task, input.attachmentIds || [], input.workspaceId).content}\n\nCurrent plan:\n${session.conversation.plan.join('\n')}\n\nMain result:\n${record.finalText || '(none)'}\n\nCurrent changed code:\n${files}\n\nVerification (${verification.outcome}, revision ${verification.revision}):\n${verification.checks.map(c => `${c.name}: ${c.status}\n${c.outputPreview || ''}`).join('\n')}\n\nPrevious stages:\n${prior.join('\n') || '(none)'}`;
        };
        emit('stage.started', { phase: 'stage', stageId: stage, stage, label: def.label });
        const stagePrompt = (await import('../prompts')).loadStagePrompt(stage, record.workspacePath);
        const r = await runStageWithRepair(stage, {
          provider, signal, contextWindow: ctx, requestedMaxTokens: maxOut,
          reasoningReplay, costSaver: settings.provider.costSaver === true,
          autoCompact: settings.provider.autoCompact, autoCompactAtPercent: settings.provider.autoCompactAtPercent, keepRecentTurns: settings.provider.keepRecentTurns,
          maxIterations: settings.agent.stageMaxIterations, ...recoveryLimits,
          stageOutputContinuationLimit: settings.agent.stageOutputContinuationLimit,
          contextTools, journalEnv, systemBlocks, stagePrompt,
          conversationContext: '', refreshContext,
          afterAttempt: async () => {
            emit('verification.started', { phase: 'stage', stageId: stage, revision: verification.revision });
            verification = await runVerification(record.workspacePath, discoverChecks(record.workspacePath), signal, c => emit('verification.check', { phase: 'stage', stageId: stage, check: c }));
            emit('verification.finished', { phase: 'stage', stageId: stage, result: verification });
          },
          emit,
        }, settings.agent.stageRepairAttempts);
        stageResults.push(r); prior.push(`${r.stage}: ${r.passed ? 'PASS' : 'FAIL'} - ${r.summary}`);
        emit('stage.finished', { phase: 'stage', stageId: r.stage, stageAttempt: r.attempts, stage: r.stage, passed: r.passed, summary: r.summary });

      }
      // Files may have changed in stages: re-verify the final revision.
      verification = await runVerification(record.workspacePath, discoverChecks(record.workspacePath), signal, (c) => emit('verification.check', { check: c }));
      emit('verification.finished', { result: verification });
      if (signal.aborted) { this.finish(record, 'cancelled', { error: 'Cancelled.' }); return; }
    }

    const stageFailed = stageResults.some((s) => !s.passed);
    if (verification.outcome === 'failed') { this.finishSuccess(record, session, effective, stageResults, verification, 'failed', baseline); return; }
    if (stageFailed) { this.finishSuccess(record, session, effective, stageResults, verification, 'failed', baseline); return; }
    if (verification.outcome === 'unverified') { this.finishSuccess(record, session, effective, stageResults, verification, 'unverified', baseline); return; }
    this.finishSuccess(record, session, effective, stageResults, verification, 'succeeded', baseline);
  }

  async resumeAfterApproval(runId: string, settings: EC12Settings): Promise<{ ok: boolean; error?: string }> {
    const record = this.get(runId);
    if (!record) return { ok: false, error: 'Unknown run.' };
    if (record.state !== 'waiting_for_approval') return { ok: false, error: `Run is ${record.state}, not awaiting approval.` };
    const pending = listChanges(record.sessionId).filter((c) => c.runId === record.id && c.status === 'pending');
    if (pending.length) return { ok: false, error: `${pending.length} change(s) still pending.` };
    const resume = this.approvalContinuations.get(runId);
    if (!resume) return { ok: false, error: 'Run is not resumable (server restarted after the approval gate).' };
    await resume();
    return { ok: true };
  }

  private finishSuccess(record: RunRecord, session: SessionRecord, model: string, stages: Array<{ stage: string; passed: boolean; summary: string }>, verification: VerificationResult | null, forced?: RunState, baseline: VerificationCheck[] = [], note?: string) {
    const changes: any[] = (() => { try { return listChanges(session.id).filter((c: any) => c.runId === record.id); } catch { return []; } })();
    const checks = (verification?.checks || []).map((c) => ({ name: c.name, status: c.status as CheckStatus, exitCode: c.exitCode ?? null }));
    const { preExisting, regressions } = splitCheckFailures(baseline, (verification?.checks || []).filter((c) => c.required).map((c) => ({ checkId: c.checkId, name: c.name, status: c.status, required: c.required })));
    const summary: RunSummary = {
      outcome: (forced || 'succeeded') as RunState,
      model,
      modes: record.mode,
      implemented: `Agent completed a ${record.mode} task.`,
      filesChanged: [...new Set(changes.map((c) => c.path))] as string[],
      checks,
      stages,
      remaining: (note ? [note] : []).concat(verification?.outcome === 'unverified' ? ['No applicable automated checks ran — result is UNVERIFIED.'] : [])
        .concat(preExisting.map((s) => 'Baseline failure (pre-existing): ' + s))
        .concat(regressions.map((s) => 'Regression introduced by this run: ' + s))
        .concat(stages.filter((s) => !s.passed).map((s) => `Stage ${s.stage} failed: ${s.summary}`)),
      howToRun: 'See the workspace README or package.json scripts.',
    };
    // A success proves the previous failure is behind us: drop the failure memo so
    // later runs are not nagged about a problem that is already fixed.
    if (summary.outcome === 'succeeded' && session.failureMemo) { delete session.failureMemo; saveSession(session); }
    this.finish(record, summary.outcome, { summary });
  }

  private finish(record: RunRecord, state: RunState, extra: { summary?: RunSummary; error?: string }) {
    if (this.live.get(record.id)?.controller.signal.aborted) { state = 'cancelled'; extra = { error: 'Cancelled.' }; }
    const terminal = ['succeeded', 'failed', 'cancelled', 'blocked', 'unverified', 'interrupted'].includes(record.state);
    if (!terminal) { try { assertTransition(record.state, state); } catch { /* ignore */ } }
    record.state = state; if (extra.error) record.error = extra.error; if (extra.summary) record.summary = extra.summary;
    saveRun(record);
    eventStore.append(record.id, record.sessionId, 'run.finished', extra.summary ? { summary: extra.summary } : { summary: { outcome: state, model: record.effectiveModel, modes: record.mode, implemented: '', filesChanged: [], checks: [], stages: [], remaining: extra.error ? [extra.error] : [], howToRun: '' } });
    this.live.delete(record.id);
  }
}

const shared = globalThis as typeof globalThis & { ec12Runs?: RunManager };
export const runs = shared.ec12Runs ??= new RunManager();





