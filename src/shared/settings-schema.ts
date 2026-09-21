// EC12 settings schema. Client sends a partial; the server validates/normalizes to this shape.
// Security and correctness invariants (workspace confinement, path policy) are NOT configurable.

export const MCP_REDACTED = '[redacted]';
export const DEFAULT_CUSTOM_MCP_LIMITS = {
  timeoutMs: 60000,
  maxFrameBytes: 4194304,
  stderrMaxChars: 8000,
  shutdownGraceMs: 1000,
  outputMaxChars: 12000,
  schemaMaxChars: 64000,
  maxTools: 0,
  maxDiscoveryPages: 0,
};
export type CustomMcpLimits = typeof DEFAULT_CUSTOM_MCP_LIMITS;
export interface CustomMcpServer {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command: string;
  args: string[];
  cwd: string;
  url: string;
  env: Record<string, string>;
  headers: Record<string, string>;
  limits: CustomMcpLimits;
}
export const CUSTOM_MCP_LIMIT_LABELS: Record<keyof CustomMcpLimits, string> = {
  timeoutMs: 'Request timeout (ms)',
  maxFrameBytes: 'Response / frame budget (bytes)',
  stderrMaxChars: 'Stderr buffer (characters)',
  shutdownGraceMs: 'Shutdown grace (ms; 0 = wait until exit)',
  outputMaxChars: 'Tool output budget (characters)',
  schemaMaxChars: 'Discovery schema budget (characters)',
  maxTools: 'Discovered tool count',
  maxDiscoveryPages: 'Discovery page count',
};

export type ModelSelection = 'auto' | 'pinned';
export type Mode = 'ask' | 'plan' | 'code';
export type ReasoningReplay = 'auto' | 'none' | 'active-batch' | 'tool-turns' | 'full';

export interface ContextToolLimits {
  mcpTimeoutMs: number;
  codegraphTimeoutMs: number;
  toolOutputMaxChars: number;
  readFileMaxChars: number;
  shellOutputMaxChars: number;
  searchOutputMaxChars: number;
  historyToolFull: number;
  historyToolChars: number;
  historyToolCallChars: number;
  webTimeoutMs: number;
  context7TimeoutMs: number;
}

export const DEFAULT_CONTEXT_TOOL_LIMITS: ContextToolLimits = {
  mcpTimeoutMs: 60000, codegraphTimeoutMs: 120000, toolOutputMaxChars: 12000,
  readFileMaxChars: 24000, shellOutputMaxChars: 8000, searchOutputMaxChars: 16000,
  historyToolFull: 5, historyToolChars: 500, historyToolCallChars: 200,
  webTimeoutMs: 15000, context7TimeoutMs: 30000,
};

export interface ProviderSettings {
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  modelSelection: ModelSelection;
  maxTokens: number;
  temperature: number;
  contextWindow: number;
  connectTimeoutMs: number;
  firstTokenTimeoutMs: number;
  streamIdleTimeoutMs: number;
  requestTimeoutMs: number;
  retries: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  currency: string;
  autoCompact: boolean;
  autoCompactAtPercent: number;
  keepRecentTurns: number;
  autoModelLimits: boolean;
  reasoningReplay: ReasoningReplay;
  costSaver: boolean;
  saverTurnBudget: number;
}

export interface AgentSettings {
  maxIterations: number;      // 0 = unlimited (intentional; unchanged)
  stageMaxIterations: number; // 0 = unlimited
  reviewBeforeApply: boolean;
  autoAcceptChanges: boolean; // when reviewBeforeApply=false, still journal + show diff
  repeatedFailureLimit: number;
  stageRepairAttempts: number; // bounded repair re-runs after a failed stage (0 = none)
  /** v1.13: re-requests for a turn killed by a retryable provider/protocol error (0 = off). */
  turnRecoveryAttempts: number;
  /** v1.13: consecutive turns where EVERY tool call failed before blocking (0 = off).
   * Unlimited iterations are intentional: any successful tool call resets this counter. */
  noProgressTurnLimit: number;
  /** v1.28: times a stuck run is handed its block info and allowed to continue.
   * v1.29: 0 = unlimited recoveries — a stall never stops the run (only Stop,
   * an answer, or the iteration budget ends it). */
  blockRecoveryAttempts: number;
  maxRequestAttempts: number;
  duplicateObservationLimit: number;
  outputContinuationLimit: number;
  stageOutputContinuationLimit: number;
  protocolRecoveryAttempts: number;
}

