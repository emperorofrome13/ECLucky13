'use client';
// EC12 UI: server-owned runs + events, explorer, CodeMirror editor, terminal, settings drawer with a
// searchable model picker. Status, activity, diffs, verification, stages, tokens/cost, modes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, normalizeSettings, type EC12Settings, type Mode } from '@/shared/settings-schema';
import { STAGE_DEFS } from '@/shared/stage-definitions';
import type { ChangeRecord, RunSummary, TokenUsage } from '@/shared/contracts';
import { zeroUsage, isTerminal } from '@/shared/contracts';
import { lineDiff } from '@/shared/diff';
import SettingsDrawer from './SettingsDrawer';
import FileTree from './FileTree';
import CodeEditor from './CodeEditor';
import TerminalPanel from './TerminalPanel';
import MessageContent, { CopyButton } from './MessageContent';
import AttachmentList, { recordAttachments, type UIAttachment } from './AttachmentList';
import TaskBoard, { type TaskRun, isActiveTask } from './TaskBoard';
import LuckyPanel from './LuckyPanel';

export const APP_VERSION = '1.32';
const SKEY = 'eclucky13.settings.v1';

function newId(p: string) { return p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
interface Activity { id: string; toolCallId: string; name: string; argsPreview: string; startedAt: number; done?: boolean; ok?: boolean; durationMs?: number; preview?: string; exitCode?: number | null; artifactId?: string; downloadUrl?: string; processArtifactId?: string; processArtifactUrl?: string; stage?: string }
interface VRow { checkId: string; name: string; status: string; exitCode?: number | null; preview?: string }
interface HistoryRow { id: string; task?: string; state: string; outcome?: string; finalText?: string; createdAt: string; attachments?: UIAttachment[]; attachmentIds?: string[] }
interface StageBuffer { label: string; assistant: string; reasoning: string }
interface SessionItem { id: string; title: string; pinned: boolean; updatedAt: string; turnCount: number; originalTask: string; workspaceId: string; workspacePath: string }

export default function Ec12App() {
  const [settings, setSettings] = useState<EC12Settings>(DEFAULT_SETTINGS);
  const [sessionId, setSessionId] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftW, setLeftW] = useState(260);
  const [rightW, setRightW] = useState(340);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const paletteRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [stageBuffers, setStageBuffers] = useState<Record<string, StageBuffer>>({});
  const [usageKnown, setUsageKnown] = useState(false);
  const [usageIncomplete, setUsageIncomplete] = useState(false);
  const [contextScope, setContextScope] = useState('main');
  const [selectedChange, setSelectedChange] = useState('');
  const [diffError, setDiffError] = useState('');
  const [answerBusy, setAnswerBusy] = useState(false);
  const [agentTab, setAgentTab] = useState<'activity' | 'plan' | 'autoprompts'>('activity');
  const dragRef = useRef<{ which: 'left' | 'right'; startX: number; startW: number } | null>(null);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('eclucky13.panels.v1') || '{}');
      if (typeof raw.leftW === 'number') setLeftW(Math.min(520, Math.max(160, raw.leftW)));
      if (typeof raw.rightW === 'number') setRightW(Math.min(640, Math.max(280, raw.rightW)));
    } catch { /* ignore */ }
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);

  const [models, setModels] = useState<string[]>([]);
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, { ctx?: number; maxOut?: number; inPrice?: number; outPrice?: number; desc?: string }>>({});
  const [modelsBusy, setModelsBusy] = useState(false);
  const [integrations, setIntegrations] = useState<Record<string, any>>({});

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [task, setTask] = useState('');
  const [attachments, setAttachments] = useState<UIAttachment[]>([]);
  const [currentAttachments, setCurrentAttachments] = useState<UIAttachment[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadCount = useRef(0);
  const draftRef = useRef<Record<string, { task: string; attachments: UIAttachment[] }>>({});
  const [tasksOpen, setTasksOpen] = useState(false);
  const [allRuns, setAllRuns] = useState<TaskRun[]>([]);
  const [tasksError, setTasksError] = useState('');
  const [tasksBusy, setTasksBusy] = useState(false);
  const tasksRequest = useRef(0);
  const [branch, setBranch] = useState<{ id: string; task: string; retry: boolean } | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
interface RequestRow { eventId: string; requestId: string; at: number; messageCount: number; toolCount: number; maxTokens?: number; payloadBytes: number; payloadKey: string; stage?: string; status: 'running' | 'ok' | 'failed' | 'cancelled'; durationMs?: number; usage?: TokenUsage }
  const [requests, setRequests] = useState<RequestRow[]>([]);
  // Streamed text is buffered and flushed to React at most 4x/sec. A long run emits
  // tens of thousands of deltas; a setState per delta re-rendered the whole app per
  // token chunk and jammed the main thread for the life of the run.
  const pendingText = useRef<{ assistant: string; reasoning: string; stages: Record<string, StageBuffer> } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingText = useCallback(() => {
    const p = pendingText.current;
    pendingText.current = null;
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    if (!p) return;
    if (p.assistant) setAssistant((a) => a + p.assistant);
    if (p.reasoning) setReasoning((r) => (r + p.reasoning).slice(-12000));
    const keys = Object.keys(p.stages);
    if (keys.length) setStageBuffers((buffers) => {
      const next = { ...buffers };
      for (const k of keys) {
        const v = p.stages[k];
        const prev = next[k] || { label: v.label, assistant: '', reasoning: '' };
        next[k] = { label: v.label || prev.label, assistant: prev.assistant + v.assistant, reasoning: prev.reasoning + v.reasoning };
      }
      return next;
    });
  }, []);
  const scheduleTextFlush = useCallback(() => {
    if (!flushTimer.current) flushTimer.current = setTimeout(() => { flushTimer.current = null; flushPendingText(); }, 250);
  }, [flushPendingText]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const loadAllRuns = useCallback(async () => {
    const request = ++tasksRequest.current;
    setTasksBusy(true);
    try {
      const records: TaskRun[] = [];
      let before = '';
      do {
        const r = await fetch('/api/runs?limit=1000' + (before ? '&before=' + encodeURIComponent(before) : ''));
        const d = await r.json();
        if (request !== tasksRequest.current) return;
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not refresh background tasks. Retry Refresh tasks.');
        records.push(...(d.runs || []));
        const next = d.nextBefore || '';
        if (next === before) break;
        before = next;
      } while (before);
      setAllRuns(records); setTasksError('');
    } catch (e) { if (request === tasksRequest.current) setTasksError(e instanceof Error ? e.message : 'Task refresh failed.'); }
    finally { if (request === tasksRequest.current) setTasksBusy(false); }
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await loadAllRuns(); if (!disposed) timer = setTimeout(poll, 3000); };
    void poll();
    return () => { disposed = true; clearTimeout(timer); tasksRequest.current++; };
  }, [hydrated, loadAllRuns]);
  useEffect(() => {
    if (!workspaceOpen && !branch) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = workspaceOpen ? workspaceRef.current : branchRef.current;
    dialog?.querySelector<HTMLElement>('input, textarea, select')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !branchBusy) { e.preventDefault(); setWorkspaceOpen(false); setBranch(null); }
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'));
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [workspaceOpen, !!branch, branchBusy]);
  const [currentTask, setCurrentTask] = useState('');
  const sending = useRef(false);
  const [question, setQuestion] = useState<{ question: string; options?: string[] } | null>(null);
  const [answer, setAnswer] = useState('');
  const [plan, setPlan] = useState<string[]>([]);
  const [contextUsage, setContextUsage] = useState<{ usedTokens: number; contextWindow: number; maxTokens: number; autoCompactAtPercent?: number; autoCompactAtTokens?: number; estimated?: boolean } | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [sessionSearch, setSessionSearch] = useState('');
  const [editingSessionId, setEditingSessionId] = useState('');
  const [deleteSessionId, setDeleteSessionId] = useState('');
  const [sessionDeleteBusy, setSessionDeleteBusy] = useState(false);
  const [deletedSession, setDeletedSession] = useState<{ id: string; title: string } | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState('');
  const [compactionNotice, setCompactionNotice] = useState('');
  const [runId, setRunId] = useState('');
  const [runState, setRunState] = useState('idle');
  const [runDetail, setRunDetail] = useState('');
  const [configuredModel, setConfiguredModel] = useState('');
  const [effectiveModel, setEffectiveModel] = useState('');
  const [assistant, setAssistant] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [activity, setActivity] = useState<Activity[]>([]);
  const [feedLimit, setFeedLimit] = useState(60);
  const [atBottom, setAtBottom] = useState(true);
  const inspRef = useRef<HTMLElement | null>(null);
  const [inspAtBottom, setInspAtBottom] = useState(true);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [verification, setVerification] = useState<VRow[]>([]);
  const [stages, setStages] = useState<Array<{ stage: string; passed: boolean; summary: string }>>([]);
  const [usage, setUsage] = useState<TokenUsage>(zeroUsage());
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState('');
  const [browseBusy, setBrowseBusy] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyBefore, setHistoryBefore] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequest = useRef(0);

  const loadHistory = useCallback(async (sid: string, before?: string) => {
    const request = ++historyRequest.current;
    if (!sid) { setHistory([]); setHistoryBefore(null); return; }
    setHistoryBusy(true); setHistoryError('');
    try {
      const r = await fetch(`/api/runs?sessionId=${encodeURIComponent(sid)}&limit=20${before ? '&before=' + encodeURIComponent(before) : ''}`);
      const d = await r.json();
      if (request !== historyRequest.current || sid !== sessionIdRef.current) return;
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not load history.');
      const page: HistoryRow[] = (Array.isArray(d.runs) ? d.runs : []).map((x: any) => ({
        id: x.id, task: x.task, state: x.state, outcome: x.summary?.outcome || x.state,
        finalText: x.finalText, createdAt: x.createdAt, attachments: recordAttachments(x), attachmentIds: x.attachmentIds,
      }));
      setHistory((old) => Array.from(new Map([...old, ...page].map((x) => [x.id, x])).values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      setHistoryBefore((old) => before || !old ? d.nextBefore || null : old);
    } catch (e) { if (request === historyRequest.current && sid === sessionIdRef.current) setHistoryError(e instanceof Error ? e.message : 'Could not load history.'); }
    finally { if (request === historyRequest.current && sid === sessionIdRef.current) setHistoryBusy(false); }
  }, []);
  const sessionSearchRequest = useRef(0);
  const loadSessions = useCallback(async (query = sessionSearch) => {
    const request = ++sessionSearchRequest.current;
    // Global list across workspaces: switching folders must never hide sessions.
    try {
      const r = await fetch(`/api/sessions?q=${encodeURIComponent(query)}`);
      const d = await r.json(); if (d.ok && request === sessionSearchRequest.current) setSessions(d.sessions || []);
    } catch { setError('Could not load saved sessions.'); }
  }, [sessionSearch]);
  useEffect(() => { if (hydrated) void loadSessions(); }, [hydrated, loadSessions]);
  // Sessions grouped by workspace (current first) for the sidebar.
  const groupedSessions = useMemo(() => {
    const byWs = new Map<string, { id: string; path: string; items: SessionItem[] }>();
    for (const s of sessions) {
      const key = s.workspaceId || 'unknown';
      let g = byWs.get(key);
      if (!g) { g = { id: key, path: s.workspacePath || key, items: [] }; byWs.set(key, g); }
      g.items.push(s);
    }
    const groups = [...byWs.values()];
    groups.sort((a, b) => (a.id === settings.workspace.id ? -1 : b.id === settings.workspace.id ? 1 : b.items[0].updatedAt.localeCompare(a.items[0].updatedAt)));
    return groups;
  }, [sessions, settings.workspace.id]);
  const wsShort = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [activePath, setActivePath] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const fileLoads = useRef<Record<string, number>>({});
  const [view, setView] = useState<'agent' | 'editor'>('agent');
  const contentRef = useRef(contents); contentRef.current = contents;
  const fileRevisions = useRef<Record<string, number>>({});
  const fileEpoch = useRef(0);
  const savesInFlight = useRef(new Set<string>());

  const feedRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const lastSeq = useRef(0);
  const seen = useRef<Set<string>>(new Set());
  const startedAt = useRef(0);
  const runIdRef = useRef('');
  const [now, setNow] = useState(Date.now());
  const [providerPhase, setProviderPhase] = useState<'idle' | 'waiting' | 'generating'>('idle');
  const phaseAt = useRef(0);

  useEffect(() => {
    let s = DEFAULT_SETTINGS;
    let sid = newId('ses');
    try {
      s = normalizeSettings(JSON.parse(localStorage.getItem(SKEY) || '{}'));
      sid = localStorage.getItem('eclucky13.session') || sid;
    } catch { setError('Browser settings could not be read. Using fresh ECLucky13 defaults.'); }
    setSettings(s); setSessionId(sid); sessionIdRef.current = sid; setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SKEY, JSON.stringify({ ...settings, provider: { ...settings.provider, apiKey: '' }, contextTools: { ...settings.contextTools, context7ApiKey: '' } })); } catch { /* ignore */ }
  }, [settings, hydrated]);
  useEffect(() => { if (hydrated) document.documentElement.setAttribute('data-theme', settings.theme); }, [settings.theme, hydrated]);
  useEffect(() => { if (hydrated && sessionId) loadHistory(sessionId); }, [sessionId, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionIdRef = useRef(sessionId); sessionIdRef.current = sessionId;

  const modelRequest = useRef(0);
  const loadModels = useCallback(async (baseUrl: string, apiKey: string, quiet = false) => {
    const request = ++modelRequest.current;
    if (!quiet) setModelsBusy(true);
    try {
      const r = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, apiKey }) });
      const d = await r.json();
      if (request !== modelRequest.current) return;
      if (!d.ok) throw new Error(d.error);
      setModels(d.models || []); setLoadedModels(d.loaded || []); setCatalog(d.catalog || {});
      setSettings((s) => {
        if (s.provider.baseUrl !== baseUrl) return s;
        const model = s.provider.modelSelection === 'auto' && d.loaded?.length ? (d.loaded.includes(s.provider.model) ? s.provider.model : d.loaded[0]) : s.provider.model;
        const meta = d.catalog?.[model];
        return { ...s, provider: { ...s.provider, model, ...(s.provider.autoModelLimits && meta?.ctx ? { contextWindow: meta.ctx, maxTokens: meta.maxOut || meta.ctx } : {}) } };
      });
    } catch { if (!quiet) setError('Could not load models. Check the server URL and refresh the list.'); } finally { if (request === modelRequest.current) setModelsBusy(false); }
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await loadModels(settings.provider.baseUrl, settings.provider.apiKey, true);
      if (!stopped) timer = setTimeout(refresh, 10000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); modelRequest.current++; };
  }, [hydrated, settings.provider.baseUrl, settings.provider.apiKey, loadModels]);
  useEffect(() => { if (hydrated) fetch('/api/integrations?workspaceId=' + encodeURIComponent(settings.workspace.id)).then((r) => r.json()).then((d) => setIntegrations(d)).catch(() => setError('Could not check integration status.')); }, [hydrated, settings.workspace.id, settingsOpen]);

  const handleEvent = useCallback((e: any) => {
    if (!e || typeof e !== 'object' || !runIdRef.current || e.runId !== runIdRef.current || e.sessionId !== sessionIdRef.current) return;
    if (seen.current.has(e.eventId)) return;
    seen.current.add(e.eventId);
    lastSeq.current = Math.max(lastSeq.current, e.sequence || 0);
    const d = e.data || {};
    const stageKey = d.phase === 'stage' || d.stageId ? `${d.stageId || 'stage'}:${d.stageAttempt ?? 0}` : '';
    const queueStageDelta = (field: 'assistant' | 'reasoning', text: string) => {
      if (!text) return;
      const cur = pendingText.current || (pendingText.current = { assistant: '', reasoning: '', stages: {} });
      const b = cur.stages[stageKey] || (cur.stages[stageKey] = { label: `${d.stageId || 'Stage'}${d.stageAttempt ? ' · attempt ' + d.stageAttempt : ''}`, assistant: '', reasoning: '' });
      b[field] += text;
      scheduleTextFlush();
    };
    if (stageKey && ['assistant.delta', 'reasoning.delta'].includes(e.type)) {
      queueStageDelta(e.type === 'assistant.delta' ? 'assistant' : 'reasoning', d.text || '');
      return;
    }
    if (e.type === 'assistant.delta' || e.type === 'reasoning.delta') {
      const cur = pendingText.current || (pendingText.current = { assistant: '', reasoning: '', stages: {} });
      if (e.type === 'assistant.delta') cur.assistant += (d.text || '');
      else cur.reasoning += (d.text || '');
      scheduleTextFlush();
      return;
    }
    // Buffered text always materializes before any structural update, so ordering is preserved.
    flushPendingText();
    switch (e.type) {
      case 'run.created': setCurrentTask(d.task || ''); break;
      case 'model.resolved': setEffectiveModel(d.model); break;
      case 'context.usage': setContextUsage(d); setContextScope(stageKey ? d.stageId || 'stage' : 'main'); break;
      case 'context.compacted': setCompactionNotice(`Compacted ${d.earlierTurns} earlier turns into a ${Number(d.summaryTokens || 0).toLocaleString()}-token summary.`); break;
      case 'plan.updated': setPlan(d.steps || []); break;
      case 'question.asked': setQuestion(d); break;
      case 'question.answered': setQuestion(null); setAnswer(''); break;
      case 'stage.started': setRunDetail('Reviewing: ' + d.label); break;
      case 'run.state': setRunState(d.state); if (d.detail) setRunDetail(d.detail); if (d.state === 'verifying') setRefreshKey((k) => k + 1); break;
      case 'request.started': case 'request_payload': {
        const requestId = typeof d.requestId === 'string' && d.requestId ? d.requestId : `payload:${e.eventId}`;
        const messages = Array.isArray(d.messages) ? d.messages : [];
        const tools = Array.isArray(d.tools) ? d.tools : [];
        setRequests((list) => list.some((r) => r.eventId === e.eventId) ? list : [...list, {
          eventId: e.eventId, requestId, at: Date.now(),
          messageCount: typeof d.messageCount === 'number' ? d.messageCount : messages.length,
          toolCount: typeof d.toolCount === 'number' ? d.toolCount : tools.length,
          maxTokens: typeof d.maxTokens === 'number' ? d.maxTokens : undefined,
          payloadBytes: typeof d.payloadBytes === 'number' ? d.payloadBytes : (messages.length ? JSON.stringify(d).length : 0),
          payloadKey: typeof d.payloadKey === 'string' ? d.payloadKey : '',
          stage: stageKey ? d.stageId || 'stage' : undefined,
          status: 'running' as const,
        }].slice(-200));
        break;
      }
      case 'request.finished': {
        if (d.usageStatus === 'unknown') setUsageIncomplete(true);
        const finishedId = typeof d.requestId === 'string' ? d.requestId : '';
        if (finishedId) setRequests((list) => list.map((r) => (r.requestId === finishedId && r.status === 'running') ? { ...r, status: d.cancelled ? 'cancelled' : d.completed === false ? 'failed' : 'ok', durationMs: Date.now() - r.at } : r));
        break;
      }
      case 'tool.started': setActivity((l) => [{ id: d.toolCallId, toolCallId: d.toolCallId, name: d.name, argsPreview: d.argsPreview, startedAt: Date.now(), stage: stageKey ? d.stageId || 'stage' : undefined }, ...l].slice(0, 500)); break;
      case 'tool.finished': setActivity((l) => l.map((a) => (a.toolCallId === d.toolCallId ? { ...a, done: true, ok: d.ok, durationMs: d.durationMs, preview: d.preview, exitCode: d.exitCode, artifactId: d.artifactId, downloadUrl: d.downloadUrl, processArtifactId: d.processArtifactId, processArtifactUrl: d.processArtifactUrl } : a))); break;
      case 'change.applied': case 'change.pending':
        setChanges((list) => [{ changeId: d.changeId, path: d.path, operation: d.operation, status: e.type === 'change.pending' ? 'pending' : 'applied' } as ChangeRecord, ...list.filter((c) => c.changeId !== d.changeId)]);
        setDiffs((m) => ({ ...m, [d.changeId]: d.diff })); setRefreshKey((k) => k + 1); break;
      case 'change.reverted': setChanges((l) => l.map((c) => (c.changeId === d.changeId ? { ...c, status: 'reverted' } : c))); setRefreshKey((k) => k + 1); break;
      case 'verification.check': setVerification((v) => [...v.filter((x) => x.checkId !== d.check.checkId), { ...d.check, preview: d.check.outputPreview }]); break;
      case 'stage.finished': setStages((s) => [...s.filter((x) => x.stage !== d.stage), { stage: d.stage, passed: d.passed, summary: d.summary }]); break;
      case 'usage': if (d.usage) { setUsageKnown(true); setUsage((u) => ({ promptTokens: u.promptTokens + (d.usage.promptTokens || 0), completionTokens: u.completionTokens + (d.usage.completionTokens || 0), totalTokens: u.totalTokens + (d.usage.totalTokens || 0), cachedTokens: (u.cachedTokens || 0) + (d.usage.cachedTokens || 0) })); const usageRequestId = typeof d.requestId === 'string' ? d.requestId : ''; const reported = { promptTokens: d.usage.promptTokens || 0, completionTokens: d.usage.completionTokens || 0, totalTokens: d.usage.totalTokens || 0, cachedTokens: d.usage.cachedTokens || 0 }; if (usageRequestId) setRequests((list) => list.map((r) => (r.requestId === usageRequestId && !r.usage ? { ...r, usage: reported } : r))); } break;
      case 'error': setError(d.message || 'error'); break;
      case 'provider.status':
        setProviderPhase((d.providerPhase || d.phase) === 'generating' ? 'generating' : 'waiting');
        phaseAt.current = Date.now();
        break;
      case 'run.finished': setSummary(d.summary); setRunState(d.summary?.outcome || 'finished'); setRefreshKey((k) => k + 1); setProviderPhase('idle'); setRunDetail(''); setQuestion(null); esRef.current?.close(); loadHistory(sessionIdRef.current); loadSessions(); break;
    }
  }, [settings.provider.autoCompactAtPercent, loadSessions, flushPendingText, scheduleTextFlush]);

  const subscribe = useCallback((id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/runs/${id}/events?after=${lastSeq.current}&compact=1`);
    es.onmessage = (m) => { if (runIdRef.current !== id || esRef.current !== es) return; try { handleEvent(JSON.parse(m.data)); } catch { setError('Could not read a run event. Reconnect to reload this run.'); } };
    esRef.current = es;
  }, [handleEvent]);
  useEffect(() => () => { esRef.current?.close(); if (flushTimer.current) clearTimeout(flushTimer.current); }, []);
  const runGeneration = useRef(0);
  const subscribeRef = useRef(subscribe); subscribeRef.current = subscribe;
  const suspendRun = () => {
    flushPendingText();
    runGeneration.current++;
    runIdRef.current = ''; setRunId('');
    esRef.current?.close(); esRef.current = null;
    lastSeq.current = 0; seen.current.clear();
  };
  useEffect(() => {
    if (!hydrated || !sessionId) return;
    try { localStorage.setItem('eclucky13.session', sessionId); } catch { setError('This browser could not save the selected session.'); }
    let disposed = false;
    const generation = runGeneration.current;
    fetch('/api/runs?sessionId=' + encodeURIComponent(sessionId) + '&limit=1').then((r) => r.json()).then((d) => {
      if (disposed || generation !== runGeneration.current || sending.current || sessionIdRef.current !== sessionId || runIdRef.current || !d.runs?.length) return;
      const latest = d.runs[0];
      setRunState(latest.state);
      // Reattach the live feed only when the latest run is still active. Replaying
      // a finished run's whole event log is pure cost (tens of thousands of events)
      // for a state history already shows; terminal runs need no subscription.
      if (isTerminal(latest.state)) return;
      setRunId(latest.id); runIdRef.current = latest.id;
      setCurrentTask(latest.task || ''); setCurrentAttachments(recordAttachments(latest)); setConfiguredModel(latest.configuredModel || '');
      startedAt.current = Date.parse(latest.createdAt); lastSeq.current = 0; seen.current.clear(); subscribeRef.current(latest.id);
    }).catch(() => { if (!disposed && generation === runGeneration.current) setError('Could not restore this session. Reload after the app reconnects.'); });
    return () => { disposed = true; };
  }, [hydrated, sessionId]);
  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    let busy = false;
    // Consecutive failed polls. One slow poll under load is normal (busy main
    // thread, GC pause) — the alarm only shows after a sustained outage, and a
    // single success clears it again.
    let misses = 0;
    let alarmed = false;
    const generation = runGeneration.current;
    const valid = () => !disposed && runIdRef.current === runId && generation === runGeneration.current;
    const refresh = async () => {
      if (!valid() || busy) return;
      busy = true;
      const sequence = lastSeq.current;
      try {
        const r = await fetch(`/api/runs/${runId}`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (!valid() || !d.ok || d.run?.id !== runId || sequence !== lastSeq.current) return;
        misses = 0;
        if (alarmed) { alarmed = false; setRunDetail(''); }
        setRunState(d.run.state);
        if (d.run.error) setRunDetail(d.run.error);
        if (d.run.summary) setSummary(d.run.summary);
      } catch {
        if (!valid()) return;
        misses++;
        if (misses >= 3 && !alarmed) {
          alarmed = true;
          setRunDetail('Connection lost — reconnecting. The task may still be running.');
        }
      }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [runId]);
  useEffect(() => { if (atBottom) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [assistant, stageBuffers, summary, question, atBottom]);
  // Inspector follows new stage/activity output while the user stays pinned to the
  // bottom; scrolling up pauses the follow (same contract as the chat feed).
  const onInspScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    setInspAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);
  useEffect(() => { if (inspAtBottom && inspRef.current) inspRef.current.scrollTo({ top: inspRef.current.scrollHeight }); }, [stageBuffers, activity, stages, requests, agentTab, inspAtBottom]);

  const browseNative = async () => {
    setBrowseBusy(true);
    try {
      const r = await fetch('/api/fs/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initial: settings.workspace.path }) });
      const d = await r.json();
      if (d.ok && d.path) {
        const rr = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: d.path }) });
        const dd = await rr.json();
        if (dd.ok && newSession()) { setSettings((s) => ({ ...s, workspace: { id: dd.workspace.id, path: dd.workspace.path } })); setWorkspaceOpen(false); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Folder selection failed. Try browsing again.'); }
    finally { setBrowseBusy(false); }
  };

  const openFile = async (rel: string) => {
    if (!settings.workspace.id) return;
    setOpenPaths((p) => p.includes(rel) ? p : [...p, rel]);
    setActivePath(rel); setView('editor');
    if (contentRef.current[rel] !== undefined) return;
    const epoch = fileEpoch.current;
    const request = (fileLoads.current[rel] || 0) + 1;
    fileLoads.current[rel] = request;
    const valid = () => epoch === fileEpoch.current && request === fileLoads.current[rel];
    setFileLoading((s) => ({ ...s, [rel]: true })); setFileErrors((s) => ({ ...s, [rel]: '' }));
    try {
      const r = await fetch(`/api/files/${encodeURIComponent(settings.workspace.id)}?path=${encodeURIComponent(rel)}`);
      const d = await r.json();
      if (!valid()) return;
      if (!r.ok || !d.ok || typeof d.content !== 'string') throw new Error(d.error || 'Could not read this file. Retry opening it.');
      contentRef.current = { ...contentRef.current, [rel]: d.content };
      setContents((c) => ({ ...c, [rel]: d.content })); setHashes((h) => ({ ...h, [rel]: d.hash })); setDirty((dd) => ({ ...dd, [rel]: false }));
    } catch (e) { if (valid()) setFileErrors((s) => ({ ...s, [rel]: e instanceof Error ? e.message : 'File connection failed. Retry opening it.' })); }
    finally { if (valid()) setFileLoading((s) => ({ ...s, [rel]: false })); }
  };
  const closeTab = (rel: string) => {
    if (savesInFlight.current.has(rel)) { setError('Wait for this file to finish saving before closing it.'); return; }
    if (dirty[rel] && !window.confirm(`Close ${rel} without saving?`)) return;
    fileLoads.current[rel] = (fileLoads.current[rel] || 0) + 1;
    delete contentRef.current[rel];
    setOpenPaths((p) => p.filter((x) => x !== rel));
    setContents((c) => { const n = { ...c }; delete n[rel]; return n; });
    setHashes((h) => { const n = { ...h }; delete n[rel]; return n; });
    setDirty((dd) => { const n = { ...dd }; delete n[rel]; return n; });
    if (activePath === rel) {
      const rest = openPaths.filter((x) => x !== rel);
      if (rest.length) setActivePath(rest[rest.length - 1]);
      else { setActivePath(''); setView('agent'); }
    }
  };
  const save = async (rel: string) => {
    if (savesInFlight.current.has(rel) || contents[rel] === undefined) return;
    const epoch = fileEpoch.current;
    const revision = fileRevisions.current[rel] || 0;
    const savedContent = contentRef.current[rel];
    savesInFlight.current.add(rel);
    setSaving((s) => ({ ...s, [rel]: true }));
    try {
      const r = await fetch(`/api/files/${encodeURIComponent(settings.workspace.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel, content: savedContent, beforeHash: hashes[rel] }) });
      const d = await r.json();
      if (epoch !== fileEpoch.current || contentRef.current[rel] === undefined) return;
      if (!r.ok || !d.ok) throw new Error(d.error || 'Save failed.');
      const unchanged = revision === (fileRevisions.current[rel] || 0) && savedContent === contentRef.current[rel];
      setHashes((h) => ({ ...h, [rel]: d.hash })); setDirty((dd) => ({ ...dd, [rel]: !unchanged })); setSaveError((s) => ({ ...s, [rel]: '' })); setRefreshKey((k) => k + 1);
    } catch (e) {
      if (epoch === fileEpoch.current) { setSaveError((s) => ({ ...s, [rel]: e instanceof Error ? e.message : 'Could not save file.' })); setDirty((dd) => ({ ...dd, [rel]: true })); }
    } finally { if (epoch === fileEpoch.current) { savesInFlight.current.delete(rel); setSaving((s) => ({ ...s, [rel]: false })); } }
  };

  const send = async (override?: { task: string; sessionId: string; attachments: UIAttachment[] }) => {
    const text = override?.task ?? task;
    const files = override?.attachments ?? attachments;
    if (!text.trim() || sending.current || uploadCount.current || (!override && sessionBusy)) return;
    if (!settings.workspace.id) { setError('Choose a workspace folder first.'); return; }
    // Preserve the completed turn immediately. The server history refresh normally already has it,
    // but this prevents a visible blank chat if the user sends again before that fetch settles.
    if (runIdRef.current && currentTask) {
      const previous = {
        id: runIdRef.current, task: currentTask, state: runState,
        outcome: summary?.outcome || runState, finalText: assistant, attachments: currentAttachments,
        createdAt: new Date().toISOString(),
      };
      setHistory((list) => [...list.filter((item) => item.id !== previous.id), previous]);
    }
    suspendRun(); historyRequest.current++; setHistoryBusy(false);
    setStageBuffers({}); setUsageKnown(false); setUsageIncomplete(false); setContextUsage(null); setContextScope('main'); setEffectiveModel(''); setSelectedChange(''); setDiffError(''); setQuestion(null); setAnswer(''); setPlan([]);
    setError(''); setAssistant(''); setReasoning(''); setActivity([]); setChanges([]); setDiffs({}); setVerification([]); setStages([]); setUsage(zeroUsage()); setSummary(null);
    setCompactionNotice('');
    setRequests([]);
    setView('agent'); setCurrentTask(text); setCurrentAttachments(files); setRunState('queued'); setRunDetail('Submitting task'); sending.current = true;
    const generation = runGeneration.current;
    try {
    const sid = override?.sessionId || sessionIdRef.current || newId('ses');
    const body = { clientRequestId: newId('req'), sessionId: sid, workspaceId: settings.workspace.id, mode: settings.mode, task: text, attachmentIds: files.map((a) => a.id), settings: structuredClone(settings) };
    const r = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (generation !== runGeneration.current) { void loadAllRuns(); return; }
    if (!r.ok || !d.ok) { setRunState('failed'); setError(d.error || 'Could not start run.'); return; }
    setTask((draft) => draft === text ? '' : draft);
    setAttachments((items) => items.filter((a) => !files.some((sent) => sent.id === a.id)));
    void loadAllRuns();
    startedAt.current = Date.now(); lastSeq.current = 0; seen.current.clear();
    setProviderPhase('idle'); phaseAt.current = Date.now();
    if (d.sessionId && d.sessionId !== sid) { setSessionId(d.sessionId); sessionIdRef.current = d.sessionId; }
    setRunId(d.runId); runIdRef.current = d.runId; setConfiguredModel(settings.provider.model); subscribe(d.runId);
    setTimeout(() => { void loadSessions(); }, 0);
    } catch { setRunState('failed'); setError('Could not start the task. Check that the app server is running, then send again.'); } finally { sending.current = false; }
  };
  const stop = async () => {
    if (!runId) return;
    setRunDetail('Requesting stop…');
    try {
      const r = await fetch(`/api/runs/${runId}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Stop request failed.');
      setRunState('cancelling'); setRunDetail('Stopping the model and running tools…');
    } catch (e: any) { setError(`Could not stop the task: ${e.message}. The task may still be running; retry Stop.`); }
  };
  const resolveChange = async (id: string, action: 'revert') => {
    const generation = runGeneration.current;
    try {
      const r = await fetch(`/api/changes/${id}/${action}`, { method: 'POST' });
      const d = await r.json();
      if (generation !== runGeneration.current) return;
      if (!r.ok || !d.ok) throw new Error(d.error || 'Revert failed.');
      setChanges((l) => l.map((c) => c.changeId === id ? { ...c, status: 'reverted' } : c)); setRefreshKey((k) => k + 1);
    } catch (e) { if (generation === runGeneration.current) setError(e instanceof Error ? e.message : 'Could not revert the change.'); }
  };
  const resetSession = (sid: string, fromBranch = false): boolean => {
    if (sending.current || (branchBusy && !fromBranch)) { setError('Wait for the task submission to finish before switching.'); return false; }
    if (uploadCount.current) { setError('Wait for attachments to finish uploading before switching.'); return false; }
    if (savesInFlight.current.size) { setError('Wait for the file save to finish before switching.'); return false; }
    const dirtyFiles = Object.keys(dirty).filter((k) => dirty[k]);
    if (dirtyFiles.length && !window.confirm(`Discard unsaved changes in ${dirtyFiles.length} file(s)?`)) return false;
    draftRef.current[sessionIdRef.current] = { task, attachments };
    suspendRun(); historyRequest.current++; fileEpoch.current++; fileRevisions.current = {}; contentRef.current = {}; savesInFlight.current.clear();
    setHistory([]); setHistoryBefore(null); setHistoryBusy(false); setHistoryError(''); setError(''); setReasoning(''); setStageBuffers({}); setQuestion(null); setAnswer(''); setAnswerBusy(false); setPlan([]); setCurrentTask(''); setTask(''); setContextUsage(null); setContextScope('main'); setCompactionNotice(''); setSessionId(sid); sessionIdRef.current = sid; setRunState('idle'); setRunDetail(''); setProviderPhase('idle'); setConfiguredModel(''); setEffectiveModel(''); setAssistant(''); setActivity([]); setChanges([]); setDiffs({}); setSelectedChange(''); setDiffError(''); setVerification([]); setStages([]); setSummary(null); setUsage(zeroUsage()); setUsageKnown(false); setUsageIncomplete(false); setOpenPaths([]); setContents({}); setDirty({}); setHashes({}); setActivePath(''); setView('agent'); setSaving({}); setSaveError({}); setMentionOpen(false); setAtBottom(true); setInspAtBottom(true); setFeedLimit(60);
    const draft = draftRef.current[sid];
    setTask(draft?.task || ''); setAttachments(draft?.attachments || []); setCurrentAttachments([]); setUploadError('');
    setFileLoading({}); setFileErrors({}); fileLoads.current = {}; setRequests([]);
    return true;
  };
  const newSession = (): boolean => resetSession(newId('ses'));
  const openSavedSession = (item: SessionItem) => {
    if (item.id === sessionIdRef.current) return;
    // Opening a session from another workspace moves the whole UI there too,
    // so its files, runs and verification follow the chat.
    if (item.workspaceId && item.workspaceId !== settings.workspace.id && item.workspacePath) {
      setSettings((s) => ({ ...s, workspace: { id: item.workspaceId, path: item.workspacePath } }));
    }
    resetSession(item.id);
  };
  const patchSession = async (id: string, patch: Record<string, unknown>) => {
    const r = await fetch('/api/sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
    const d = await r.json(); if (!d.ok) { setError(d.error || 'Could not update session.'); return; } setEditingSessionId(''); await loadSessions();
  };
  const deleteChat = async (item: SessionItem) => {
    if (running || sessionDeleteBusy) return;
    if (item.id === sessionId && Object.values(dirty).some(Boolean)) { setError('Save or revert your unsaved files before deleting the current chat.'); return; }
    setSessionDeleteBusy(true);
    try {
      const r = await fetch('/api/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Could not delete the session.');
      setDeleteSessionId(''); setDeletedSession({ id: item.id, title: item.title });
      if (item.id === sessionId) { newSession(); setView('agent'); setActivePath(''); }
      await loadSessions();
    } catch (e: any) { setError(e.message || 'Could not delete the session. Try again.'); }
    finally { setSessionDeleteBusy(false); }
  };
  const undoDeleteChat = async () => {
    if (!deletedSession || sessionDeleteBusy) return;
    setSessionDeleteBusy(true);
    try {
      const r = await fetch('/api/sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deletedSession.id, restore: true }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Could not restore the session.');
      setDeletedSession(null); await loadSessions();
    } catch (e: any) { setError(e.message || 'Could not restore the session. Try again.'); }
    finally { setSessionDeleteBusy(false); }
  };
  const compactNow = async () => {
    if (!sessionId || running) return;
    const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextWindow: contextUsage?.contextWindow || settings.provider.contextWindow, keepRecentTurns: settings.provider.keepRecentTurns }) });
    const d = await r.json(); setCompactionNotice(d.message || d.error || 'Compaction failed.'); if (d.compacted) setContextUsage((previous) => previous ? { ...previous, usedTokens: Math.max(0, previous.usedTokens - d.beforeTokens + d.afterTokens), maxTokens: Math.max(0, previous.maxTokens + d.beforeTokens - d.afterTokens), estimated: true } : previous); await loadHistory(sessionId); await loadSessions();
  };

  const running = isActiveTask(runState);
  const sessionBusy = running || allRuns.some((r) => r.sessionId === sessionId && isActiveTask(r.state));
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!settings.workspace.id) { setUploadError('Choose a workspace before attaching files.'); return; }
    uploadCount.current++; setUploadBusy(true); setUploadError('');
    const sid = sessionIdRef.current;
    try {
      const form = new FormData(); form.append('workspaceId', settings.workspace.id);
      files.forEach((file) => form.append('files', file));
      const r = await fetch('/api/attachments', { method: 'POST', body: form });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Upload failed. Choose the files again to retry.');
      if (sid === sessionIdRef.current) setAttachments((items) => [...items, ...d.attachments]);
    } catch (e) { if (sid === sessionIdRef.current) setUploadError(e instanceof Error ? e.message : 'Upload failed. Retry choosing the files.'); }
    finally { uploadCount.current--; setUploadBusy(uploadCount.current > 0); }
  };
  const openTask = (run: TaskRun) => {
    if (!resetSession(run.sessionId)) return;
    setSettings((s) => ({ ...s, workspace: { id: run.workspaceId, path: run.workspacePath || (s.workspace.id === run.workspaceId ? s.workspace.path : '') } }));
    setRunId(run.id); runIdRef.current = run.id; setRunState(run.state); setCurrentTask(run.task || '');
    setCurrentAttachments(recordAttachments(run)); setConfiguredModel(run.configuredModel || '');
    startedAt.current = Date.parse(run.createdAt); subscribeRef.current(run.id); setTasksOpen(false);
  };
  const stopTask = async (run: TaskRun) => {
    try {
      const r = await fetch(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not stop this task. Retry.');
      await loadAllRuns();
    } catch (e) { setTasksError(e instanceof Error ? e.message : 'Stop failed. Retry.'); }
  };
  const branchRun = async (id: string, text: string, retry = false) => {
    if (branchBusy || sending.current || uploadCount.current) return;
    if (savesInFlight.current.size || Object.values(dirty).some(Boolean)) { setError('Save or close unsaved files before branching.'); return; }
    const sid = sessionIdRef.current;
    setBranchBusy(true);
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sid)}/branch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: id, task: text, retry }) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not branch this run.');
      const files = (d.attachmentIds || []).map((aid: string) => currentAttachments.find((a) => a.id === aid) || history.flatMap((h) => recordAttachments(h)).find((a) => a.id === aid) || recordAttachments({ attachmentIds: [aid] })[0]);
      setBranch(null);
      resetSession(d.sessionId, true);
      setTask(d.task); setAttachments(files);
      await send({ task: d.task, sessionId: d.sessionId, attachments: files });
    } catch (e) { setError(e instanceof Error ? e.message : 'Branch failed. Original session was not changed.'); }
    finally { setBranchBusy(false); }
  };
  const cost = useMemo(() => (usage.promptTokens / 1e6) * (settings.provider.inputCostPer1M || 0) + (usage.completionTokens / 1e6) * (settings.provider.outputCostPer1M || 0), [usage, settings.provider]);
  const selectedRecord = changes.find((c) => c.changeId === selectedChange);
  const diffForSelected = selectedRecord ? diffs[selectedRecord.changeId] : undefined;
  const cols = `${settings.theme === 'lucky' ? '236px ' : ''}${leftOpen ? leftW + 'px 6px ' : ''}minmax(0,1fr)${inspectorOpen ? ' 6px ' + rightW + 'px' : ''}`;
  const selectChange = async (id: string) => {
    setSelectedChange(id); setDiffError('');
    const generation = runGeneration.current;
    try {
      const r = await fetch(`/api/changes/${encodeURIComponent(id)}`);
      const d = await r.json();
      if (generation !== runGeneration.current) return;
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not load this diff.');
      if (!d.change) throw new Error('The change record is missing.');
      const fullDiff = lineDiff(d.change.beforeText ?? '', d.change.afterText ?? '').map((line) => (line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text).join('\n');
      setDiffs((previous) => ({ ...previous, [id]: fullDiff }));
    } catch (e) { if (generation === runGeneration.current) setDiffError(e instanceof Error ? e.message : 'Could not load this diff.'); }
  };
  const reusePrompt = (text: string) => {
    setTask((draft) => draft.trim() ? draft + '\n\n' + text : text);
    composerRef.current?.focus();
  };
  const insertMention = (path: string) => {
    const text = `@${JSON.stringify(path)}\nRead the workspace-relative file ${JSON.stringify(path)} before answering.\n`;
    const input = composerRef.current;
    const start = input?.selectionStart ?? task.length;
    const end = input?.selectionEnd ?? start;
    setTask((draft) => draft.slice(0, start) + text + draft.slice(end));
    setMentionOpen(false);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + text.length, start + text.length); });
  };
  const answerQuestion = async () => {
    if (!answer.trim() || answerBusy || !runIdRef.current) return;
    const id = runIdRef.current;
    setAnswerBusy(true);
    try {
      const r = await fetch(`/api/runs/${id}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) });
      const d = await r.json();
      if (runIdRef.current !== id) return;
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not send your answer.');
      setQuestion(null); setAnswer('');
    } catch (e) { if (runIdRef.current === id) setError(e instanceof Error ? e.message : 'Could not send your answer.'); }
    finally { if (runIdRef.current === id) setAnswerBusy(false); }
  };
  const paletteActions = [
    { label: 'New session', disabled: sending.current || branchBusy, action: () => newSession() },
    { label: 'Background tasks', action: () => { setTasksOpen(true); setView('agent'); } },
    { label: 'Sessions', action: () => { setLeftOpen(true); setSessionsOpen(true); void loadSessions(); } },
    { label: 'Files', action: () => { setLeftOpen(true); setSessionsOpen(false); } },
    { label: 'Settings', action: () => setSettingsOpen(true) },
    { label: 'Terminal', action: () => setBottomOpen((v) => !v) },
    { label: inspectorOpen ? 'Hide inspector' : 'Show inspector', action: () => setInspectorOpen((v) => !v) },
  ].filter((item) => item.label.toLowerCase().includes(paletteQuery.toLowerCase()));
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !settingsOpen && !workspaceOpen) {
        e.preventDefault(); setPaletteQuery(''); setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settingsOpen, workspaceOpen]);
  useEffect(() => {
    if (!paletteOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    paletteRef.current?.querySelector('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [paletteOpen]);
  // Ticking clock so elapsed/wait counters move while a run is active.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const elapsedSec = Math.max(0, Math.round((now - startedAt.current) / 1000));
  const waitingSec = providerPhase === 'waiting' && phaseAt.current ? Math.max(0, Math.round((now - phaseAt.current) / 1000)) : 0;
  const onDragStart = (which: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { which, startX: e.clientX, startW: which === 'left' ? leftW : rightW };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      if (d.which === 'left') setLeftW(Math.min(520, Math.max(160, d.startW + dx)));
      else setRightW(Math.min(640, Math.max(280, d.startW - dx)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragRef.current = null;
      try { localStorage.setItem('eclucky13.panels.v1', JSON.stringify({ leftW: leftWRef.current, rightW: rightWRef.current })); } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onKeyDownHandle = (which: 'left' | 'right') => (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const startW = which === 'left' ? leftW : rightW;
    const next = e.key === 'ArrowLeft'
      ? (which === 'left' ? Math.max(160, startW - 24) : Math.min(640, startW + 24))
      : (which === 'left' ? Math.min(520, startW + 24) : Math.max(280, startW - 24));
    if (which === 'left') setLeftW(next); else setRightW(next);
    try { localStorage.setItem('eclucky13.panels.v1', JSON.stringify({ leftW: which === 'left' ? next : leftW, rightW: which === 'right' ? next : rightW })); } catch { setError('Panel width could not be saved in this browser.'); }
  };
  const leftWRef = useRef(leftW); leftWRef.current = leftW;
  const rightWRef = useRef(rightW); rightWRef.current = rightW;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ECLucky13<small> v{APP_VERSION}</small></span>
        <button className={'chip click ws-chip' + (settings.workspace.path ? '' : ' unset')} onClick={() => { setWorkspacePath(settings.workspace.path); setWorkspaceOpen(true); }} title={settings.workspace.path || 'Choose a folder'}>
          <span className="folder-ico">&#128193;</span>{settings.workspace.path ? settings.workspace.path.split(/[\\/]/).filter(Boolean).pop() : (browseBusy ? 'browsing…' : 'Set workspace')}
        </button>
        <span className="chip">mode: <select value={settings.mode} onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as Mode }))} style={{ width: 'auto', marginLeft: 4, padding: '1px 4px' }}>
          <option value="ask">Ask</option><option value="plan">Plan</option><option value="code">Code</option></select></span>
        <span className="chip click" onClick={() => setSettingsOpen(true)}>{(running ? effectiveModel || settings.provider.model : settings.provider.model) || 'no model'}</span>
        <span className="chip" title="Current run, all stages and reported requests. Cost uses the input/output rates in Settings, not a billing receipt.">{usageKnown ? `Run tokens ↑${usage.promptTokens.toLocaleString()} ↓${usage.completionTokens.toLocaleString()}${(usage.cachedTokens || 0) > 0 ? ` (cached ${usage.cachedTokens.toLocaleString()})` : ''}${usageIncomplete ? ' (partial)' : ''} · estimated ${settings.provider.currency}${cost.toFixed(4)}` : 'Run usage / cost: unknown'}</span>
        <span className="spacer" />
        <span className="chip session-indicator" title="Whether your next prompt continues this chat or starts a fresh one">{history.length || currentTask ? `Same session · ${sessions.find((s) => s.id === sessionId)?.title || currentTask.slice(0, 42) || 'active chat'}` : 'New session'}</span>
        <button className="btn sm" aria-expanded={tasksOpen} onClick={() => { setTasksOpen((v) => !v); setView('agent'); }}>Tasks · {allRuns.filter((r) => isActiveTask(r.state)).length} active</button>
        <button className={'btn sm' + (bottomOpen ? ' primary' : '')} onClick={() => setBottomOpen((v) => !v)}>Terminal</button>
        <button className="btn sm" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((v) => !v)}>Inspector</button>
        <button className="btn sm" onClick={() => { setPaletteQuery(''); setPaletteOpen(true); }}>Commands · Ctrl+K</button>
        <button className="btn sm" onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>

      <div className={'statusbar' + (running ? ' busy' : runState !== 'idle' ? ' attention' : '')}>
        <span className={'dot ' + (running ? 'busy' : runState === 'idle' ? '' : runState === 'succeeded' ? 'on' : 'err')} />
        <b>{runState.toUpperCase()}</b>
        {runDetail && <span>· {runDetail}</span>}
        {effectiveModel && <span>· model {effectiveModel}{configuredModel && effectiveModel !== configuredModel ? ` (configured ${configuredModel})` : ''}</span>}
        {running && <span>· elapsed {elapsedSec}s</span>}
        {running && providerPhase === 'waiting' && <span>· waiting for first token {waitingSec}s</span>}
        {running && providerPhase === 'waiting' && waitingSec >= 60 && (
          <span className="chip" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }} title="The model server has not produced output for over a minute. A busy GPU is the usual cause.">model very slow — GPU may be busy</span>
        )}
        {settings.workspace.path && <span>· {settings.workspace.path}</span>}
      </div>

      <div className={"workbench" + (leftOpen ? " with-sidebar" : "")} style={{ gridTemplateColumns: cols }}>
        {settings.theme === 'lucky' && <LuckyPanel />}
        {leftOpen && <aside className="leftpanel" aria-label="Workspace sidebar">
          <div className="tp-bar" aria-hidden="true"><span className="gly">◆</span> Workspace<span className="grip" /></div>
          <div className="sidebar-tabs" role="tablist" aria-label="Workspace panels">
            <button className={'btn sm' + (sessionsOpen ? ' primary' : '')} role="tab" aria-selected={sessionsOpen} onClick={() => setSessionsOpen(true)}>Sessions</button>
            <button className={'btn sm' + (!sessionsOpen ? ' primary' : '')} role="tab" aria-selected={!sessionsOpen} onClick={() => setSessionsOpen(false)}>Files</button>
            <button className="btn sm" aria-label="Hide sidebar" onClick={() => setLeftOpen(false)}>Hide</button>
          </div>
          {sessionsOpen ? <section className="session-sidebar" role="tabpanel" aria-label="Sessions">
            <button className="btn primary" disabled={sending.current || branchBusy} onClick={newSession}>New session</button>
            {deletedSession && <div role="status" className="hint" style={{ margin: '10px 0' }}>Deleted {deletedSession.title}. <button className="btn sm" disabled={sessionDeleteBusy} onClick={undoDeleteChat}>Undo delete</button></div>}
            <p className="hint">{history.length || currentTask ? 'Same session: replies continue the selected chat.' : 'New session: your next message starts a chat.'}</p>
            <input aria-label="Search chats" value={sessionSearch} onChange={(e) => { setSessionSearch(e.target.value); }} placeholder="Search chats" />{sessions.length === 0 && <div className="hint">{sessionSearch ? 'No chats match your search.' : 'No saved chats yet.'}</div>}{groupedSessions.map((g) => <div key={g.id}>{groupedSessions.length > 1 && <div className="hint session-ws-head" title={g.path}>{wsShort(g.path)}{g.id === settings.workspace.id ? ' · current' : ''}</div>}{g.items.map((item) => <div className={'session-row' + (item.id === sessionId ? ' active' : '')} key={item.id}>{deleteSessionId === item.id ? <><b>Delete this session?</b><p className="hint">{item.title}<br />Project files are kept. You can undo this.</p><div className="session-actions"><button className="btn danger sm" disabled={running || sessionDeleteBusy} onClick={() => deleteChat(item)}>{sessionDeleteBusy ? 'Deleting…' : 'Delete chat'}</button><button className="btn sm" disabled={sessionDeleteBusy} onClick={() => setDeleteSessionId('')}>Cancel</button></div></> : editingSessionId === item.id ? <><input aria-label="Session title" value={editingSessionTitle} onChange={(e) => setEditingSessionTitle(e.target.value)} /><div className="session-actions"><button className="btn sm primary" onClick={() => patchSession(item.id, { title: editingSessionTitle })}>Save</button><button className="btn sm" onClick={() => setEditingSessionId('')}>Cancel</button></div></> : <><button className="session-open" disabled={sending.current || branchBusy} aria-current={item.id === sessionId ? 'page' : undefined} onClick={() => openSavedSession(item)}><b>{item.pinned ? '★ ' : ''}{item.title}</b><span>{item.turnCount} turn{item.turnCount === 1 ? '' : 's'} · {new Date(item.updatedAt).toLocaleString()}</span></button><div className="session-actions"><button className="btn sm" onClick={() => patchSession(item.id, { pinned: !item.pinned })}>{item.pinned ? 'Unpin' : 'Pin'}</button><button className="btn sm" onClick={() => { setEditingSessionId(item.id); setEditingSessionTitle(item.title); }}>Rename</button><button className="btn danger sm" disabled={running || sessionDeleteBusy} onClick={() => setDeleteSessionId(item.id)}>Delete</button></div></>}</div>)}</div>)}
          </section> : <FileTree workspaceId={settings.workspace.id} refreshKey={refreshKey} activePath={activePath} onOpen={openFile} />}
        </aside>}
        {leftOpen && <div className="drag-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize sidebar" aria-valuenow={leftW} aria-valuemin={160} aria-valuemax={520} onMouseDown={onDragStart('left')} onKeyDown={onKeyDownHandle('left')} title="drag to resize; ArrowLeft/Right adjust" />}
        <div className="main-col" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="tabs" role="tablist" aria-label="Chat and open files">
            <button role="tab" aria-selected={view === 'agent'} className={'tab' + (view === 'agent' ? ' active' : '')} onClick={() => setView('agent')} title="Agent replies live here">Chat</button>
            {openPaths.map((p) => (
              <div className="file-tab" key={p}>
                <button role="tab" aria-selected={view === 'editor' && activePath === p} className={'tab' + (view === 'editor' && activePath === p ? ' active' : '')} onClick={() => { setActivePath(p); setView('editor'); }} title={p}>{p.split(/[\\/]/).pop()}{dirty[p] ? ' •' : ''}</button>
                <button className="tab-close" aria-label={`Close ${p}`} title={`Close ${p}`} onClick={() => closeTab(p)}>×</button>
              </div>
            ))}
          </div>
          {view === 'editor' && activePath ? (
            <CodeEditor path={activePath} value={contents[activePath]} dirty={!!dirty[activePath]} saving={!!saving[activePath]} saveError={saveError[activePath]}
              loading={!!fileLoading[activePath]} loadError={fileErrors[activePath]} onRetry={() => void openFile(activePath)}
              onChange={(v) => { fileRevisions.current[activePath] = (fileRevisions.current[activePath] || 0) + 1; contentRef.current = { ...contentRef.current, [activePath]: v }; setContents((c) => ({ ...c, [activePath]: v })); setDirty((dd) => ({ ...dd, [activePath]: true })); }} onSave={() => save(activePath)} />
          ) : (
            <div className="agent-main" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="tp-bar" aria-hidden="true"><span className="gly">◆</span> Chat<span className="grip" /></div>
              <div className="agent-scroll" style={{ flex: 1, overflow: 'auto', padding: 16 }} ref={feedRef}
                onScroll={(e) => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); }}>
                {history.filter((h) => h.id !== runId).map((h) => (
                  <div key={h.id}>
                    {h.task && <div className="ev user" aria-label="Your message">{h.task}<div className="turn-actions"><button className="btn sm" onClick={() => reusePrompt(h.task!)}>Reuse prompt</button></div></div>}
                    <div className="ev assistant">
                      <div className="assistant-head"><span className="avatar" aria-hidden="true">EC</span><span className="tag">ECLucky13</span><span className={'badge ' + (h.outcome === 'succeeded' || h.outcome === 'verified' || h.state === 'succeeded' ? 'pass' : h.outcome === 'failed' || h.state === 'failed' ? 'fail' : '')}>{h.outcome || h.state}</span></div>
                      {h.finalText ? <MessageContent text={h.finalText} /> : '(This run did not record reply text.)'}
                      <AttachmentList attachments={recordAttachments(h)} />
                      <div className="turn-actions">{h.finalText ? <CopyButton text={h.finalText} /> : null}
                        <button className="btn sm" onClick={() => { setView('agent'); setBranch({ id: h.id, task: h.task || '', retry: true }); }}>Retry from here</button>
                        <button className="btn sm" onClick={() => { setView('agent'); setBranch({ id: h.id, task: h.task || '', retry: false }); }}>Edit & branch from before this turn</button>
                      </div>
                    </div>
                  </div>
                ))}
                {history.length === 0 && historyError && <div className="hint" style={{ padding: 8, color: 'var(--bad)' }}>{historyError}</div>}
                {historyBefore && <button className="btn sm" style={{ margin: '8px auto' }} disabled={historyBusy} onClick={() => { if (sessionId) void loadHistory(sessionId, historyBefore); }}>{historyBusy ? 'Loading…' : 'Load older messages'}</button>}
                {currentTask && <div className="ev user" aria-label="Your message">{currentTask}<AttachmentList attachments={currentAttachments} /></div>}
                {runState === 'waiting_for_approval' && <div className="ev"><b>Legacy paused run</b><p>Approval gates are no longer used. Re-run this task in a new session; the original record stays unchanged.</p><button className="btn" onClick={() => { const text = currentTask; const files = currentAttachments; if (newSession()) { setTask(text); setAttachments(files); void send({ task: text, sessionId: sessionIdRef.current, attachments: files }); } }}>Re-run without approval</button></div>}
                {error && <div className="ev error" role="alert"><span className="tag">error</span>{error}</div>}
                {question && <div className="ev assistant agent-question"><span className="tag">agent question</span><b>{question.question}</b><div>{question.options?.map((o) => <button className="btn sm" key={o} onClick={() => setAnswer(o)}>{o}</button>)}</div><input aria-label="Answer the agent" value={answer} onChange={(e) => setAnswer(e.target.value)} /><button className="btn primary" disabled={!answer.trim() || answerBusy} onClick={answerQuestion}>{answerBusy ? 'Sending…' : 'Answer and continue'}</button></div>}
                {assistant && <div className="ev assistant">
                  <div className="assistant-head"><span className="avatar" aria-hidden="true">EC</span><span className="tag">ECLucky13{effectiveModel ? ` · ${effectiveModel}` : ''}</span>{running && <span className="run-status" role="status"><span className="dot busy" aria-hidden="true" />{runDetail || (providerPhase === 'generating' ? 'Generating…' : 'Working…')}</span>}</div>
                  <MessageContent text={assistant} />
                  <div className="turn-actions"><CopyButton text={assistant} />{runId && <><button className="btn sm" onClick={() => { setView('agent'); setBranch({ id: runId, task: currentTask, retry: true }); }}>Retry from here</button><button className="btn sm" onClick={() => { setView('agent'); setBranch({ id: runId, task: currentTask, retry: false }); }}>Edit & branch from before this turn</button></>}</div>
                </div>}
                {reasoning && <details className="reasoning-panel"><summary className="hint">Model reasoning · {(reasoning.length / 1024).toFixed(1)}k chars · latest 6,000 retained</summary><div className="ev reasoning">{reasoning}</div></details>}
                {summary && (
                  <details className={'run-details ' + summary.outcome}>
                    <summary>Run details · {summary.outcome} · {summary.filesChanged.length} file(s)</summary>
                    <dl className="run-grid">
                      <div><dt>Outcome</dt><dd>{summary.outcome}</dd></div>
                      <div><dt>Model</dt><dd>{summary.model}</dd></div>
                      <div><dt>Files changed</dt><dd>{summary.filesChanged.length ? summary.filesChanged.join(', ') : '(none)'}</dd></div>
                      <div><dt>Checks</dt><dd>{summary.checks.length ? summary.checks.map((c) => `${c.name}=${c.status}${c.exitCode != null ? ' (exit ' + c.exitCode + ')' : ''}`).join(', ') : '(none executed)'}</dd></div>
                      <div><dt>Stages</dt><dd>{summary.stages.length ? summary.stages.map((s) => `${s.stage}=${s.passed ? 'PASS' : 'FAIL'}`).join(', ') : '(none)'}</dd></div>
                      {summary.remaining.length > 0 && <div><dt>Remaining</dt><dd>{summary.remaining.join('; ')}</dd></div>}
                    </dl>
                  </details>
                )}
                {!currentTask && !assistant && !summary && !Object.keys(stageBuffers).length && !activity.length && !history.length && <div className="empty"><h2>ECLucky13 // RELIABLE LOCAL CODER</h2><p>Set a workspace, pick a model, choose a mode, and send a task. Attach files by drag & drop, paste, or the paperclip. Tasks keep running when you switch chats; find them under Tasks.</p></div>}
              </div>
              {!atBottom && <button className="btn sm" style={{ margin: '8px auto' }} onClick={() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })}>Jump to latest</button>}
            </div>
          )}
        </div>

        {inspectorOpen && <div className="drag-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize inspector" aria-valuenow={rightW} aria-valuemin={280} aria-valuemax={640} onMouseDown={onDragStart('right')} onKeyDown={onKeyDownHandle('right')} title="drag to resize; ArrowLeft/Right adjust" />}
        <aside className={'agent-col compact-inspector' + (inspectorOpen ? '' : ' inspector-hidden')} aria-label="Agent inspector">
          <div className="agent-tabs" role="tablist" aria-label="Agent panels">
            {(['activity', 'plan', 'autoprompts'] as const).map((tab) => <button key={tab} role="tab" aria-selected={agentTab === tab} aria-controls={'agent-' + tab} className={'btn sm' + (agentTab === tab ? ' primary' : ' ghost')} onClick={() => setAgentTab(tab)}>{tab === 'autoprompts' ? 'Auto-prompts' : tab === 'plan' ? 'Plan' : 'Activity'}</button>)}
          </div>
          {agentTab === 'autoprompts' && <section id="agent-autoprompts" role="tabpanel" className="agent-tab-content" ref={inspRef} onScroll={onInspScroll}>
          <div className="panel-head"><span>Next-run pipeline</span>
            <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0 }} title={running ? 'The stage list is locked while a task runs; it applies to the next run.' : undefined}>
              <input type="checkbox" checked={settings.autoPrompt.enabled} disabled={running} onChange={(e) => setSettings((s) => ({ ...s, autoPrompt: { ...s.autoPrompt, enabled: e.target.checked } }))} style={{ width: 'auto', accentColor: 'var(--accent)' }} />
              on
            </label>
          </div>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
            {STAGE_DEFS.map((s) => {
              const on = settings.autoPrompt.stages.includes(s.id);
              return (
                <label key={s.id} style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0, color: 'inherit', cursor: 'pointer', padding: '3px 0' }} title={s.description}>
                  <input type="checkbox" checked={on} disabled={running} onChange={() => setSettings((prev) => ({ ...prev, autoPrompt: { ...prev.autoPrompt, stages: on ? prev.autoPrompt.stages.filter((x) => x !== s.id) : [...prev.autoPrompt.stages, s.id] } }))} style={{ width: 'auto', accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 14 }}>{s.label}</span>
                </label>
              );
            })}
            <div className="hint" style={{ marginTop: 4 }}>{running ? 'Stage list is locked while a task runs; changes apply to the next run.' : `${settings.autoPrompt.stages.length} of ${STAGE_DEFS.length} stages run after the main task, in order.`}</div>
          </div>
            {stages.length === 0 && Object.keys(stageBuffers).length === 0 && <p className="hint" style={{ padding: 10 }}>Stage results will appear here as the pipeline runs.</p>}
            {Object.entries(stageBuffers).map(([key, buffer]) => <div className="tool-card stage-card" key={key}><b>{buffer.label || key}</b><details open><summary className="hint">Stage reply</summary><MessageContent text={buffer.assistant || '(no stage output yet)'} /></details>{buffer.reasoning && <details><summary className="hint">Stage reasoning</summary><pre className="tool-out" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{buffer.reasoning.slice(-6000)}</pre></details>}</div>)}
            {stages.map((s) => <div className="tool-card" key={s.stage}><b>{s.stage} · {s.passed ? 'PASS' : 'FAIL'}</b><p>{s.summary}</p></div>)}
          </section>}
          {agentTab === 'plan' && <section id="agent-plan" role="tabpanel" className="agent-tab-content" ref={inspRef} onScroll={onInspScroll}>
          <div style={{ padding: 10 }}>
            <div className="hint" role="status">{contextUsage ? `Context scope: ${contextScope === 'main' ? 'main answer' : 'stage ' + contextScope} · ` : 'Context usage appears here when the run reports it. '}{contextUsage ? `${contextUsage.usedTokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens ${contextUsage.estimated === false ? '(provider reported)' : '(estimated, includes reasoning)'} · auto-compact at ${contextUsage.autoCompactAtPercent || settings.provider.autoCompactAtPercent}%` : 'Token counts are unknown until the run reports them. No fabricated zeros.'}</div>
            {contextUsage && <><progress aria-label="Context usage" value={contextUsage.usedTokens} max={contextUsage.contextWindow} style={{ width: '100%' }} /><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}><span className="hint">Available output: {contextUsage.maxTokens.toLocaleString()} tokens</span><button className="btn sm" onClick={compactNow} disabled={running || !sessionId}>Compact now</button></div>{compactionNotice && <div className="hint" style={{ color: 'var(--good)', marginTop: 5 }}>{compactionNotice}</div>}</>}
            {plan.length === 0 && <p className="hint">The agent’s plan appears here when it starts planning.</p>}{plan.length > 0 && <><b>Plan</b><ol>{plan.map((step, i) => <li key={i}>{step}</li>)}</ol></>}
          </div>
          </section>}
          {agentTab === 'activity' && <section id="agent-activity" role="tabpanel" className="agent-tab-content" ref={inspRef} onScroll={onInspScroll}>
          <div className="panel-head"><span>Activity</span><span className="hint">{activity.filter((a) => a.done).length}/{activity.length}</span></div>
          <div style={{ flex: 1 }}>
            {activity.length === 0 && <div className="hint">Tool calls appear here with duration and outcome.</div>}
            {activity.slice(0, feedLimit).map((a) => (
              <div className={'tool-card' + (a.done ? (a.ok ? ' ok' : ' bad') : '')} key={a.id}>
                <div className="tool-card-head"><b>{a.name}</b><span>{a.done ? `${a.durationMs ?? 0} ms${a.exitCode != null ? ` · exit ${a.exitCode}` : ''}` : 'running…'}</span></div>
                {a.argsPreview && <div className="hint mono">{a.argsPreview}</div>}
                {a.stage && <div className="hint">Stage: {a.stage}</div>}
                {a.preview && <pre className="tool-out">{a.preview}</pre>}
                {a.downloadUrl && <a className="btn sm" href={a.downloadUrl} download={a.artifactId ? `${a.artifactId}.jsonl` : undefined}>Download complete output</a>}
                {a.processArtifactUrl && a.processArtifactUrl !== a.downloadUrl && <a className="btn sm" href={a.processArtifactUrl} download={a.processArtifactId ? `${a.processArtifactId}.jsonl` : undefined}>Download complete process output</a>}
              </div>
            ))}
            {activity.length > feedLimit && <div className="hint" style={{ padding: 8 }}><button className="btn sm" onClick={() => setFeedLimit((n) => n + 100)}>show older ({activity.length - feedLimit} more)</button></div>}

            {requests.length > 0 && <div className="side-section-title" style={{ marginTop: 12 }}><span>Requests</span><span className="hint">{requests.length}</span></div>}
            {requests.map((r, i) => (
              <details className="request-row" key={r.eventId}>
                <summary><span className={'dot' + (r.status === 'running' ? ' busy' : r.status === 'ok' ? ' on' : ' err')} aria-hidden="true" /><span>Request {i + 1}</span><span className="hint">{r.messageCount} msgs{r.payloadBytes > 0 ? ` · ${(r.payloadBytes / 1024).toFixed(1)} KB` : ''}{r.durationMs != null ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ''}{r.usage ? ` · ↑${r.usage.promptTokens.toLocaleString()} ↓${r.usage.completionTokens.toLocaleString()}` : ''}</span><span className={'badge ' + (r.status === 'running' ? 'running' : r.status === 'ok' ? 'pass' : 'fail')}>{r.status}</span></summary>
                <div className="hint">Model messages: {r.messageCount} · tools offered: {r.toolCount}{r.maxTokens != null ? ` · max output: ${r.maxTokens.toLocaleString()} tokens` : ''}{r.stage ? ` · stage: ${r.stage}` : ''}{r.usage ? ` · reported ↑${r.usage.promptTokens.toLocaleString()} ↓${r.usage.completionTokens.toLocaleString()} (total ${r.usage.totalTokens.toLocaleString()})` : ' · usage not reported'}</div>
                {runId ? <a className="btn sm" href={`/api/runs/${runId}/requests/${r.payloadKey || r.eventId}`} download={`request-${i + 1}.json`}>Download payload</a> : null}
              </details>
            ))}

            {changes.length > 0 && <div className="side-section-title" style={{ marginTop: 12 }}><span>Changes</span></div>}
            {changes.map((c) => (
              <div className={'change-file' + (selectedChange === c.changeId ? ' active' : '')} key={c.changeId} onClick={() => void selectChange(c.changeId)}>
                <span className="cname">{c.path}<div className="hint">{c.operation} · <span className={'badge ' + (c.status === 'pending' ? 'running' : c.status === 'reverted' ? 'fail' : 'pass')}>{c.status}</span></div></span>
                <span style={{ display: 'flex', gap: 4 }}>
                  {c.status === 'pending' && <span className="hint">Legacy unapplied change</span>}
                  {c.status === 'applied' && <button className="btn danger sm" onClick={(e) => { e.stopPropagation(); resolveChange(c.changeId, 'revert'); }}>revert</button>}
                </span>
              </div>
            ))}

            {selectedChange && !changes.some((c) => c.changeId === selectedChange) && <div className="hint" style={{ padding: 8 }}>This change is no longer in the list.</div>}
            {selectedChange && diffError && <div className="hint" style={{ padding: 8, color: 'var(--bad)' }}>{diffError}</div>}
            {selectedChange && !diffError && diffForSelected !== undefined && <pre className="diff-preview" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto' }}>{diffForSelected.slice(0, 6000)}</pre>}
            {selectedChange && !diffError && diffForSelected === undefined && !diffs[selectedChange] && <div className="hint" style={{ padding: 8 }}>Loading diff…</div>}

            {verification.length > 0 && <div className="side-section-title" style={{ marginTop: 12 }}><span>Verification</span></div>}
            {verification.map((v) => <div className="tool-card hint" key={v.checkId} style={{ padding: '4px 10px' }}><span className={'badge ' + (v.status === 'passed' ? 'pass' : v.status === 'failed' ? 'fail' : '')}>{v.status}</span> <b>{v.name}</b>{v.preview ? <pre className="tool-out">{v.preview.slice(0, 4000)}</pre> : null}</div>)}
          </div>
          </section>}
        </aside>
      </div>

      <div className="tp-bar composer-title" aria-hidden="true"><span className="gly">◆</span> Message<span className="dim">— describe a code task</span><span className="grip" /></div>
      <div className={"composer-bar" + (dropActive ? " drop-active" : "")}
        onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => { e.preventDefault(); setDropActive(false); void uploadFiles(Array.from(e.dataTransfer.files)); }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files || []);
          if (files.length) { e.preventDefault(); void uploadFiles(files); }
        }}>
        {dropActive && <div className="drop-overlay" role="status">Drop files to attach</div>}
        {mentionOpen && <div className="mention-pop" role="dialog" aria-label="Insert a file mention">
          <div className="panel-head"><span>Insert a workspace file mention</span><button className="btn sm" onClick={() => setMentionOpen(false)}>Close</button></div>
          <FileTree workspaceId={settings.workspace.id} refreshKey={refreshKey} activePath="" onOpen={insertMention} />
          <p className="hint">Inserts the file’s relative path and asks the agent to read it.</p>
        </div>}
        <textarea ref={composerRef} value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); if (sessionBusy) { setError('This chat already has a task running. Start an independent task from the Tasks panel.'); return; } void send(); } }} placeholder={settings.workspace.id ? `Describe a ${settings.mode} task…` : 'Set a workspace first'} />
        {sessionBusy ? <button className="btn danger" onClick={stop}>Stop</button> : <button className="btn primary" onClick={() => void send()} disabled={!hydrated || !task.trim() || uploadBusy || sending.current}>Send</button>}
        <button className="btn" aria-label="Attach files" title="Attach images and text files (drag & drop or paste also work)" onClick={() => uploadRef.current?.click()} disabled={!settings.workspace.id || uploadBusy}>Attach…</button>
        <input ref={uploadRef} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { void uploadFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <button className="btn" onClick={() => setMentionOpen((v) => !v)} disabled={!settings.workspace.id}>@file</button>
      </div>
      {(attachments.length > 0 || uploadBusy || uploadError) && <div className="composer-attachments" aria-label="Draft attachments">
        {uploadBusy && <span className="hint" role="status">Uploading attachments…</span>}
        {uploadError && <span className="hint" role="alert">{uploadError}</span>}
        <AttachmentList attachments={attachments} onRemove={(id) => setAttachments((items) => items.filter((a) => a.id !== id))} />
      </div>}
      <div className="composer-meta">
        <span className="hint">{sessionBusy ? `Run ${runState} — press Stop to cancel; new prompts need the Tasks panel` : 'Enter sends · Shift+Enter newline · Ctrl+Enter also sends'}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => composerRef.current?.focus()}>Focus composer</button>
      </div>

      {paletteOpen && <div className="palette-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPaletteOpen(false); }}>
        <div className="command-palette" role="dialog" aria-label="Command palette" ref={paletteRef} style={{ width: 'min(520px, 92vw)', padding: 12, background: 'var(--panel)', border: '1px solid var(--line-bright)', borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,.45)' }}>
        <input aria-label="Search commands" value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} placeholder="Type a command…" onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Escape') { e.preventDefault(); setPaletteOpen(false); } if (e.key === 'Enter' && paletteActions[0]) { e.preventDefault(); paletteActions[0].action(); setPaletteOpen(false); } }} />
        <div role="list">{paletteActions.map((item) => <button role="listitem" key={item.label} disabled={item.disabled} onClick={() => { item.action(); setPaletteOpen(false); }}>{item.label}</button>)}</div>
        {paletteActions.length === 0 && <div className="hint">No command matches.</div>}
        </div>
      </div>}

      {bottomOpen && <TerminalPanel workspaceId={settings.workspace.id} onClose={() => setBottomOpen(false)} />}
      {tasksOpen && <TaskBoard onClose={() => setTasksOpen(false)} runs={allRuns} selected={runId} error={tasksError} busy={tasksBusy}
        onRefresh={() => void loadAllRuns()}
        onNew={() => { if (newSession()) { setTasksOpen(false); composerRef.current?.focus(); } }}
        onOpen={openTask}
        onStop={stopTask} />}
      {branch && <><div className="drawer-backdrop" onClick={() => { if (!branchBusy) setBranch(null); }} /><div className="drawer" role="dialog" aria-modal="true" aria-label="Branch this conversation" ref={branchRef}>
        <div className="drawer-head"><b>{branch.retry ? 'Retry this turn in a fresh session' : 'Edit the prompt, branch before this turn'}</b><button className="btn" disabled={branchBusy} onClick={() => setBranch(null)}>Cancel</button></div>
        <div className="drawer-body">
          {branchBusy && <p className="hint" role="status">Creating the branched session and starting the task…</p>}
          <label htmlFor="branch-task">Prompt for the branched session</label>
          <textarea id="branch-task" value={branch.task} disabled={branchBusy} style={{ minHeight: 90 }} onChange={(e) => setBranch({ ...branch, task: e.target.value })} placeholder={branch.retry ? branch.task : 'Leave unchanged to reuse the original prompt, or edit it'} />
          <p className="hint">{branch.retry ? 'Retries the same prompt in a new session. The original session is kept.' : 'The new session gets the conversation as it was before this turn.'}</p>
          <button className="btn primary" disabled={branchBusy || !branch.task.trim()} onClick={() => void branchRun(branch.id, branch.task, branch.retry)}>{branchBusy ? 'Branching…' : branch.retry ? 'Retry in new session' : 'Create branched session'}</button>
        </div>
      </div></>}
      {workspaceOpen && <><div className="drawer-backdrop" onClick={() => setWorkspaceOpen(false)} /><div className="drawer" role="dialog" aria-modal="true" aria-label="Choose workspace" ref={workspaceRef}><div className="drawer-head"><b>Choose workspace</b><button className="btn" onClick={() => setWorkspaceOpen(false)}>Cancel</button></div><div className="drawer-body"><label htmlFor="workspace-path">Project folder</label><input id="workspace-path" value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} placeholder="E:\projects\my-app" /><button className="btn" disabled={browseBusy} onClick={browseNative}>Browse…</button><button className="btn primary" disabled={!workspacePath.trim() || sending.current || branchBusy} onClick={async () => { try { const d = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: workspacePath }) }).then((r) => r.json()); if (!d.ok) { setError(d.error || 'Could not open folder.'); return; } if (!newSession()) return; setSettings((s) => ({ ...s, workspace: { id: d.workspace.id, path: d.workspace.path } })); setWorkspaceOpen(false); } catch { setError('Could not open the folder. Check the path and try again.'); } }}>Open folder</button></div></div></>}

      {settingsOpen && (
        <SettingsDrawer settings={settings} onChange={setSettings} models={models} loaded={loadedModels} catalog={catalog} modelsBusy={modelsBusy}
          onRefreshModels={() => loadModels(settings.provider.baseUrl, settings.provider.apiKey)} integrations={integrations} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

