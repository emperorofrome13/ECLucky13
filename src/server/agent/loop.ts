// The streaming agent loop. Real streaming, cancellation, usage accounting, progress/repeat detection,
// and mode permissions. It does NOT decide success: the run manager verifies and finalizes.
//
// v1.13 resilience: a run no longer dies from conditions that are safe to retry. Output-limit
// cut-offs, malformed tool calls, empty responses, dropped streams and bad SSE frames now recover
// in place (each path bounded), and a no-progress watchdog stops meandering failure loops.
import type { AgentEvent, Mode, TokenUsage, ToolResult } from '@/shared/contracts';
import { zeroUsage } from '@/shared/contracts';
import type { ChatMessage, OpenAICompatProvider, StreamEvent } from '../providers/openai-compatible';
import { assembleToolCalls, parseTextToolCalls, type AssembledToolCall } from '../providers/openai-compatible';
import { executeTool, toolsForRun, type ToolContext } from '../tools/registry';
import type { Conversation, ReasoningReplay } from './context-manager';
import { prepareConversation, historyDiet } from './context-manager';
import { getChange } from '../workspace/change-journal';
import { saveRequestPayload } from '../request-payloads';
import { lineDiff } from '@/shared/diff';
import { randomUUID, createHash } from 'node:crypto';
import { STAGE_COMPLETION_PROTOCOL } from '../prompt-files';

export interface Emit { (type: string, data: unknown): void }

export interface EventScope { phase: 'main' | 'stage'; stageId: string | null; stageAttempt: number; requestId: string | null; turnId?: string; requestAttempt?: number }

export function scopedEmit(emit: Emit, scope: EventScope): Emit {
  return (type, data) => {
    const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    emit(type, { ...payload, ...(type === 'provider.status' ? { providerPhase: payload.providerPhase || payload.phase } : {}), ...scope });
  };
}

function requestScope(phase: 'main' | 'stage', stageId: string | null = null, stageAttempt = 0): EventScope {
  return { phase, stageId, stageAttempt, requestId: null };
}

async function* streamRequest(provider: OpenAICompatProvider, messages: ChatMessage[], opts: { tools: unknown[]; maxTokens: number }, signal: AbortSignal, scope: EventScope, emit: Emit): AsyncGenerator<StreamEvent> {
  let reported = false;
  let completed = false;
  // The event log keeps a summary; the complete payload goes to a sidecar file served
  // on demand. Embedding multi-hundred-KB payloads in every request.started event made
  // run logs tens of MB, and every replay/reconnect re-parsed and re-rendered them.
  const fullPayload = { messages: messages.map((m) => m.images?.length ? { ...m, images: m.images.map((i) => ({ ...i, url: '[image omitted from event log; download via attachments API]' })) } : m), tools: opts.tools, maxTokens: opts.maxTokens };
  const saved = saveRequestPayload(typeof scope.requestId === 'string' ? scope.requestId : '', fullPayload);
  emit('request.started', {
    messageCount: messages.length, toolCount: Array.isArray(opts.tools) ? opts.tools.length : 0,
    maxTokens: opts.maxTokens, payloadBytes: saved.bytes > 0 ? saved.bytes : JSON.stringify(fullPayload).length,
    payloadKey: saved.key,
  });
  try {
    for await (const event of provider.stream(messages, { ...opts, retries: 0 }, signal)) {
      if (event.type === 'usage') reported = true;
      if (event.type === 'done') completed = true;
      yield event;
    }
  } catch (error) {
    yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
  } finally {
    emit('request.finished', { usageStatus: reported ? 'reported' : 'unknown', completed, cancelled: signal.aborted });
  }
}

class ProgressGuard {
  private failures = new Map<string, number>();
  private observations = new Set<string>();
  private stalled = 0;
  private duplicates = 0;
  private success = false;
  private fresh = false;
  private failureLimit: number;
  private stallLimit: number;
  private duplicateLimit: number;
  constructor(failureLimit: number, stallLimit: number, duplicateLimit: number) {
    this.failureLimit = failureLimit; this.stallLimit = stallLimit; this.duplicateLimit = duplicateLimit;
  }
  begin() { this.success = false; this.fresh = false; }
  /** Block recovery: forget the accumulated failure counts so the run gets a clean
   * attempt after being told what is wrong. Past observations are kept, so an
   * immediately repeated identical turn still counts as no progress. */
  reset() { this.failures.clear(); this.stalled = 0; this.duplicates = 0; this.success = false; this.fresh = false; }
  observe(name: string, args: string, result: ToolResult): string | undefined {
    if (!result.ok) {
      const key = name + ':' + (result.error || '').slice(0, 120);
      const count = (this.failures.get(key) || 0) + 1;
      this.failures.set(key, count);
      if (this.failureLimit > 0 && count >= this.failureLimit) return `Repeated failure: ${name}`;
    } else {
      this.success = true;
      const key = createHash('sha256').update(name + args + result.output).digest('hex');
      if (!this.observations.has(key)) { this.fresh = true; this.observations.add(key); this.failures.clear(); }
    }
  }
  end(): string | undefined {
    this.stalled = this.success ? 0 : this.stalled + 1;
    this.duplicates = this.fresh ? 0 : this.duplicates + 1;
    if (this.stallLimit > 0 && this.stalled >= this.stallLimit) return `No progress: ${this.stalled} consecutive turns had only failing tool calls.`;
    if (this.duplicateLimit > 0 && this.duplicates >= this.duplicateLimit) return `No progress: ${this.duplicates} consecutive turns produced no new observations.`;
  }
}

