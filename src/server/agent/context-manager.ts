// Conversation + context management. Persists structured turns (including tool call/result pairs)
// and compacts safely without orphaning tool results.
import type { ChatMessage } from '../providers/openai-compatible';
import { getEncoding } from 'js-tiktoken';

export interface Conversation {
  messages: ChatMessage[];        // durable structured history (system excluded)
  plan: string[];
  /** Durable compaction summary, injected into the next system message. */
  summary?: string;
  /** The first user task stays available after older turns are summarized. */
  originalTask?: string;
  compactions?: number;
  tokenScale?: number;
  tokenModel?: string;
  updatedAt: string;
}

export function newConversation(): Conversation { return { messages: [], plan: [], updatedAt: new Date().toISOString() }; }

/**
 * How much `reasoning_content` is replayed to the provider on every request. Reasoning is the
 * single largest avoidable cost in a long coding turn (v1.09 measured 423,607 replayed characters),
 * so the policy is chosen per provider rather than kept at "replay everything".
 *
 * - `active-batch` — default for every provider. Only the LATEST assistant tool-call
 *   batch keeps its reasoning. A live 2-call probe (OpenRouter deepseek-v4.1-flash:
 *   tool round, then history with zero replayed reasoning) answered HTTP 200 with no
 *   400, so full-history replay is no longer the safe default. Override explicitly
 *   per model if one rejects pruned history.
 * - `tool-turns`   — compatibility option. Reasoning is kept on assistant messages that
 *   carry tool_calls (what DeepSeek's thinking mode historically required when the
 *   request carries `tools`). Reasoning on plain assistant text turns is ignored
 *   by DeepSeek and unknown to every other OpenAI-compatible API, so replaying it is pure cost.
 * - `full`         — replay everything (compatibility escape hatch).
 */
export type ReasoningReplay = 'none' | 'active-batch' | 'tool-turns' | 'full';

export function resolveReasoningReplay(value: unknown, local: boolean): ReasoningReplay {
  if (value === 'none' || value === 'active-batch' || value === 'tool-turns' || value === 'full') return value;
  // 'auto'/legacy/unknown: latest-batch-only everywhere (see above). `local` is kept
  // for API compatibility; local and remote now resolve identically.
  void local;
  return 'active-batch';
}

/** Accepts the legacy boolean (`true` = full replay) so older callers keep working. */
export function reasoningReplayPolicy(value: ReasoningReplay | boolean | undefined): ReasoningReplay {
  if (value === true || value === undefined) return 'full';
  if (value === false) return 'active-batch';
  return value;
}

// cl100k is an estimate unless the provider uses that tokenizer and chat template.
let encoder: { encode: (s: string) => number[] } | null = null;
let encoderFailed = false;
function getEncoder(): { encode: (s: string) => number[] } | null {
  if (encoder || encoderFailed) return encoder;
  try { encoder = getEncoding('cl100k_base'); } catch { encoderFailed = true; }
  return encoder;
}

export function estimatorName(): string { return getEncoder() ? 'cl100k estimate (includes reasoning)' : 'bytes/4 fallback'; }

/**
 * BPE merging is quadratic in the length of a single whitespace-free run, so one degenerate string
 * — a `======` rule in a build log, a padded file, a corrupt blob — can block the tokenizer for
 * minutes. Because counting happens synchronously on every message of every turn, in the same
 * single-threaded process that drives the agent loop and serves the event stream, that reads to the
 * user as a stalled session. Measured on this machine: 20,000 identical characters took 18 s, and
 * cost grows with the square of the run length.
 *
 * Runs longer than this are sampled and extrapolated instead of fully encoded. Ordinary prose,
 * source code, JSON and base64 all split into short runs and are still counted exactly.
 */
const EXACT_RUN_LIMIT = 1000;
const SAMPLE_CHARS = 400;
const LONG_RUN = /\S{1001,}/;

