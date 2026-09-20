// EC12 shared contracts. Single source of truth for run states, events, changes, and results.
// Imported by both server and UI.

export type Mode = 'ask' | 'plan' | 'code';

export type RunState =
  | 'queued' | 'preparing' | 'generating' | 'executing_tool' | 'waiting_for_approval'
  | 'compacting' | 'verifying' | 'reviewing' | 'cancelling'
  | 'succeeded' | 'failed' | 'cancelled' | 'blocked' | 'unverified' | 'interrupted';

export const RUN_STATES: RunState[] = [
  'queued', 'preparing', 'generating', 'executing_tool', 'waiting_for_approval',
  'compacting', 'verifying', 'reviewing', 'cancelling',
  'succeeded', 'failed', 'cancelled', 'blocked', 'unverified', 'interrupted',
];

export const TERMINAL_STATES: RunState[] = ['succeeded', 'failed', 'cancelled', 'blocked', 'unverified', 'interrupted'];
export const isTerminal = (s: RunState) => TERMINAL_STATES.includes(s);

// Enforced server-side. A cancelled run can never become succeeded; a failed stage cannot become succeeded.
export const ALLOWED_TRANSITIONS: Record<RunState, RunState[]> = {
  queued: ['preparing', 'cancelling', 'blocked'],
  preparing: ['generating', 'cancelling', 'failed', 'blocked'],
  generating: ['executing_tool', 'compacting', 'verifying', 'reviewing', 'generating', 'cancelling', 'failed', 'blocked'],
  executing_tool: ['generating', 'waiting_for_approval', 'reviewing', 'cancelling', 'failed'],
  waiting_for_approval: ['generating', 'cancelled', 'failed'],
  compacting: ['generating', 'cancelling', 'failed'],
  verifying: ['generating', 'reviewing', 'succeeded', 'unverified', 'failed', 'cancelling'],
  reviewing: ['generating', 'verifying', 'reviewing', 'succeeded', 'failed', 'cancelling'],
  cancelling: ['cancelled', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
  blocked: [],
  unverified: [],
  interrupted: [],
};

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'unavailable' | 'cancelled';

export interface EventEnvelope<TType extends string = string, TData = unknown> {
  version: 1;
  eventId: string;
  sequence: number;
  timestamp: string;
  sessionId: string;
  runId: string;
  type: TType;
  data: TData;
}

export interface AgentEventScope {
  phase?: 'main' | 'stage';
  stageId?: string | null;
  stageAttempt?: number;
  requestId?: string | null;
  turnId?: string;
  requestAttempt?: number;
}

export type ScopedEventEnvelope<TType extends string, TData> = EventEnvelope<TType, TData & AgentEventScope>;

export interface TokenUsage { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }
export const zeroUsage = (): TokenUsage => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 });

export interface PriceSnapshot { model: string; inPrice: number; outPrice: number; currency: string }

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
  exitCode?: number | null;
  durationMs?: number;
  artifactPath?: string;
}

export interface ChangeRecord {
  changeId: string;
  sessionId: string;
  runId: string;
  tool: string;
  path: string;            // workspace-relative
  operation: 'create' | 'modify' | 'delete';
  beforeExists: boolean;
  beforeText: string | null;
  beforeHash: string | null;
  afterText: string | null;
  afterHash: string | null;
  createdAt: string;
  appliedAt: string | null;
  status: 'pending' | 'applied' | 'reverted' | 'conflict' | 'applying';
  workspacePath?: string;
}

export interface VerificationCheck {
  checkId: string;
  name: string;
  command: string;
  cwd: string;
  required: boolean;
  status: CheckStatus;
  exitCode?: number | null;
  durationMs?: number;
  outputPreview?: string;
  artifactPath?: string;
}

export interface VerificationResult {
  outcome: 'verified' | 'failed' | 'unverified';
  checks: VerificationCheck[];
  revision: string; // workspace revision/hash at verification time
}