export interface LoopDeps {
  runId: string;
  sessionId: string;
  workspace: string;
  mode: Mode;
  signal: AbortSignal;
  provider: OpenAICompatProvider;
  contextWindow: number;
  requestedMaxTokens: number;
  /** Reasoning replay policy for this provider (see ReasoningReplay). */
  reasoningReplay?: ReasoningReplay;
  autoCompact: boolean;
  autoCompactAtPercent: number;
  keepRecentTurns: number;
  maxIterations: number;
  repeatedFailureLimit: number;
  /** Re-requests for a turn killed by a retryable stream/protocol error (0 disables). */
  turnRecoveryAttempts?: number;
  /** Consecutive all-failing turns allowed before blocking (0 disables the watchdog). */
  noProgressTurnLimit?: number;
  /** Times a stuck run is handed its block info and continues instead of stopping (0 = block at once). */
  blockRecoveryAttempts?: number;
  duplicateObservationLimit?: number;
  maxRequestAttempts?: number;
  outputContinuationLimit?: number;
  protocolRecoveryAttempts?: number;
  /** Cost-saver mode: economical history diet + prompt-cache breakpoints (remote only). */
  costSaver?: boolean;
  /** Soft turn budget, active only with costSaver: warn once at N turns. 0/undefined = off. Never force-stops. */
  softTurnLimit?: number;
  contextTools: ToolContext['contextTools'];
  journalEnv: ToolContext['env'];
  conversation: Conversation;
  systemBlocks: string[];
  task: string;
  taskMessage?: ChatMessage;
  emit: Emit;
  onAskUser?: (q: string, options?: string[]) => Promise<string>;
  onUsage?: (u: TokenUsage, scope?: EventScope) => void;
}

export interface LoopOutcome {
  content: string;
  cancelled: boolean;
  exhausted: boolean;
  blocked: boolean;
  error?: string;
  /** Tool whose repeated failure triggered the block (if any). */
  blockedTool?: string;
  /** Last tool error text at block time, truncated (if any). */
  lastError?: string;
  productivelyChanged: boolean;
  usage: TokenUsage;
  turns: number;
}