export function countTokens(text: string): number {
  const enc = getEncoder();
  if (!enc) return Math.ceil(text.length / 4);
  try {
    // Fast path: ordinary prose, source code, JSON and base64 all break into short runs and are
    // counted exactly. Only text that actually contains a degenerate run takes the sampling path.
    if (text.length <= EXACT_RUN_LIMIT || !LONG_RUN.test(text)) return enc.encode(text).length;
    let total = 0;
    for (const run of text.split(/(\s+)/)) {
      if (!run) continue;
      if (run.length <= EXACT_RUN_LIMIT) { total += enc.encode(run).length; continue; }
      // Sample the head and scale: the tokens-per-character ratio of a long unbroken run is stable.
      const sample = enc.encode(run.slice(0, SAMPLE_CHARS)).length / SAMPLE_CHARS;
      total += Math.ceil(run.length * sample);
    }
    return total;
  } catch { return Math.ceil(text.length / 4); }
}

const est = (s: string) => countTokens(s);

export function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + 8 + (m.images?.length || 0) * 4096 + est(m.content || '') + est(m.reasoning_content || '') + (m.tool_calls ? est(JSON.stringify(m.tool_calls)) : 0), 3);
}

export function summaryBudgetForContext(contextWindow: number): number {
  // Scale with the loaded model, while keeping summaries compact enough to leave room to work.
  return Math.min(3200, Math.max(512, Math.floor(contextWindow * 0.06)));
}

function exchangeGroups(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const message of messages) {
    current.push(message);
    if (message.role === 'assistant' && !message.tool_calls?.length) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  return groups;
}

function limitText(text: string, maxTokens: number): string {
  if (countTokens(text) <= maxTokens) return text;
  const marker = '\n[Earlier detail omitted; inspect files or event history if needed.]';
  maxTokens = Math.max(0, maxTokens - countTokens(marker));
  let low = 0; let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countTokens(text.slice(0, mid)) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low).trimEnd() + marker;
}

/**
 * Token diet for tool history: stale tool results are condensed on the OUTGOING
 * copy only. The durable conversation, event log and output artifacts always keep
 * the complete outputs. The most recent `keepFull` tool messages stay complete;
 * older ones keep the first `maxChars` characters plus a pointer. `maxChars <= 0`
 * disables condensing. Never mutates its input.
 */
export function summarizeOldToolOutputs(messages: ChatMessage[], keepFull = 5, maxChars = 500): ChatMessage[] {
  if (maxChars <= 0) return messages;
  const toolIdx: number[] = [];
  messages.forEach((m, i) => { if (m.role === 'tool' && typeof m.content === 'string') toolIdx.push(i); });
  const keep = keepFull <= 0 ? new Set<number>() : new Set(toolIdx.slice(-keepFull));
  return messages.map((m, i) => {
    if (m.role !== 'tool' || keep.has(i) || typeof m.content !== 'string' || m.content.length <= maxChars) return m;
    return { ...m, content: m.content.slice(0, maxChars).trimEnd() + `\n[Earlier tool output condensed to ${maxChars} characters for context; the complete output is retained in run history.]` };
  });
}

/**
 * Token diet for tool CALLS: stale call arguments are condensed on the OUTGOING
 * copy only (companion to summarizeOldToolOutputs, which handles results).
 * Historical tool_calls JSON (often whole file contents in write_file/edit_file
 * arguments) is the largest single block in long runs. The most recent `keepFull`
 * assistant tool-call messages stay complete; older ones keep call ids, types and
 * function names with per-argument summaries. `maxChars <= 0` disables.
 * Never mutates its input.
 */
export function summarizeOldToolCallArgs(messages: ChatMessage[], keepFull = 5, maxChars = 200): ChatMessage[] {
  if (maxChars <= 0) return messages;
  const toolIdx: number[] = [];
  messages.forEach((m, i) => { if (m.role === 'assistant' && m.tool_calls?.length) toolIdx.push(i); });
  const keep = keepFull <= 0 ? new Set<number>() : new Set(toolIdx.slice(-keepFull));
  return messages.map((m, i) => {
    if (m.role !== 'assistant' || keep.has(i) || !m.tool_calls?.length) return m;
    return { ...m, tool_calls: m.tool_calls.map((c) => ({ ...c, function: { ...((c as { function?: unknown }).function as Record<string, unknown> || {}), arguments: condenseToolArguments((c as { function?: { arguments?: unknown } }).function?.arguments, maxChars) } })) };
  });
}