export interface AutoPromptSettings { enabled: boolean; stages: string[] }
export interface ContextToolSettings extends ContextToolLimits { rtk: boolean; ponytail: boolean; context7: boolean; codegraph: boolean; search: boolean; skills: boolean; context7ApiKey: string }

export interface EC12Settings {
  provider: ProviderSettings;
  agent: AgentSettings;
  autoPrompt: AutoPromptSettings;
  contextTools: ContextToolSettings;
  workspace: { id: string; path: string };
  mode: Mode;
  theme: string;
  recentModels: string[];
  hiddenModels: string[];
  hideVariants: boolean;
}

export const DEFAULT_SETTINGS: EC12Settings = {
  provider: {
    preset: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: '',
    modelSelection: 'auto', maxTokens: 65536, temperature: 0.7,     contextWindow: 65536,
    connectTimeoutMs: 180000, firstTokenTimeoutMs: 300000, streamIdleTimeoutMs: 300000,
    requestTimeoutMs: 1800000, retries: 3, inputCostPer1M: 0, outputCostPer1M: 0, currency: '$',
    autoCompact: true, autoCompactAtPercent: 80, keepRecentTurns: 4, autoModelLimits: true, reasoningReplay: 'auto', costSaver: false, saverTurnBudget: 60,
  },
  agent: { maxIterations: 0, stageMaxIterations: 0, reviewBeforeApply: false, autoAcceptChanges: true, repeatedFailureLimit: 3, stageRepairAttempts: 1, turnRecoveryAttempts: 3, noProgressTurnLimit: 20, maxRequestAttempts: 4, duplicateObservationLimit: 20, outputContinuationLimit: 4, stageOutputContinuationLimit: 2, protocolRecoveryAttempts: 3, blockRecoveryAttempts: 0 },
  autoPrompt: { enabled: true, stages: ['review', 'completeness', 'senior_review'] },
  contextTools: { ...DEFAULT_CONTEXT_TOOL_LIMITS, rtk: false, ponytail: true, context7: false, codegraph: false, search: false, skills: true, context7ApiKey: '' },
  workspace: { id: '', path: '' },
  mode: 'code',
  theme: 'neon',
  recentModels: [],
  hiddenModels: [],
  hideVariants: false,
};