export interface RunSummary {
  outcome: RunState;
  model: string | null;
  modes: Mode;
  implemented: string;
  filesChanged: string[];
  checks: Array<{ name: string; status: CheckStatus; exitCode?: number | null }>;
  stages: Array<{ stage: string; passed: boolean; summary: string }>;
  remaining: string[];
  howToRun: string;
}

// ---- event union ----
// Every event the runtime actually emits is a member. Scope fields (phase/stageId/stageAttempt/
// requestId and friends) are optional data properties merged in by scopedEmit, so pre-scope emit
// shapes remain assignable.
export type AgentEvent =
  | ScopedEventEnvelope<'run.created', { mode: Mode; workspace: string; model: string | null; task?: string }>
  | ScopedEventEnvelope<'run.state', { state: RunState; detail?: string }>
  | ScopedEventEnvelope<'model.resolved', { model: string; contextWindow: number; maxTokens: number; local?: boolean }>
  | ScopedEventEnvelope<'context.usage', { usedTokens: number; contextWindow: number; maxTokens: number; autoCompactAtPercent?: number; autoCompactAtTokens?: number; estimated?: boolean }>
  | ScopedEventEnvelope<'assistant.delta', { text: string }>
  | ScopedEventEnvelope<'assistant.message', { text: string }>
  | ScopedEventEnvelope<'reasoning.delta', { text: string }>
  | ScopedEventEnvelope<'plan.updated', { steps: string[] }>
  | ScopedEventEnvelope<'tool.started', { toolCallId: string; name: string; argsPreview: string }>
  | ScopedEventEnvelope<'tool.finished', { toolCallId: string; name: string; ok: boolean; durationMs: number; exitCode?: number | null; preview: string }>
  | ScopedEventEnvelope<'change.applied', { changeId: string; path: string; operation: ChangeRecord['operation']; add: number; del: number; diff: string }>
  | ScopedEventEnvelope<'change.pending', { changeId: string; path: string; operation: ChangeRecord['operation']; add: number; del: number; diff: string }>
  | ScopedEventEnvelope<'change.reverted', { changeId: string; path: string }>
  | ScopedEventEnvelope<'verification.started', { revision: string }>
  | ScopedEventEnvelope<'verification.baseline', { checks: VerificationCheck[] }>
  | ScopedEventEnvelope<'verification.check', { check: VerificationCheck }>
  | ScopedEventEnvelope<'verification.finished', { result: VerificationResult }>
  | ScopedEventEnvelope<'stage.started', { stage: string; label: string }>
  | ScopedEventEnvelope<'stage.finished', { stage: string; passed: boolean; summary: string }>
  | ScopedEventEnvelope<'context.compacted', { compacted: true; earlierTurns: number; summaryTokens: number; beforeTokens: number; afterTokens: number }>
  | ScopedEventEnvelope<'usage', { usage: TokenUsage; price?: PriceSnapshot }>
  | ScopedEventEnvelope<'retry', { requestId: string; attempt: number; reason: string }>
  | ScopedEventEnvelope<'ask_user', { question: string; options?: string[] }>
  | ScopedEventEnvelope<'question.asked', { question: string; options?: string[] }>
  | ScopedEventEnvelope<'question.answered', { answer: string }>
  | ScopedEventEnvelope<'error', { message: string; fatal: boolean }>
  | ScopedEventEnvelope<'provider.status', { phase: 'waiting_first_token' | 'generating'; providerPhase?: 'waiting_first_token' | 'generating' }>
  | ScopedEventEnvelope<'request.started', AgentEventScope>
  | ScopedEventEnvelope<'request.finished', { usageStatus: 'reported' | 'unknown'; completed: boolean; cancelled: boolean }>
  | ScopedEventEnvelope<'run.finished', { summary: RunSummary }>;

export type AgentEventType = AgentEvent['type'];