function condenseToolArguments(raw: unknown, maxChars: number): string {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parts = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
        const valueText = typeof value === 'string' ? value : JSON.stringify(value);
        return `${key}=${valueText.length > 120 ? `<${valueText.length} chars>` : valueText}`;
      });
      const summary = '{' + parts.join(', ') + '}';
      if (summary.length <= maxChars) return summary;
    }
  } catch { /* fall through to slicing */ }
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + `\n[Earlier tool arguments condensed; full text retained in run history.]`;
}

export interface HistoryDiet { full: number; chars: number; callChars: number }
/**
 * Effective history diet: user knobs normally; the economical saver preset while
 * cost-saver mode is on (documented on the toggle). Applies to every provider —
 * only the cache breakpoints stay remote-only.
 */
export function historyDiet(limits: { historyToolFull?: number; historyToolChars?: number; historyToolCallChars?: number }, saver: boolean): HistoryDiet {
  if (!saver) return { full: limits.historyToolFull ?? 5, chars: limits.historyToolChars ?? 500, callChars: limits.historyToolCallChars ?? 200 };
  return { full: 2, chars: 200, callChars: 100 };
}

function summarizeMessages(messages: ChatMessage[]): string {
  return messages.map((message) => {
    if (message.role === 'tool') return `Tool result${message.tool_call_id ? ` (${message.tool_call_id})` : ''}: ${String(message.content || '').slice(0, 1800)}`;
    if (message.role === 'assistant' && message.tool_calls?.length) return `Assistant tool calls: ${message.tool_calls.map((c) => `${c.function.name}(${c.function.arguments.slice(0, 500)})`).join('; ')}${message.content ? `\nAssistant: ${String(message.content).slice(0, 1000)}` : ''}`;
    return `${message.role === 'user' ? 'User' : 'Assistant'}: ${String(message.content || '').slice(0, 1800)}`;
  }).join('\n\n');
}

export interface CompactionResult { compacted: boolean; earlierTurns: number; summaryTokens: number; beforeTokens: number; afterTokens: number }