const int = (v: unknown, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && !v.trim())) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(Math.max(Math.floor(n), min), max);
};
const numf = (v: unknown, d: number, min = -1e9, max = 1e9) => {
  const n = Number(v); if (!Number.isFinite(n)) return d; return Math.min(Math.max(n, min), max);
};
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Normalize an untrusted partial into a valid EC12Settings. Unknown fields are ignored. */
export function normalizeSettings(input: any): EC12Settings {
  const s = input && typeof input === 'object' ? input : {};
  const p = s.provider && typeof s.provider === 'object' ? s.provider : {};
  const a = s.agent && typeof s.agent === 'object' ? s.agent : {};
  const ap = s.autoPrompt && typeof s.autoPrompt === 'object' ? s.autoPrompt : {};
  const ct = s.contextTools && typeof s.contextTools === 'object' ? s.contextTools : {};
  const ws = s.workspace && typeof s.workspace === 'object' ? s.workspace : {};
  const D = DEFAULT_SETTINGS;
  const modelSelection = p.modelSelection === 'pinned' ? 'pinned' : 'auto';
  const mode = ['ask', 'plan', 'code'].includes(s.mode) ? s.mode : 'code';
  return {
    provider: {
      preset: str(p.preset, D.provider.preset),
      baseUrl: str(p.baseUrl, D.provider.baseUrl),
      apiKey: str(p.apiKey, ''),
      model: str(p.model, ''),
      modelSelection,
      maxTokens: int(p.maxTokens, D.provider.maxTokens, 0),
      temperature: numf(p.temperature, D.provider.temperature, 0, 2),
      contextWindow: int(p.contextWindow, D.provider.contextWindow, 512),
      connectTimeoutMs: int(p.connectTimeoutMs, D.provider.connectTimeoutMs, 0, 600000),
      firstTokenTimeoutMs: int(p.firstTokenTimeoutMs, D.provider.firstTokenTimeoutMs, 0, 3600000),
      streamIdleTimeoutMs: int(p.streamIdleTimeoutMs, D.provider.streamIdleTimeoutMs, 0, 3600000),
      requestTimeoutMs: int(p.requestTimeoutMs, D.provider.requestTimeoutMs, 0, 7200000),
      retries: int(p.retries, D.provider.retries, 0, 10),
      inputCostPer1M: numf(p.inputCostPer1M, 0, 0),
      outputCostPer1M: numf(p.outputCostPer1M, 0, 0),
      currency: str(p.currency, '$').slice(0, 4),
      autoCompact: bool(p.autoCompact, true),
      autoCompactAtPercent: int(p.autoCompactAtPercent, D.provider.autoCompactAtPercent, 50, 95),
      keepRecentTurns: int(p.keepRecentTurns, D.provider.keepRecentTurns, 1, 20),
      autoModelLimits: bool(p.autoModelLimits, true),
      reasoningReplay: ['auto', 'none', 'active-batch', 'tool-turns', 'full'].includes(p.reasoningReplay) ? p.reasoningReplay : D.provider.reasoningReplay,
      costSaver: bool(p.costSaver, false),
      saverTurnBudget: int(p.saverTurnBudget, D.provider.saverTurnBudget, 0, 10000),
    },
    agent: {
      maxIterations: int(a.maxIterations, 0, 0),
      stageMaxIterations: int(a.stageMaxIterations, 0, 0),
      reviewBeforeApply: bool(a.reviewBeforeApply, false),
      autoAcceptChanges: bool(a.autoAcceptChanges, true),
      repeatedFailureLimit: int(a.repeatedFailureLimit, 3, 1, 50),
      stageRepairAttempts: int(a.stageRepairAttempts, 1, 0, 5),
      turnRecoveryAttempts: int(a.turnRecoveryAttempts, 3, 0, 10),
      noProgressTurnLimit: int(a.noProgressTurnLimit, 20),
      blockRecoveryAttempts: int(a.blockRecoveryAttempts, 0, 0, 10),
      maxRequestAttempts: int(a.maxRequestAttempts, 4, 1),
      duplicateObservationLimit: int(a.duplicateObservationLimit, 20),
      outputContinuationLimit: int(a.outputContinuationLimit, 4),
      stageOutputContinuationLimit: int(a.stageOutputContinuationLimit, 2),
      protocolRecoveryAttempts: int(a.protocolRecoveryAttempts, 3),
    },
    autoPrompt: {
      enabled: bool(ap.enabled, D.autoPrompt.enabled),
      stages: Array.isArray(ap.stages) ? ap.stages.filter((x: unknown): x is string => typeof x === 'string') : D.autoPrompt.stages,
    },
    contextTools: {
      rtk: bool(ct.rtk, false), ponytail: bool(ct.ponytail, true), context7: bool(ct.context7, false),
      codegraph: bool(ct.codegraph, false), search: bool(ct.search, false), skills: bool(ct.skills, true),
      context7ApiKey: str(ct.context7ApiKey, ''),
      mcpTimeoutMs: int(ct.mcpTimeoutMs, D.contextTools.mcpTimeoutMs),
      codegraphTimeoutMs: int(ct.codegraphTimeoutMs, D.contextTools.codegraphTimeoutMs),
      toolOutputMaxChars: int(ct.toolOutputMaxChars, D.contextTools.toolOutputMaxChars),
      readFileMaxChars: int(ct.readFileMaxChars, D.contextTools.readFileMaxChars),
      shellOutputMaxChars: int(ct.shellOutputMaxChars, D.contextTools.shellOutputMaxChars),
      searchOutputMaxChars: int(ct.searchOutputMaxChars, D.contextTools.searchOutputMaxChars),
      historyToolFull: int(ct.historyToolFull, D.contextTools.historyToolFull),
      historyToolChars: int(ct.historyToolChars, D.contextTools.historyToolChars),
      historyToolCallChars: int(ct.historyToolCallChars, D.contextTools.historyToolCallChars),
      webTimeoutMs: int(ct.webTimeoutMs, D.contextTools.webTimeoutMs),
      context7TimeoutMs: int(ct.context7TimeoutMs, D.contextTools.context7TimeoutMs),
    },
    workspace: { id: str(ws.id, ''), path: str(ws.path, '') },
    mode,
    theme: str(s.theme, 'neon'),
    recentModels: Array.isArray(s.recentModels) ? s.recentModels.filter((x: unknown): x is string => typeof x === 'string').slice(0, 20) : [],
    hiddenModels: Array.isArray(s.hiddenModels) ? s.hiddenModels.filter((x: unknown): x is string => typeof x === 'string') : [],
    hideVariants: bool(s.hideVariants, false),
  };
}