function diffFor(before: string | null, after: string | null): { diff: string; add: number; del: number } {
  const lines = lineDiff(before ?? '', after ?? '');
  let add = 0, del = 0;
  const text = lines.map((l) => { if (l.type === 'add') add++; if (l.type === 'del') del++; return (l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.text; }).join('\n');
  return { diff: text.slice(0, 40000), add, del };
}

/** Errors that are safe to recover by re-requesting the SAME turn: nothing was committed to the
 * conversation, so a re-request cannot duplicate work. Auth/validation errors are NOT retryable. */
const RETRYABLE_STREAM_ERROR = /empty response|malformed streaming JSON|stream ended before completion|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|network|HTTP 429|HTTP 5\d\d|overloaded|timeout/i;
export function isRetryableStreamError(message: string | undefined): boolean {
  return !!message && RETRYABLE_STREAM_ERROR.test(message);
}

const CONTINUE_AFTER_CUTOFF = 'SYSTEM: Your previous message was cut off by the model output limit before it was complete. Continue exactly where you stopped. If a tool call was incomplete, emit it again in full. If the answer was already complete, call attempt_completion (code mode) or give the final answer.';
const RETRY_TOOL_CALL = 'SYSTEM: Your last tool call was rejected — its arguments were incomplete or not valid JSON, so nothing was executed. Re-emit the SAME action as one complete, valid tool call.';

export async function runMainLoop(deps: LoopDeps): Promise<LoopOutcome> {
  const { signal } = deps;
  const scope = requestScope('main');
  const emit = scopedEmit(deps.emit, scope);
  const progress = new ProgressGuard(deps.repeatedFailureLimit, deps.noProgressTurnLimit ?? 20, deps.duplicateObservationLimit ?? 0);
  const usage = zeroUsage();
  let content = '';
  let turns = 0;
  // Cost-saver soft turn budget (0/undefined = off): warn once at N turns via a
  // visible user message. Advisory only: the run always continues to its own
  // conclusion (completion, stop, or maxIterations). Never force-stops.
  const softLimit = deps.costSaver === true && deps.softTurnLimit && deps.softTurnLimit > 0 ? Math.floor(deps.softTurnLimit) : 0;
  let softWarned = false;
  let exhausted = false;
  let blocked = false;
  let productivelyChanged = false;
  // Last failing tool call this run (name + error). Surfaced on blocked/exhausted
  // outcomes so the run can explain itself and the next run can avoid repeating it.
  let lastFail: { name: string; error: string } | null = null;
  let emptyRecovery = 0;
  let cutoffRecovery = 0;        // output-limit continuations used this run
  let invalidRecovery = 0;       // malformed-tool-call recoveries used this run
  let turnRetries = 0;           // stream-error re-requests for the CURRENT turn
  let blockRecoveries = 0;       // stuck-pattern recoveries used this run
  const maxBlockRecoveries = Math.min(Math.max(0, deps.blockRecoveryAttempts ?? 2), 10);

  const turnRetryBudget = Math.min(Math.max(0, deps.turnRecoveryAttempts ?? 3), Math.max(0, (deps.maxRequestAttempts ?? 4) - 1));
  const MAX_CUTOFF_RECOVERY = deps.outputContinuationLimit ?? 4;
  const MAX_INVALID_RECOVERY = deps.protocolRecoveryAttempts ?? 3;

  // report_verdict is stage-only; the main loop must never accept it as completion.
  const tools = toolsForRun(deps.mode, deps.contextTools);

  // Iteration budget: 0 means unlimited, but cancellation and repeat detection always apply.
  const maxIter = deps.maxIterations > 0 ? deps.maxIterations : Number.POSITIVE_INFINITY;

  deps.conversation.messages.push(deps.taskMessage || { role: 'user', content: deps.task });
  if (!deps.conversation.originalTask) deps.conversation.originalTask = deps.conversation.messages.find((m) => m.role === 'user')?.content || deps.task;
  const schemas = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

  while (turns < maxIter) {
    // Yield a macrotask slot every turn: with an instant provider the loop would otherwise spin
    // purely on microtasks and starve timers — abort callbacks (Stop) would never fire.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (signal.aborted) return { content, cancelled: true, exhausted: false, blocked: false, productivelyChanged, usage, turns };
    if (softLimit > 0 && !softWarned && turns >= softLimit) {
      softWarned = true;
      const notice = `Cost-saver note: ${softLimit} turns used. Consider wrapping up: make one final essential change if needed, then call attempt_completion. This is advisory only; the run continues.`;
      deps.conversation.messages.push({ role: 'user', content: notice });
      emit('error', { message: notice, fatal: false });
    }

    Object.assign(scope, { requestId: randomUUID(), turnId: `${deps.runId}:${turns + 1}`, requestAttempt: turnRetries + 1 });
    const diet = historyDiet(deps.contextTools, deps.costSaver === true);
    const prepared = prepareConversation(deps.conversation, deps.systemBlocks, schemas, deps.contextWindow, deps.requestedMaxTokens, deps.autoCompact, deps.autoCompactAtPercent, deps.keepRecentTurns, deps.reasoningReplay ?? 'full', diet.full, diet.chars, diet.callChars);
    if (prepared.compaction?.compacted) emit('context.compacted', prepared.compaction);
    const { messages, maxTokens } = prepared;
    const contextStatus = { usedTokens: prepared.usedTokens, contextWindow: deps.contextWindow, maxTokens, autoCompactAtPercent: deps.autoCompactAtPercent, estimated: true };
    emit('context.usage', contextStatus);

    // Stream one assistant turn.
    const toolDeltas: Array<{ index: number; id?: string; name?: string; argsDelta?: string }> = [];
    let assistantText = '';
    let turnReasoning = '';
    let streamError: string | undefined;
    let finishReason: string | undefined;
    let firstTokenSeen = false;
    emit('provider.status', { phase: 'waiting_first_token' });
    for await (const ev of streamRequest(deps.provider, messages as ChatMessage[], { tools: schemas, maxTokens }, signal, scope, emit)) {
      if (signal.aborted && ev.type !== 'usage') continue;
      if (ev.type === 'done') finishReason = ev.finishReason;
      if (ev.type === 'usage' && ev.usage.promptTokens > 0) {
        deps.conversation.tokenScale = Math.max(deps.conversation.tokenScale || 1, ev.usage.promptTokens / prepared.rawTokens);
        emit('context.usage', { ...contextStatus, usedTokens: ev.usage.promptTokens + ev.usage.completionTokens, maxTokens: Math.max(0, deps.contextWindow - ev.usage.totalTokens), estimated: false });
      }
      handleStreamEvent(ev, { emit, usage, onContent: (t) => { assistantText += t; }, onReasoning: (t) => { turnReasoning += t; }, onUsage: (u) => deps.onUsage?.(u), onFirstToken: () => { if (!firstTokenSeen) { firstTokenSeen = true; emit('provider.status', { phase: 'generating' }); } }, toolDeltas, onError: (m) => { streamError = m; } });
    }

    if (signal.aborted) return { content, cancelled: true, exhausted: false, blocked: false, productivelyChanged, usage, turns };

    // A retryable stream/protocol error re-requests the turn: nothing was committed, so this is safe.
    if (streamError) {
      if (turnRetries < turnRetryBudget && isRetryableStreamError(streamError)) {
        turnRetries++;
        emit('retry', { requestId: scope.requestId, attempt: turnRetries, reason: streamError });
        continue;
      }
      return { content: assistantText || content, cancelled: false, exhausted: false, blocked: false, error: streamError, productivelyChanged, usage, turns };
    }
    turnRetries = 0;

    const { calls, invalid } = toolDeltas.length ? assembleToolCalls(toolDeltas) : parseTextToolCalls(assistantText);
    for (const bad of invalid) emit('error', { message: bad + ' Not executed (incomplete arguments).', fatal: false });

    // Output-limit cut-off: salvage what completed instead of killing the run.
    if (finishReason === 'length') {
      if (calls.length && !invalid.length) {
        // The tool call itself completed within the budget; only trailing text was lost. Execute it.
        emit('error', { message: 'The model reached its output limit, but the tool call was complete. Executing it and continuing.', fatal: false });
      } else if (cutoffRecovery < MAX_CUTOFF_RECOVERY) {
        cutoffRecovery++;
        if (assistantText.trim()) {
          deps.conversation.messages.push({ role: 'assistant', content: assistantText, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
        } else {
          // Nothing usable arrived: mark the empty attempt, then ask to continue. Auto-compact
          // frees output room on the next prepareConversation pass.
          deps.conversation.messages.push({ role: 'assistant', content: null, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
        }
        deps.conversation.messages.push({ role: 'user', content: CONTINUE_AFTER_CUTOFF });
        emit('retry', { requestId: 'main', attempt: cutoffRecovery, reason: 'Output limit reached; continuing the turn.' });
        turns++;
        continue;
      } else {
        return { content: assistantText || content, cancelled: false, exhausted: false, blocked: false, error: `The provider stopped at its generation limit ${MAX_CUTOFF_RECOVERY + 1} times (request allowed ${maxTokens.toLocaleString()} output tokens; context includes input, reasoning and output). Raise the model's output limit in its server settings, compact the session, or start a smaller task.`, productivelyChanged, usage, turns };
      }
    } else if (invalid.length) {
      // Malformed tool call: feed the error back and let the model retry, instead of blocking the run.
      if (invalidRecovery < MAX_INVALID_RECOVERY) {
        invalidRecovery++;
        if (assistantText.trim()) deps.conversation.messages.push({ role: 'assistant', content: assistantText });
        deps.conversation.messages.push({ role: 'user', content: RETRY_TOOL_CALL + ' Problem: ' + invalid.join(' ') });
        emit('retry', { requestId: 'main', attempt: invalidRecovery, reason: 'Malformed tool call; asking the model to re-emit it.' });
        turns++;
        continue;
      }
      return { content: assistantText, cancelled: false, exhausted: false, blocked: true, error: invalid.join(' '), productivelyChanged, usage, turns };
    }

    if (!calls.length) {
      content = assistantText || content;
      if (assistantText.trim()) {
        deps.conversation.messages.push({ role: 'assistant', content: assistantText, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
        deps.conversation.updatedAt = new Date().toISOString();
        return { content, cancelled: false, exhausted: false, blocked: false, productivelyChanged, usage, turns: turns + 1 };
      }
      // empty turn: feed reasoning back once or twice, then stop (never fabricate success)
      if (emptyRecovery < 2) {
        emptyRecovery++;
        deps.conversation.messages.push({ role: 'assistant', content: null, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
        deps.conversation.messages.push({ role: 'user', content: 'SYSTEM: Continue now — either call a tool to act, or give the final answer as visible text.' });
        turns++;
        continue;
      }
      return { content, cancelled: false, exhausted: false, blocked: false, error: 'The model produced no visible answer after recovery attempts. Check LM Studio and retry.', productivelyChanged, usage, turns: turns + 1 };
    }

    // Record assistant turn with tool calls.
    deps.conversation.messages.push({
      role: 'assistant', content: assistantText || null,
      ...(turnReasoning ? { reasoning_content: turnReasoning } : {}),
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.argsRaw } })),
    });

    progress.begin();
    let stallReason: string | undefined;
    for (const call of calls) {
      if (signal.aborted) return { content, cancelled: true, exhausted: false, blocked: false, productivelyChanged, usage, turns };
      const started = Date.now();
      emit('tool.started', { toolCallId: call.id, name: call.name, argsPreview: call.argsRaw.slice(0, 400) });
      let parsed: any = {};
      try { parsed = JSON.parse(call.argsRaw); } catch { /* handled below */ }
      if (call.name === 'todo' && Array.isArray(parsed.steps)) { deps.conversation.plan = parsed.steps; emit('plan.updated', { steps: parsed.steps }); }
      const exec = await executeTool(
        { env: deps.journalEnv, mode: deps.mode, contextTools: deps.contextTools, signal, onAskUser: deps.onAskUser },
        call.name, parsed,
      );
      const result: ToolResult = exec.result;
      emit('tool.finished', { toolCallId: call.id, name: call.name, ok: result.ok, durationMs: Date.now() - started, exitCode: result.exitCode ?? null, preview: (result.error || result.output || '').slice(0, 600), ...(exec.artifact ? { artifactId: exec.artifact.artifactId, downloadUrl: exec.artifact.downloadUrl } : {}), ...(exec.processArtifact ? { processArtifactId: exec.processArtifact.artifactId, processArtifactUrl: exec.processArtifact.downloadUrl } : {}) });

      // Journal-backed change → emit an accurate diff event.
      if (exec.changeId && exec.path) {
        const rec = getChange(exec.changeId);
        if (rec) {
          const { diff, add, del } = diffFor(rec.beforeText, rec.afterText);
          const pending = rec.status === 'pending';
          emit(pending ? 'change.pending' : 'change.applied', { changeId: rec.changeId, path: rec.path, operation: rec.operation, add, del, diff });
          productivelyChanged = true;
        }
      }

      deps.conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: result.ok ? result.output : 'ERROR: ' + (result.error || 'tool failed') + (result.output ? '\n' + result.output : '') });
      if (!result.ok) lastFail = { name: call.name, error: (result.error || result.output || 'tool failed').slice(0, 600) };
      if (call.name === 'attempt_completion' && result.ok && calls.length === 1) {
        content = result.output; emit('assistant.delta', { text: content });
        deps.conversation.messages.push({ role: 'assistant', content });
        return { content, cancelled: false, exhausted: false, blocked: false, productivelyChanged, usage, turns: turns + 1 };
      }

      stallReason ||= progress.observe(call.name, call.argsRaw, result);
    }
    stallReason ||= progress.end();
    if (stallReason) {
      // The model is smart enough to fix what blocks it when told plainly: hand it
      // the block info and let the run continue. Only when the recoveries are spent
      // does the run actually stop (with the failure memo for the next run).
      if (blockRecoveries < maxBlockRecoveries) {
        blockRecoveries++;
        const tool = lastFail?.name || 'unknown tool';
        const err = (lastFail?.error || 'no error text captured').slice(0, 500);
        deps.conversation.messages.push({ role: 'user', content:
          `SYSTEM: You are going in circles and I am stepping in instead of stopping the run (recovery ${blockRecoveries}/${maxBlockRecoveries}).\n` +
          `Stall pattern: ${stallReason}\nFailing tool: ${tool}.\nLast error: ${err}\n` +
          `Diagnose BEFORE your next tool call: re-read that error, run one small probe if needed, fix quoting/paths/arguments, or take a genuinely different approach. ` +
          `Do NOT emit the same failing call unchanged — that is what triggered this. If the task itself is impossible as stated, say so plainly instead of looping.` });
        emit('error', { message: `Stuck pattern (${stallReason}). Recovery ${blockRecoveries}/${maxBlockRecoveries}: block info sent back to the model, run continues.`, fatal: false });
        progress.reset();
        continue;
      }
      emit('error', { message: stallReason, fatal: true });
      return { content, cancelled: false, exhausted: false, blocked: true, error: stallReason, blockedTool: lastFail?.name, lastError: lastFail?.error, productivelyChanged, usage, turns: turns + 1 };
    }

    deps.conversation.updatedAt = new Date().toISOString();
    turns++;
  }

  // Exhausted the iteration budget without completing. NOT success.
  return { content, cancelled: false, exhausted: true, blocked: false, blockedTool: lastFail?.name, lastError: lastFail?.error, productivelyChanged, usage, turns };
}

function handleStreamEvent(ev: StreamEvent, h: { emit: Emit; usage: TokenUsage; onContent: (t: string) => void; onReasoning?: (t: string) => void; onUsage?: (u: TokenUsage, scope?: EventScope) => void; onFirstToken?: () => void; toolDeltas: Array<{ index: number; id?: string; name?: string; argsDelta?: string }>; onError: (m: string) => void }) {
  switch (ev.type) {
    case 'content': h.onFirstToken?.(); h.onContent(ev.text); h.emit('assistant.delta', { text: ev.text }); break;
    case 'reasoning': h.onFirstToken?.(); h.onReasoning?.(ev.text); h.emit('reasoning.delta', { text: ev.text }); break;
    case 'tool_delta': h.onFirstToken?.(); h.toolDeltas.push({ index: ev.index, id: ev.id, name: ev.name, argsDelta: ev.argsDelta }); break;
    case 'usage': h.usage.promptTokens += ev.usage.promptTokens; h.usage.completionTokens += ev.usage.completionTokens; h.usage.totalTokens += ev.usage.totalTokens; h.onUsage?.(ev.usage); h.emit('usage', { usage: ev.usage }); break;
    case 'retry': h.emit('retry', { requestId: 'main', attempt: ev.attempt, reason: ev.reason }); break;
    case 'error': h.onError(ev.message); h.emit('error', { message: ev.message, fatal: false }); break;
    case 'done': break;
  }
}

export interface StageOutcome { stage: string; passed: boolean; summary: string }

/** Run one review stage. Verdict is authoritative ONLY from the report_verdict tool.
 * v1.13: stage usage is reported through onUsage, output-limit cut-offs continue in place,
 * and retryable stream errors re-request the turn instead of failing the stage. */
export async function runStage(stage: string, deps: {
  provider: OpenAICompatProvider; signal: AbortSignal; contextWindow: number; requestedMaxTokens: number;
  reasoningReplay?: ReasoningReplay; autoCompact?: boolean; autoCompactAtPercent?: number; keepRecentTurns?: number;
  maxIterations: number; contextTools: ToolContext['contextTools']; journalEnv: ToolContext['env'];
  systemBlocks: string[]; stagePrompt: string; conversationContext: string; emit: Emit;
  onUsage?: (u: TokenUsage, scope?: EventScope) => void; turnRecoveryAttempts?: number;
  maxRequestAttempts?: number; stageOutputContinuationLimit?: number; duplicateObservationLimit?: number;
  noProgressTurnLimit?: number; repeatedFailureLimit?: number; protocolRecoveryAttempts?: number;
  stageId?: string; stageAttempt?: number;
  /** Cost-saver mode: economical history diet in stages too (cache marks stay remote-only). */
  costSaver?: boolean;
}): Promise<StageOutcome> {
  const stageId = deps.stageId || stage;
  const stageAttempt = deps.stageAttempt || 1;
  const scope = requestScope('stage', stageId, stageAttempt);
  const emit = scopedEmit(deps.emit, scope);
  const progress = new ProgressGuard(deps.repeatedFailureLimit ?? 3, deps.noProgressTurnLimit ?? 20, deps.duplicateObservationLimit ?? 0);
  const excluded = new Set(['attempt_completion', 'ask_user']);
  const tools = toolsForRun('code', deps.contextTools, true).filter((t) => !excluded.has(t.name));
  const schemas = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  // ONE system message at position 0: many local chat templates reject anything else.
  const conversation: Conversation = { messages: [{ role: 'user', content: deps.stagePrompt }], originalTask: deps.stagePrompt, plan: [], updatedAt: new Date().toISOString() };
  const systemBlocks = [...deps.systemBlocks, deps.conversationContext, STAGE_COMPLETION_PROTOCOL];
  let verdict: { passed: boolean; summary: string } | null = null;
  let text = '';
  const maxIter = deps.maxIterations > 0 ? deps.maxIterations : Number.POSITIVE_INFINITY;
  let iter = 0;
  const turnRetryBudget = Math.min(Math.max(0, deps.turnRecoveryAttempts ?? 3), Math.max(0, (deps.maxRequestAttempts ?? 4) - 1));
  let turnRetries = 0;
  let cutoffRecovery = 0;
  let invalidRecovery = 0;
  const MAX_STAGE_CUTOFF_RECOVERY = deps.stageOutputContinuationLimit ?? 2;
  const MAX_STAGE_INVALID_RECOVERY = deps.protocolRecoveryAttempts ?? 3;

  while (iter < maxIter) {
    await new Promise<void>((resolve) => setImmediate(resolve)); // keep timers/Stop responsive
    if (deps.signal.aborted) break;
    Object.assign(scope, { requestId: randomUUID(), turnId: `${stageId}:${stageAttempt}:${iter + 1}`, requestAttempt: turnRetries + 1 });
    const toolDeltas: Array<{ index: number; id?: string; name?: string; argsDelta?: string }> = [];
    let turnText = '';
    let turnReasoning = '';
    let streamError: string | undefined;
    let finishReason: string | undefined;
    const stageDiet = historyDiet(deps.contextTools, deps.costSaver === true);
    const prepared = prepareConversation(conversation, systemBlocks, schemas, deps.contextWindow, deps.requestedMaxTokens, deps.autoCompact, deps.autoCompactAtPercent, deps.keepRecentTurns, deps.reasoningReplay ?? 'tool-turns', stageDiet.full, stageDiet.chars, stageDiet.callChars);
    if (prepared.compaction?.compacted) emit('context.compacted', prepared.compaction);
    const contextStatus = { usedTokens: prepared.usedTokens, contextWindow: deps.contextWindow, maxTokens: prepared.maxTokens, autoCompactAtPercent: deps.autoCompactAtPercent || 80, estimated: true };
    emit('context.usage', contextStatus);
    const usage = zeroUsage();
    let firstTokenSeen = false;
    emit('provider.status', { phase: 'waiting_first_token' });
    for await (const ev of streamRequest(deps.provider, prepared.messages, { tools: schemas, maxTokens: prepared.maxTokens }, deps.signal, scope, emit)) {
      if (deps.signal.aborted && ev.type !== 'usage') continue;
      if (ev.type === 'done') finishReason = ev.finishReason;
      if (ev.type === 'usage' && ev.usage.promptTokens > 0) {
        conversation.tokenScale = Math.max(conversation.tokenScale || 1, ev.usage.promptTokens / prepared.rawTokens);
        emit('context.usage', { ...contextStatus, usedTokens: ev.usage.totalTokens, maxTokens: Math.max(0, deps.contextWindow - ev.usage.totalTokens), estimated: false });
      }
      handleStreamEvent(ev, { emit, usage, onUsage: (u) => deps.onUsage?.(u, scope), onContent: (t) => { turnText += t; }, onReasoning: (t) => { turnReasoning += t; }, onFirstToken: () => { if (!firstTokenSeen) { firstTokenSeen = true; emit('provider.status', { phase: 'generating' }); } }, toolDeltas, onError: (m) => { streamError = m; } });
    }
    if (deps.signal.aborted) break;
    if (streamError) {
      if (turnRetries < turnRetryBudget && isRetryableStreamError(streamError)) {
        turnRetries++;
        emit('retry', { requestId: scope.requestId, attempt: turnRetries, reason: streamError });
        continue;
      }
      return { stage, passed: false, summary: streamError };
    }
    turnRetries = 0;
    text += turnText;
    const { calls, invalid } = toolDeltas.length ? assembleToolCalls(toolDeltas) : parseTextToolCalls(turnText);
    if (invalid.length && finishReason === 'length' && cutoffRecovery < MAX_STAGE_CUTOFF_RECOVERY) {
      cutoffRecovery++;
      if (turnText.trim() || turnReasoning.trim()) conversation.messages.push({ role: 'assistant', content: turnText || null, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
      conversation.messages.push({ role: 'user', content: 'SYSTEM: Your reply was cut off by the output limit and the tool call arrived incomplete. Re-emit the same action as one complete tool call.' });
      emit('retry', { requestId: scope.requestId, attempt: cutoffRecovery, reason: 'Output limit reached mid tool call; continuing the stage.' });
      iter++;
      continue;
    }
    if (invalid.length) return { stage, passed: false, summary: invalid.join(' ') };
    if (finishReason === 'length' && !(calls.length && !invalid.length)) {
      if (cutoffRecovery < MAX_STAGE_CUTOFF_RECOVERY) {
        cutoffRecovery++;
        if (turnText.trim() || turnReasoning.trim()) conversation.messages.push({ role: 'assistant', content: turnText || null, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
        conversation.messages.push({ role: 'user', content: 'SYSTEM: Continue this stage; finish by calling report_verdict with your PASS or FAIL verdict.' });
        emit('retry', { requestId: scope.requestId, attempt: cutoffRecovery, reason: 'Output limit reached; continuing the stage.' });
        iter++;
        continue;
      }
      return { stage, passed: false, summary: 'Stage output reached the model limit repeatedly; partial tools were not executed.' };
    }
    if (!calls.length) {
      if (invalidRecovery < MAX_STAGE_INVALID_RECOVERY) {
        invalidRecovery++;
        conversation.messages.push({ role: 'assistant', content: turnText || null, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}) });
        conversation.messages.push({ role: 'user', content: STAGE_COMPLETION_PROTOCOL + ' Your last reply had no structured verdict. Call report_verdict now.' });
        emit('retry', { requestId: scope.requestId, attempt: invalidRecovery, reason: 'Missing structured verdict; asking the model to call report_verdict.' });
        iter++;
        continue;
      }
      break;
    }
    conversation.messages.push({ role: 'assistant', content: turnText || null, ...(turnReasoning ? { reasoning_content: turnReasoning } : {}), tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.argsRaw } })) });
    progress.begin();
    for (const call of calls) {
      if (deps.signal.aborted) return { stage, passed: false, summary: 'Cancelled.' };
      emit('tool.started', { toolCallId: call.id, name: call.name, argsPreview: call.argsRaw.slice(0, 400) });
      const started = Date.now();
      let stageArgs: any = {};
      try { stageArgs = JSON.parse(call.argsRaw || '{}'); } catch { stageArgs = {}; }
      const exec = await executeTool({ env: deps.journalEnv, mode: 'code', contextTools: deps.contextTools, signal: deps.signal }, call.name, stageArgs);
      emit('tool.finished', { toolCallId: call.id, name: call.name, ok: exec.result.ok, durationMs: Date.now() - started, preview: (exec.result.error || exec.result.output).slice(0, 300), ...(exec.artifact ? { artifactId: exec.artifact.artifactId, downloadUrl: exec.artifact.downloadUrl } : {}), ...(exec.processArtifact ? { processArtifactId: exec.processArtifact.artifactId, processArtifactUrl: exec.processArtifact.downloadUrl } : {}) });
      if (exec.changeId && exec.path) {
        const rec = getChange(exec.changeId);
        if (rec) {
          const { diff, add, del } = diffFor(rec.beforeText, rec.afterText);
          emit(rec.status === 'pending' ? 'change.pending' : 'change.applied', { changeId: rec.changeId, path: rec.path, operation: rec.operation, add, del, diff });
        }
      }
      const stall = progress.observe(call.name, call.argsRaw.slice(0, 400), exec.result);
      if (stall) return { stage, passed: false, summary: stall };
      if (call.name === 'report_verdict') {
        const m = /VERDICT:(PASS|FAIL)\|(.*)$/.exec(exec.result.output || '');
        if (m) verdict = { passed: m[1] === 'PASS', summary: m[2].slice(0, 300) };
      }
      conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: exec.result.ok ? exec.result.output : 'ERROR: ' + (exec.result.error || '') });
    }
    if (verdict) return { stage, passed: verdict.passed, summary: verdict.summary };
    const stallTurn = progress.end();
    if (stallTurn) return { stage, passed: false, summary: stallTurn };
    iter++;
  }

  if (verdict) return { stage, passed: verdict.passed, summary: verdict.summary };
  return { stage, passed: false, summary: 'No structured VERDICT was reported by the stage (treated as FAIL).' };
}