/** Persist a bounded summary and retain complete recent exchanges, including tool protocol pairs. */
export function compactConversation(conversation: Conversation, contextWindow: number, keepRecentTurns: number, targetTokens = Infinity): CompactionResult {
  const beforeTokens = estimateTokens(conversation.messages) + countTokens(conversation.summary || '');
  let groups = exchangeGroups(conversation.messages);
  let keep = Math.max(1, keepRecentTurns);
  // Under pressure, split a long coding turn only AFTER all results for a tool batch.
  // Keeping an entire unfinished user task made auto-compaction a no-op during long runs.
  if (beforeTokens > targetTokens) {
    groups = [];
    let group: ChatMessage[] = [];
    const pending = new Set<string>();
    for (const message of conversation.messages) {
      group.push(message);
      for (const call of message.tool_calls || []) pending.add(call.id);
      if (message.role === 'tool') pending.delete(message.tool_call_id || '');
      if (!pending.size && (message.role === 'tool' || message.role === 'assistant')) { groups.push(group); group = []; }
    }
    if (group.length) groups.push(group);
    while (keep > 1 && estimateTokens(groups.slice(-keep).flat()) > targetTokens - summaryBudgetForContext(contextWindow)) keep--;
  }
  const old = groups.slice(0, Math.max(0, groups.length - keep));
  if (!old.length) return { compacted: false, earlierTurns: 0, summaryTokens: countTokens(conversation.summary || ''), beforeTokens, afterTokens: beforeTokens };
  const prior = conversation.summary ? `Prior historical summary:\n${conversation.summary}\n\n` : '';
  const preserved = [
    conversation.originalTask ? `Original task: ${conversation.originalTask}` : '',
    conversation.plan.length ? `Active plan:\n${conversation.plan.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : '',
    'Earlier turns and tool state:',
    // Recent observations matter most when the extractive summary reaches its budget.
    summarizeMessages([...old].reverse().flat()),
  ].filter(Boolean).join('\n\n');
  const budget = summaryBudgetForContext(contextWindow);
  // Give new observations their own budget: a full old summary must not crowd them out.
  conversation.summary = prior ? limitText(preserved, Math.floor(budget * 0.7)) + '\n\n' + limitText(prior, Math.floor(budget * 0.3) - 2) : limitText(preserved, budget);
  const latestRequest = [...conversation.messages].reverse().find((m) => m.role === 'user');
  conversation.messages = groups.slice(-keep).flat();
  if (latestRequest && !conversation.messages.includes(latestRequest)) conversation.messages.unshift(latestRequest);
  conversation.compactions = (conversation.compactions || 0) + 1;
  conversation.updatedAt = new Date().toISOString();
  const summaryTokens = countTokens(conversation.summary);
  return { compacted: true, earlierTurns: old.length, summaryTokens, beforeTokens, afterTokens: estimateTokens(conversation.messages) + summaryTokens };
}

/** Keep system + recent exchanges; drop oldest whole exchanges (never a lone tool result). */
export function compact(messages: ChatMessage[], budgetTokens: number): { messages: ChatMessage[]; before: number; after: number } {
  const before = estimateTokens(messages);
  if (before <= budgetTokens) return { messages, before, after: before };
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  // Group into "exchanges" ending at each assistant message; a tool result belongs to the preceding assistant.
  const groups: ChatMessage[][] = [];
  let cur: ChatMessage[] = [];
  for (const m of rest) {
    cur.push(m);
    if (m.role === 'assistant' && !m.tool_calls?.length) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);

  const kept: ChatMessage[][] = [];
  let total = estimateTokens(system);
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = estimateTokens(groups[i]);
    if (total + g > budgetTokens && kept.length >= 1) break; // always keep at least the last exchange
    kept.unshift(groups[i]);
    total += g;
  }
  const out = [...system, ...kept.flat()];
  return { messages: out, before, after: estimateTokens(out) };
}

/** Build the message list for a turn: ONE system message (many templates reject anything else),
 * then compacted history, then the new request. */
export function buildTurnMessages(opts: {
  systemBlocks: string[];
  history: ChatMessage[];
  request: string;
  contextBudgetTokens: number;
}): { messages: ChatMessage[]; before: number; after: number } {
  const system: ChatMessage[] = [{ role: 'system' as const, content: opts.systemBlocks.filter(Boolean).join('\n\n') }];
  const combined = [...system, ...opts.history, ...(opts.request ? [{ role: 'user' as const, content: opts.request }] : [])];
  const r = compact(combined, opts.contextBudgetTokens);
  // Guarantee exactly one leading system message even after compaction.
  const sysMsg = r.messages.find((m) => m.role === 'system');
  const rest = r.messages.filter((m) => m.role !== 'system');
  const out = sysMsg ? [sysMsg, ...rest] : rest;
  return { messages: out, before: r.before, after: estimateTokens(out) };
}

/** Budget schemas as well as messages. Prune old tool payloads while preserving protocol pairs,
 * the original request and recent observations. Full outputs remain in the durable event log. */
export function prepareRequest(messages: ChatMessage[], tools: unknown[], context: number, requested: number, tokenScale = 1) {
  // Keep a small protocol buffer. Reserving 20% of every local model window for output made
  // the effective usable context far smaller than the model reported, even before compaction.
  const reserve = Math.max(128, Math.ceil(context * 0.02));
  const schemaTokens = countTokens(JSON.stringify(tools));
  const minimumOutput = Math.min(requested || context, 256);
  const budget = (context - reserve - minimumOutput) / tokenScale - schemaTokens;
  let out = messages.map((m) => ({ ...m }));
  const before = estimateTokens(out);
  for (let i = 0; i < out.length && estimateTokens(out) > budget; i++) {
    const m = out[i];
    if (m.role === 'tool' && m.content) {
      const excess = estimateTokens(out) - budget;
      m.content = limitText(m.content, Math.max(128, countTokens(m.content) - excess - 16));
    }
  }
  if (estimateTokens(out) > budget) {
    // Drop complete earlier exchanges, pinning the current task outside the compacted history.
    const pinned = out.find((m) => m.role === 'user');
    const r = compact(out, Math.max(0, budget - (pinned ? estimateTokens([pinned]) : 0)));
    out = r.messages;
    if (pinned && !out.includes(pinned)) out.splice(out[0]?.role === 'system' ? 1 : 0, 0, pinned);
  }
  const rawTokens = estimateTokens(out) + schemaTokens;
  const used = Math.ceil(rawTokens * tokenScale);
  const available = context - used - reserve;
  if (available < 128) throw new Error(`The request needs about ${used} tokens but the loaded context is ${context}. Increase the model's loaded context in LM Studio or start a smaller task.`);
  return { messages: out, maxTokens: Math.max(1, Math.min(requested || context, available)), usedTokens: used, rawTokens, before, after: estimateTokens(out) };
}

/** One budget path for main runs and review stages; instructions and schemas count too. */
export function prepareConversation(conversation: Conversation, systemBlocks: string[], tools: unknown[], context: number, requested: number, autoCompact = true, threshold = 80, keep = 4, replay: ReasoningReplay | boolean = 'full', historyFull = 5, historyChars = 500, historyCallChars = 200) {
  // Reasoning replay is bounded per provider (see ReasoningReplay). The durable conversation and
  // the event log always keep the originals; only the outgoing copy is pruned.
  const original = conversation;
  const durableMessages = new Map<ChatMessage, ChatMessage>();
  const policy = reasoningReplayPolicy(replay);
  if (policy !== 'full') {
    let lastUser = -1;
    let lastToolAssistant = -1;
    conversation.messages.forEach((m, i) => {
      if (m.role === 'user') lastUser = i;
      if (m.role === 'assistant' && m.tool_calls?.length) lastToolAssistant = i;
    });
    const keepReasoning = (m: ChatMessage, i: number): boolean => {
      if (m.role !== 'assistant' || policy === 'none') return false;
      // DeepSeek thinking mode requires reasoning on every assistant turn that called tools.
      if (policy === 'tool-turns') return !!m.tool_calls?.length;
      return !!m.tool_calls?.length && i >= lastToolAssistant && i >= lastUser;
    };
    conversation = { ...conversation, messages: conversation.messages.map((m, i) => {
      if (!m.reasoning_content || keepReasoning(m, i)) return m;
      const { reasoning_content, ...rest } = m;
      durableMessages.set(rest, m);
      return rest;
    }) };
  }
  // Stale tool results are condensed on the outgoing copy (durable history untouched).
  // Register condensed copies so a later compaction restore recovers the full originals.
  const summarized = summarizeOldToolOutputs(conversation.messages, historyFull, historyChars);
  summarized.forEach((m, i) => { if (m !== conversation.messages[i]) durableMessages.set(m, conversation.messages[i]); });
  conversation = { ...conversation, messages: summarized };
  // Same treatment for stale tool CALL arguments (ids, types and names are kept so
  // tool result pairing still resolves; only argument bodies shrink).
  const argSlimmed = summarizeOldToolCallArgs(conversation.messages, historyFull, historyCallChars);
  argSlimmed.forEach((m, i) => { if (m !== conversation.messages[i]) durableMessages.set(m, conversation.messages[i]); });
  conversation = { ...conversation, messages: argSlimmed };
  const scale = Math.max(1, conversation.tokenScale || 1);
  const system = () => {
    const retained = conversation.messages.map((m) => m.content || '').join('\n');
    const plan = conversation.plan.join('\n');
    const task = conversation.originalTask || '';
    return [...new Set(systemBlocks.filter(Boolean)), task && !retained.includes(task) ? `Original task: ${task}` : '', plan && !retained.includes(plan) ? `Current plan:\n${plan}` : '', conversation.summary ? `Historical session summary:\n${conversation.summary}` : ''].filter(Boolean).join('\n\n');
  };
  const messages = (): ChatMessage[] => [{ role: 'system', content: system() }, ...conversation.messages];
  const trigger = Math.floor(context * threshold / 100);
  let compaction: CompactionResult | undefined;
  if (autoCompact && (estimateTokens(messages()) + countTokens(JSON.stringify(tools))) * scale >= trigger) {
    const fixed = estimateTokens([{ role: 'system', content: systemBlocks.join('\n\n') + (conversation.originalTask || '') + conversation.plan.join('\n') }]) + countTokens(JSON.stringify(tools));
    const target = Math.max(0, trigger / scale - fixed);
    compaction = compactConversation(conversation, context, keep, target);
    if (compaction.compacted && conversation !== original) {
      original.summary = conversation.summary; original.compactions = conversation.compactions;
      // The event log retains all original reasoning even when earlier turns are compacted.
      original.messages = conversation.messages.map((m) => durableMessages.get(m) || m);
      original.updatedAt = conversation.updatedAt;
    }
  }
  return { ...prepareRequest(messages(), tools, context, requested, scale), compaction };
}