export interface StageRunDeps {
  reasoningReplay?: ReasoningReplay; autoCompact?: boolean; autoCompactAtPercent?: number; keepRecentTurns?: number;
  provider: OpenAICompatProvider;
  signal: AbortSignal;
  contextWindow: number;
  requestedMaxTokens: number;
  maxIterations: number;
  contextTools: ToolContext['contextTools'];
  journalEnv: ToolContext['env'];
  systemBlocks: string[];
  stagePrompt: string;
  conversationContext: string;
  refreshContext?: () => Promise<string>;
  afterAttempt?: () => Promise<void>;
  emit: Emit;
  onUsage?: (u: TokenUsage, scope?: EventScope) => void;
  turnRecoveryAttempts?: number;
  maxRequestAttempts?: number; stageOutputContinuationLimit?: number; duplicateObservationLimit?: number;
  noProgressTurnLimit?: number; repeatedFailureLimit?: number; protocolRecoveryAttempts?: number;
  /** Cost-saver mode for stage runs (diet preset; cache marks stay remote-only). */
  costSaver?: boolean;
}

/**
 * Run a stage with bounded repair: on FAIL, re-run with the failure in context, up to
 * maxRepair extra attempts. The final verdict (pass or fail) is what counts downstream.
 */
export async function runStageWithRepair(stage: string, deps: StageRunDeps, maxRepair: number): Promise<StageOutcome & { attempts: number }> {
  let attempts = 0;
  let failure = '';
  for (;;) {
    attempts++;
    const context = (deps.refreshContext ? await deps.refreshContext() : deps.conversationContext) + failure;
    const r = await runStage(stage, { ...deps, conversationContext: context, stageId: stage, stageAttempt: attempts });
    if (!deps.signal.aborted) await deps.afterAttempt?.();
    if (r.passed || attempts > maxRepair || deps.signal.aborted) {
      return { ...r, summary: attempts > 1 ? `[attempt ${attempts}] ${r.summary}` : r.summary, attempts };
    }
    deps.emit('error', { message: `Stage ${stage} failed (attempt ${attempts}/${1 + maxRepair}); repairing.`, fatal: false });
    failure = `\n\nPrevious attempt FAILED: ${r.summary}\nFix the reported problem before finalizing.`;
  }
}

export type { AgentEvent, AssembledToolCall };
