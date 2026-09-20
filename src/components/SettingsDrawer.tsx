'use client';
// Settings: presets, base URL, server-stored credentials, model picker, integrations, limits (advanced).
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, DEFAULT_CONTEXT_TOOL_LIMITS, type EC12Settings, type ContextToolLimits } from '@/shared/settings-schema';
import type { ContextToolAction, ContextToolId, ContextToolRequest, ContextToolResponse, IntegrationStatus } from '@/shared/contexttools';
import ModelPicker, { type Catalog } from './ModelPicker';
import McpServersPanel from './McpServersPanel';
import AttachmentsSettings from './AttachmentsSettings';

const PRESETS = [
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { id: 'freetoken', label: 'FreeToken Desktop', baseUrl: 'http://127.0.0.1:1919/v1' },
  { id: 'unsloth', label: 'Unsloth Desktop', baseUrl: 'http://127.0.0.1:8000/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'magica', label: 'MagicAI', baseUrl: 'https://api.magica.ai/v1' },
  { id: 'custom', label: 'Custom (any OpenAI-compatible URL)', baseUrl: '' },
];

const CONTEXT_TOOLS = [
  { id: 'rtk', label: 'RTK (Rust Token Killer)', blurb: 'Rewrite supported shell commands through the installed RTK CLI.' },
  { id: 'ponytail', label: 'Ponytail MCP', blurb: 'Fetch the official lazy-senior-dev rules through the local Ponytail MCP server.' },
  { id: 'context7', label: 'Context7', blurb: 'Fetch current library docs before coding.' },
  { id: 'codegraph', label: 'Official CodeGraph MCP', blurb: 'Query a real semantic graph for definitions, callers, callees, and impact.' },
  { id: 'search', label: 'Web Search', blurb: 'Give the agent a web_search tool.' },
  { id: 'skills', label: 'Global Skills', blurb: 'Expose ~/.agents, ~/.codex, and ~/.claude skills through list_skills/read_skill.' },
] as const;

const CONTEXT7_ENDPOINT = 'https://mcp.context7.com/mcp';

const CONTEXT_LIMIT_LABELS: Record<keyof ContextToolLimits, string> = {
  mcpTimeoutMs: 'MCP timeout ms', codegraphTimeoutMs: 'CodeGraph timeout ms',
  toolOutputMaxChars: 'Tool output characters', readFileMaxChars: 'Read file characters',
  shellOutputMaxChars: 'Shell output characters', searchOutputMaxChars: 'Search output characters',
  historyToolFull: 'Recent tool outputs kept complete', historyToolChars: 'Characters kept per older tool output (0 = unlimited)',
  historyToolCallChars: 'Characters kept per older tool-call arguments (0 = unlimited)',
  webTimeoutMs: 'Web timeout ms', context7TimeoutMs: 'Context7 timeout ms',
};
const AGENT_LIMIT_LABELS = {
  maxRequestAttempts: 'Total request attempts per turn (minimum 1)',
  stageRepairAttempts: 'Stage repair reruns (0 = none)',
  duplicateObservationLimit: 'Duplicate observation limit (0 = off)',
  outputContinuationLimit: 'Main output continuations (0 = none)',
  stageOutputContinuationLimit: 'Stage output continuations (0 = none)',
  protocolRecoveryAttempts: 'Protocol recovery attempts (0 = none)',
} as const;

export default function SettingsDrawer(props: {
  settings: EC12Settings;
  onChange: (s: EC12Settings) => void;
  models: string[]; loaded: string[]; catalog: Record<string, any>; modelsBusy: boolean;
  onRefreshModels: () => void;
  integrations: IntegrationStatus;
  onClose: () => void;
}) {
  const { settings, onChange, models, loaded, catalog, modelsBusy, onRefreshModels, integrations, onClose } = props;
  const [apiKey, setApiKey] = useState('');
  const [context7Key, setContext7Key] = useState(settings.contextTools.context7ApiKey || '');
  const [keySaved, setKeySaved] = useState('');
  const [toolTests, setToolTests] = useState<Record<string, { busy?: boolean; ok?: boolean; message: string }>>({});
  const [tab, setTab] = useState<'server' | 'limits' | 'tools' | 'mcp' | 'prompt_studio' | 'about'>('server');
  const [advanced, setAdvanced] = useState(false);
  const prompts = usePromptStudio(settings.workspace.path);
  const [closeNotice, setCloseNotice] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const requestClose = () => {
    if (prompts.saving) { setCloseNotice('A prompt save is in progress. Wait for its result before closing.'); return; }
    if (prompts.dirty) { setCloseNotice('Prompt drafts have not been saved. Return to Prompt Studio to save them, or explicitly discard them.'); return; }
    onClose();
  };
  closeRef.current = requestClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (dialog && !dialog.contains(event.target as Node)) dialog.focus(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin); if (previous?.isConnected) previous.focus(); };
  }, []);

  const setP = (patch: Partial<EC12Settings['provider']>) => onChange({ ...settings, provider: { ...settings.provider, ...patch } });
  const setA = (patch: Partial<EC12Settings['agent']>) => onChange({ ...settings, agent: { ...settings.agent, ...patch } });

  const saveKey = async () => {
    const r = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: settings.provider.baseUrl, apiKey }) });
    const d = await r.json();
    if (d.ok) { setKeySaved('Key stored server-side (not saved in this browser).'); onChange({ ...settings, provider: { ...settings.provider, apiKey: '' } }); }
    else setKeySaved(d.error || 'save failed');
  };

  const saveContext7Key = async () => {
    setToolTests((s) => ({ ...s, context7: { busy: true, message: 'Saving key…' } }));
    try {
      const r = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: CONTEXT7_ENDPOINT, apiKey: context7Key }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'save failed');
      setContext7Key('');
      onChange({ ...settings, contextTools: { ...settings.contextTools, context7ApiKey: '' } });
      setToolTests((s) => ({ ...s, context7: { message: 'API key stored server-side. Not tested — use Test to verify it.' } }));
    } catch (e: any) {
      setToolTests((s) => ({ ...s, context7: { ok: false, message: String(e?.message || e) } }));
    }
  };

  const testContextTool = async (id: ContextToolId, action: ContextToolAction = 'test') => {
    if (toolTests[id]?.busy) return;
    if (action !== 'test' && (!settings.workspace.id || !integrations.details?.[id]?.actions?.includes(action))) return;
    setToolTests((s) => ({ ...s, [id]: { busy: true, message: action === 'test' ? 'Testing…' : action === 'index' ? 'Indexing…' : 'Refreshing index…' } }));
    try {
      const body: ContextToolRequest = { tool: id, action, workspaceId: settings.workspace.id, contextTools: settings.contextTools, ...(id === 'context7' ? { apiKey: context7Key } : {}) };
      const r = await fetch('/api/context-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d: ContextToolResponse = await r.json();
      const ok = r.ok && d.ok === true;
      const message = [d.output, d.error].filter((text): text is string => typeof text === 'string' && text.length > 0).join('\n') || (ok ? 'Ready.' : `Request failed (HTTP ${r.status}).`);
      setToolTests((s) => ({ ...s, [id]: { ok, message } }));
    } catch (e: any) {
      setToolTests((s) => ({ ...s, [id]: { ok: false, message: String(e?.message || e) } }));
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={requestClose} />
      <div className={'drawer wide' + (tab === 'prompt_studio' ? ' prompt-studio-drawer' : '')} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings">
        <div className="drawer-head settings-drawer-head">
          <span className="title">ECLucky13 v1.16 Settings</span>
          <div className="settings-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(['server', 'limits', 'tools', 'mcp', 'prompt_studio', 'about'] as const).map((t) => (
              <button key={t} className={'btn sm' + (tab === t ? ' primary' : ' ghost')} onClick={() => setTab(t)}>{t === 'prompt_studio' ? 'Prompt Studio' : t === 'mcp' ? 'MCP servers' : t}</button>
            ))}
            <button className="btn ghost sm" onClick={requestClose}>Close</button>
          </div>
        </div>
        <div className={'drawer-body' + (tab === 'prompt_studio' ? ' prompt-studio-body' : '')}>
          {tab === 'server' && (
            <>
              <fieldset>
                <legend>Backend preset</legend>
                <div className="field">
                  <select value={settings.provider.preset} onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); onChange({ ...settings, provider: { ...settings.provider, preset: e.target.value, modelSelection: 'auto', baseUrl: p?.baseUrl || settings.provider.baseUrl } }); }}>
                    {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Base URL</label>
                  <input value={settings.provider.baseUrl} onChange={(e) => setP({ baseUrl: e.target.value })} />
                </div>
                <div className="field">
                  <label>Model selection</label>
                  <select value={settings.provider.modelSelection} onChange={(e) => setP({ modelSelection: e.target.value as any })} style={{ width: 'auto' }}>
                    <option value="auto">Auto: use the loaded model (local providers)</option>
                    <option value="pinned">Pinned: use the selected model</option>
                  </select>
                  <div className="hint">Auto follows model changes in LM Studio or FreeToken. Pin a model only when you want to keep requesting it.</div>
                </div>
                <div className="field">
                  <label>API key (stored server-side)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="stored in data/credentials.json, not in this browser" />
                    <button className="btn sm" onClick={saveKey} disabled={!apiKey}>Save</button>
                  </div>
                  {keySaved && <div className="hint" style={{ color: 'var(--good)' }}>{keySaved}</div>}
                </div>
                <div className="field">
                  <label>Model</label>
                  <ModelPicker
                    value={settings.provider.model}
                    models={models} loaded={loaded} catalog={catalog}
                    recent={settings.recentModels} hidden={settings.hiddenModels} hideVariants={settings.hideVariants}
                    busy={modelsBusy}
                    onType={(v) => setP({ model: v })}
                    onRefresh={onRefreshModels}
                    onHide={(m) => onChange({ ...settings, hiddenModels: settings.hiddenModels.includes(m) ? settings.hiddenModels.filter((x) => x !== m) : [...settings.hiddenModels, m] })}
                    onToggleVariants={() => onChange({ ...settings, hideVariants: !settings.hideVariants })}
                    onPick={(m, meta) => {
                      const next: Partial<EC12Settings['provider']> = { model: m };
                      if (settings.provider.autoModelLimits && meta?.ctx) { next.contextWindow = meta.ctx; next.maxTokens = meta.maxOut || meta.ctx; }
                      if (meta?.inPrice !== undefined) next.inputCostPer1M = meta.inPrice;
                      if (meta?.outPrice !== undefined) next.outputCostPer1M = meta.outPrice;
                      const recent = [m, ...settings.recentModels.filter((x) => x !== m)].slice(0, 12);
                      onChange({ ...settings, provider: { ...settings.provider, ...next }, recentModels: recent });
                    }}
                  />
                  <div className="hint">{loaded.length ? 'Loaded: ' + loaded.join(', ') : models.length ? models.length + ' models, none loaded' : 'Load the model list from the server.'}</div>
                </div>
              </fieldset>
              <fieldset>
                <legend>Integrations (detected vs configured)</legend>
                <div className="hint">LM Studio: <b>{integrations.lmStudio ? 'detected' : 'not detected'}</b> · Browser: <b>{integrations.browser ? 'available' : 'missing (verification will be unavailable, not passed)'}</b> · RTK: <b>{integrations.rtk ? 'installed' : 'not installed'}</b> · Editor: <b>{integrations.editor || 'textarea'}</b></div>
                <div className="hint" style={{ marginTop: 6 }}>{integrations.note || ''}</div>
              </fieldset>
              <fieldset>
                <legend>Appearance</legend>
                <div className="field">
                  <label>Theme</label>
                  <select value={settings.theme} onChange={(e) => onChange({ ...settings, theme: e.target.value })}>
                    {['neon', 'amber', 'red', 'matrix', 'ice', 'mono'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </fieldset>
            </>
          )}
          {tab === 'limits' && (
            <fieldset>
              <legend>Limits &amp; compaction</legend><div className="hint">Local models run without inference or command timeouts. Press Stop to cancel.</div><label className="stage-toggle"><input type="checkbox" checked={settings.provider.autoModelLimits} onChange={(e) => setP({ autoModelLimits: e.target.checked })} /><span>Detect context and output budget from the loaded model</span></label>
              <label className="stage-toggle"><input type="checkbox" checked={settings.provider.autoCompact} onChange={(e) => setP({ autoCompact: e.target.checked })} /><span><span className="st-name">Automatically compact chat history</span><span className="st-blurb">Preserves the original task, plan, instructions, tool state, and recent tool results in a durable summary.</span></span></label>
              <label className="stage-toggle"><input type="checkbox" checked={settings.provider.costSaver} onChange={(e) => setP({ costSaver: e.target.checked })} /><span><span className="st-name">Cloud cost saver</span><span className="st-blurb">Economical history diet (2 recent tool results, short digests) plus a turn budget with graceful wrap-up, on every provider. Marks prompt-cache breakpoints on cloud requests and reports cached tokens in run usage. Never sent to local models. Savings appear on the provider invoice; turn it off if a provider rejects requests.</span></span></label>
              <div className="field"><label>Cost-saver turn budget (0 = no budget)</label><input type="number" min="0" max="10000" disabled={!settings.provider.costSaver} value={settings.provider.saverTurnBudget} onChange={(e) => setP({ saverTurnBudget: Number(e.target.value) })} /><div className="hint">Warns once at N turns (advisory only, never stops the run). Applies only while cost saver is on. Default 60.</div></div>
              <div className="field-grid"><div className="field"><label>Auto-compact at % of context</label><input type="number" min="50" max="95" disabled={!settings.provider.autoCompact} value={settings.provider.autoCompactAtPercent} onChange={(e) => setP({ autoCompactAtPercent: Number(e.target.value) })} /><div className="hint">Default 80%.</div></div><div className="field"><label>Keep recent turns</label><input type="number" min="1" max="20" disabled={!settings.provider.autoCompact} value={settings.provider.keepRecentTurns} onChange={(e) => setP({ keepRecentTurns: Number(e.target.value) })} /><div className="hint">Default 4 complete turns.</div></div></div>
              <label className="stage-toggle">
                <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                <span><span className="st-name">Show advanced limits</span><span className="st-blurb">Timeouts, budgets, retry counts. Correctness invariants are not configurable.</span></span>
              </label>
              {advanced && (
                <div className="field-grid">
                  <div className="field"><label>Max output tokens (0 → context)</label><input type="number" disabled={settings.provider.autoModelLimits} value={settings.provider.maxTokens} onChange={(e) => setP({ maxTokens: Number(e.target.value) })} /></div>
                  <div className="field"><label>Context window</label><input type="number" disabled={settings.provider.autoModelLimits} value={settings.provider.contextWindow} onChange={(e) => setP({ contextWindow: Number(e.target.value) })} /><div className="hint">Auto-filled from the selected model.</div></div>
                  <div className="field"><label>Remote connect timeout ms (0 = off)</label><input type="number" value={settings.provider.connectTimeoutMs} onChange={(e) => setP({ connectTimeoutMs: Number(e.target.value) })} /></div>
                  <div className="field"><label>Remote first-token timeout ms (0 = off)</label><input type="number" value={settings.provider.firstTokenTimeoutMs} onChange={(e) => setP({ firstTokenTimeoutMs: Number(e.target.value) })} /></div>
                  <div className="field"><label>Remote stream idle timeout ms (0 = off)</label><input type="number" value={settings.provider.streamIdleTimeoutMs} onChange={(e) => setP({ streamIdleTimeoutMs: Number(e.target.value) })} /></div>
                  <div className="field"><label>Remote total request timeout ms (0 = off)</label><input type="number" value={settings.provider.requestTimeoutMs} onChange={(e) => setP({ requestTimeoutMs: Number(e.target.value) })} /></div>
                  <div className="field"><label>Retries</label><input type="number" value={settings.provider.retries} onChange={(e) => setP({ retries: Number(e.target.value) })} /></div>
                  <div className="field"><label>Max agent iterations (0 = no limit)</label><input type="number" value={settings.agent.maxIterations} onChange={(e) => setA({ maxIterations: Number(e.target.value) })} /></div>
                  <div className="field"><label>Max iterations per stage (0 = no limit)</label><input type="number" value={settings.agent.stageMaxIterations} onChange={(e) => setA({ stageMaxIterations: Number(e.target.value) })} /></div>
                  <div className="field"><label>Repeated failure limit</label><input type="number" value={settings.agent.repeatedFailureLimit} onChange={(e) => setA({ repeatedFailureLimit: Number(e.target.value) })} /><div className="hint">Same tool failure N times → block with an explanation instead of looping.</div></div>
                  <div className="field"><label>Stream error retries per turn</label><input type="number" min="0" max="10" value={settings.agent.turnRecoveryAttempts} onChange={(e) => setA({ turnRecoveryAttempts: Number(e.target.value) })} /><div className="hint">Re-requests a turn after an empty/dropped response (0 = off). Unlimited iterations are unchanged.</div></div>
                  <div className="field"><label>No-progress turn guard</label><input type="number" min="0" value={settings.agent.noProgressTurnLimit} onChange={(e) => setA({ noProgressTurnLimit: Number(e.target.value) })} /><div className="hint">Blocks only after N consecutive turns where EVERY tool call failed (0 = off). Any success resets it, so real work is never cut.</div></div>
                  <div className="field"><label htmlFor="reasoning-replay">Reasoning replay</label><select id="reasoning-replay" value={settings.provider.reasoningReplay ?? 'auto'} onChange={(e) => setP({ reasoningReplay: e.target.value as EC12Settings['provider']['reasoningReplay'] })}>{(['auto', 'none', 'active-batch', 'tool-turns', 'full'] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select><div className="hint">Auto selects the provider policy. None omits replay; full preserves all reasoning in outgoing requests.</div></div>
                  {(Object.keys(AGENT_LIMIT_LABELS) as Array<keyof typeof AGENT_LIMIT_LABELS>).map((key) => <div className="field" key={key}><label htmlFor={'agent-' + key}>{AGENT_LIMIT_LABELS[key]}</label><input id={'agent-' + key} type="number" min={key === 'maxRequestAttempts' ? 1 : 0} value={settings.agent[key] ?? DEFAULT_SETTINGS.agent[key]} onChange={(e) => setA({ [key]: Number(e.target.value) })} />{key === 'maxRequestAttempts' && <div className="hint">One total budget, including the initial request and transport, stream, and protocol retries; retry limits do not multiply it.</div>}</div>)}
                  <div className="field"><label>Input price / 1M</label><input type="number" step="0.01" value={settings.provider.inputCostPer1M} onChange={(e) => setP({ inputCostPer1M: Number(e.target.value) })} /></div>
                  <div className="field"><label>Output price / 1M</label><input type="number" value={settings.provider.outputCostPer1M} onChange={(e) => setP({ outputCostPer1M: Number(e.target.value) })} /><div className="hint">Auto-filled from the provider catalog when available.</div></div>
                </div>
              )}
            </fieldset>
          )}
          {tab === 'tools' && (
            <fieldset>
              <legend>Context tools</legend>
              <div className="hint" style={{ marginBottom: 8 }}>Enabled tools are added to the model&apos;s tool schema and enforced by the server. Test runs the real integration.</div>
              {CONTEXT_TOOLS.map((t) => {
                const status = toolTests[t.id];
                // An integration that is not installed cannot be tested or used; say so where the
                // toggle is, rather than letting the model discover it mid-run.
                const missing: Record<string, string> = {
                  rtk: 'Not installed. Run: winget install rtk-ai.rtk',
                  ponytail: 'Not installed. Run: npm run install:mcp',
                  codegraph: 'Not installed. Run: npm run install:mcp',
                };
                const detail = integrations.details?.[t.id];
                const unavailable = (detail?.installed === false || integrations[t.id] === false) && !!missing[t.id];
                const readiness = status?.busy ? 'Working' : status?.ok === true ? 'Ready' : status?.ok === false ? 'Failed' : detail?.status === 'ready' ? 'Ready' : detail?.status === 'failed' ? 'Failed' : unavailable ? 'Not installed' : detail?.installed || integrations[t.id] === true ? 'Installed — not tested' : 'Not tested';
                return (
                  <div className="stage-toggle" key={t.id}>
                    <input aria-label={`Enable ${t.label}`} type="checkbox" disabled={unavailable} checked={!!(settings.contextTools as any)[t.id] && !unavailable} onChange={(e) => onChange({ ...settings, contextTools: { ...settings.contextTools, [t.id]: e.target.checked } })} />
                    <span style={{ flex: 1 }}>
                      <span className="st-name">{t.label}</span>
                      <span className="st-blurb">{t.blurb}</span>
                      {unavailable && <span className="st-blurb" style={{ color: 'var(--warn)' }}>{missing[t.id]}</span>}
                      <span className="st-blurb" role="status">{readiness}</span>
                      {(status?.message || detail?.output || detail?.error || detail?.message) && <span className="st-blurb context-tool-result" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{status?.message ?? [detail?.output, detail?.error, detail?.message].filter(Boolean).join('\n')}</span>}
                      {t.id === 'codegraph' && <span className="st-blurb">{!settings.workspace.id ? 'Open a workspace to index or refresh its graph.' : !detail?.actions?.includes('index') || !detail?.actions?.includes('refresh') ? 'Index and Refresh require backend support advertised by the integrations endpoint.' : 'Index creates the graph; Refresh updates it after file changes.'}</span>}
                    </span>
                    <div className="context-tool-actions"><button className="btn sm" disabled={status?.busy || (!settings.workspace.id && !['rtk', 'ponytail'].includes(t.id))} onClick={() => testContextTool(t.id)}>Test</button>{t.id === 'codegraph' && (['index', 'refresh'] as const).map((action) => <button className="btn sm" key={action} disabled={status?.busy || unavailable || !settings.workspace.id || !detail?.actions?.includes(action)} onClick={() => testContextTool('codegraph', action)}>{action === 'index' ? 'Index' : 'Refresh'}</button>)}</div>
                  </div>
                );
              })}
              <div className="field-grid context-tool-limits">{(Object.keys(CONTEXT_LIMIT_LABELS) as Array<keyof ContextToolLimits>).map((key) => <div className="field" key={key}><label htmlFor={'context-' + key}>{CONTEXT_LIMIT_LABELS[key]}</label><input id={'context-' + key} type="number" min="0" value={settings.contextTools[key] ?? DEFAULT_CONTEXT_TOOL_LIMITS[key]} onChange={(e) => onChange({ ...settings, contextTools: { ...settings.contextTools, [key]: Number(e.target.value) } })} /></div>)}</div>
              <div className="hint">0 requests unlimited output or no timeout where supported by the integration. Stop remains available.</div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Context7 API key (optional, stored server-side)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="password" value={context7Key} onChange={(e) => setContext7Key(e.target.value)} placeholder="Public access works without a key" />
                  <button className="btn sm" onClick={saveContext7Key} disabled={!context7Key || toolTests.context7?.busy}>Save key</button>
                </div>
              </div>
            </fieldset>
          )}
          {tab === 'limits' && <fieldset><legend>Attachments</legend><AttachmentsSettings /></fieldset>}
          {tab === 'mcp' && <McpServersPanel workspace={settings.workspace.path} />}
          {tab === 'prompt_studio' && (
            <PromptsTab studio={prompts} workspace={settings.workspace.path} />
          )}
          {tab === 'about' && (
            <fieldset>
              <legend>Permissions &amp; limits (honest)</legend>
              <div className="hint">
                Auto-applying file edits is not authorization for destructive operations. Project instructions and skills cannot override app permissions.
                Ask/Plan modes are read-only and cannot run shell commands. The change journal covers agent tool edits, editor saves, and reconciled shell effects — it is not a sandbox.
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Import from EC11</label>
                <button className="btn sm" onClick={async () => {
                  try {
                    const s = JSON.parse(localStorage.getItem('ec11.settings.v1') || 'null');
                    const ss = JSON.parse(localStorage.getItem('ec11.sessions.v1') || '[]');
                    if (!s && !ss.length) { setKeySaved('No EC11 data found in this browser.'); return; }
                    const r = await fetch('/api/migrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s || {}, sessions: ss }) });
                    const d = await r.json();
                    if (!d.ok) { setKeySaved(d.error || 'import failed'); return; }
                    onChange({ ...settings, provider: { ...settings.provider, preset: d.applied.provider?.preset || settings.provider.preset, baseUrl: d.applied.provider?.baseUrl || settings.provider.baseUrl, model: d.applied.provider?.model || settings.provider.model, maxTokens: d.applied.provider?.maxTokens ?? settings.provider.maxTokens, temperature: d.applied.provider?.temperature ?? settings.provider.temperature, contextWindow: d.applied.provider?.contextWindow ?? settings.provider.contextWindow }, theme: d.applied.theme || settings.theme, recentModels: d.applied.recentModels || [], hiddenModels: d.applied.hiddenModels || [], hideVariants: !!d.applied.hideVariants });
                    setKeySaved(`Imported ${d.importedSessions} session(s) as transcript text. EC11 data preserved. API keys are never imported — store them server-side.`);
                  } catch (e: any) { setKeySaved('import failed: ' + String(e?.message || e)); }
                }}>Import EC11 settings + sessions</button>
                {keySaved && <div className="hint" style={{ color: 'var(--good)' }}>{keySaved}</div>}
                <div className="hint" style={{ marginTop: 4 }}>Transcript text only; tool history and diffs are not reconstructed. Your EC11 keys are left untouched.</div>
              </div>
            </fieldset>
          )}
        </div>
        {closeNotice && <div className="settings-close-notice" role="alert"><p>{closeNotice}</p><button className="btn" onClick={() => { setTab('prompt_studio'); setCloseNotice(''); }}>Return to drafts</button><button className="btn danger" disabled={prompts.saving} onClick={onClose}>Discard drafts and close</button></div>}
        <div className="drawer-foot">
          <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>Settings edits apply next run; active task keeps its snapshot. General settings save automatically; prompts and MCP servers require Save. Credentials are stored server-side.</span>
          <button className="btn primary" onClick={requestClose}>Done</button>
        </div>
      </div>
    </>
  );
}

export interface PromptFile { name: string; label: string; content: string; source: string; writable: boolean }
export type PromptScope = 'app' | 'workspace';
export interface PromptDraft {
  text: string;
  savedText: string;
  scope: PromptScope;
  savedScope: PromptScope;
  revision: number;
  saving: boolean;
  status: string;
}
export interface PromptWorkspaceState {
  files: PromptFile[];
  drafts: Record<string, PromptDraft>;
  selected: string;
  loading: boolean;
  error: string;
  appRoot: string;
  appDir: string;
}

export function promptIsDirty(draft?: PromptDraft) {
  return !!draft && (draft.text !== draft.savedText || draft.scope !== draft.savedScope);
}

export function promptInitialScope(file: PromptFile): PromptScope {
  if (file.name === 'PROJECT_AGENTS.md') return 'workspace';
  if (file.name === 'AGENTS.md') return 'app';
  return file.source === 'workspace' ? 'workspace' : 'app';
}

const emptyPromptWorkspace = (): PromptWorkspaceState => ({ files: [], drafts: {}, selected: '', loading: true, error: '', appRoot: '', appDir: '' });

function usePromptStudio(workspace: string) {
  const [states, setStates] = useState<Record<string, PromptWorkspaceState>>({});
  const statesRef = useRef(states);
  const loadRequests = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  const update = (key: string, change: (state: PromptWorkspaceState) => PromptWorkspaceState) => {
    const next = { ...statesRef.current, [key]: change(statesRef.current[key] || emptyPromptWorkspace()) };
    statesRef.current = next;
    if (mounted.current) setStates(next);
  };
  const load = async (key: string) => {
    const request = (loadRequests.current[key] || 0) + 1;
    loadRequests.current[key] = request;
    update(key, (s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await fetch('/api/prompts?workspace=' + encodeURIComponent(key));
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.files)) throw new Error(data.error || 'Could not load prompt sources.');
      const files: PromptFile[] = data.files.filter((f: PromptFile) => f && typeof f.name === 'string' && typeof f.label === 'string' && typeof f.content === 'string' && typeof f.source === 'string' && typeof f.writable === 'boolean');
      if (files.length !== data.files.length) throw new Error('The server returned invalid prompt sources.');
      if (loadRequests.current[key] !== request) return;
      update(key, (s) => {
        const drafts = { ...s.drafts };
        for (const f of files) {
          if (drafts[f.name]) continue;
          const scope = promptInitialScope(f);
          drafts[f.name] = { text: f.content, savedText: f.content, scope, savedScope: scope, revision: 0, saving: false, status: '' };
        }
        return { ...s, files, drafts, selected: files.some((f) => f.name === s.selected) ? s.selected : files[0]?.name || '', loading: false, error: '', appRoot: String(data.appRoot || ''), appDir: String(data.appDir || '') };
      });
    } catch (error) {
      if (loadRequests.current[key] === request) update(key, (s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!statesRef.current[workspace] || statesRef.current[workspace].loading) void load(workspace); }, [workspace]);
  const dirty = Object.values(states).some((s) => Object.values(s.drafts).some(promptIsDirty));
  const saving = Object.values(states).some((s) => Object.values(s.drafts).some((d) => d.saving));
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);
  const state = states[workspace] || emptyPromptWorkspace();
  const edit = (patch: Partial<Pick<PromptDraft, 'text' | 'scope'>>) => update(workspace, (s) => {
    const file = s.files.find((f) => f.name === s.selected);
    const draft = s.drafts[s.selected];
    if (!file?.writable || !draft || s.loading || s.error) return s;
    if (patch.scope && (draft.saving || (patch.scope === 'workspace' && !workspace) || ['AGENTS.md', 'PROJECT_AGENTS.md'].includes(file.name))) return s;
    return { ...s, drafts: { ...s.drafts, [s.selected]: { ...draft, ...patch, revision: draft.revision + 1, status: draft.saving ? draft.status : '' } } };
  });
  const save = async () => {
    const key = workspace;
    const s = statesRef.current[key];
    const file = s?.files.find((f) => f.name === s.selected);
    const draft = s?.drafts[s.selected];
    if (!s || s.loading || s.error || !file?.writable || !draft || draft.saving || !promptIsDirty(draft) || (draft.scope === 'workspace' && !key)) return;
    const name = file.name;
    const snapshot = { ...draft };
    update(key, (current) => ({ ...current, drafts: { ...current.drafts, [name]: { ...current.drafts[name], saving: true, status: 'Saving prompt…' } } }));
    try {
      const res = await fetch('/api/prompts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content: snapshot.text, scope: snapshot.scope, workspace: key }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save prompt.');
      update(key, (current) => {
        const latest = current.drafts[name];
        const newer = latest.revision !== snapshot.revision;
        return { ...current, drafts: { ...current.drafts, [name]: { ...latest, savedText: snapshot.text, savedScope: snapshot.scope, saving: false, status: `Saved to ${data.file || snapshot.scope}. ${newer ? 'Newer edits are still in your draft; save again if changed.' : 'Takes effect on the next run.'}` } } };
      });
    } catch (error) {
      update(key, (current) => ({ ...current, drafts: { ...current.drafts, [name]: { ...current.drafts[name], saving: false, status: 'Save failed: ' + (error instanceof Error ? error.message : String(error)) } } }));
    }
  };
  return { state, dirty, saving, edit, save, reload: () => load(workspace), pick: (name: string) => update(workspace, (s) => s.files.some((f) => f.name === name) ? { ...s, selected: name } : s) };
}

function PromptsTab({ workspace, studio }: { workspace: string; studio: ReturnType<typeof usePromptStudio> }) {
  const { state, edit, save, pick } = studio;
  const { files, drafts, selected, loading, error } = state;
  const current = files.find((f) => f.name === selected);
  const draft = drafts[selected];
  const isStage = !!current && !['AGENTS.md', 'PROJECT_AGENTS.md'].includes(selected);
  const invalid = loading || !!error || !current || !draft || !current.writable || (draft.scope === 'workspace' && !workspace);
  const destination = selected === 'PROJECT_AGENTS.md' ? `${workspace}/AGENTS.md` : selected === 'AGENTS.md' ? `${state.appRoot || 'ECLucky13 app'}/AGENTS.md` : draft?.scope === 'workspace' ? `${workspace}/.ec12/autoprompts/${selected}.md` : `${state.appDir || 'ECLucky13 app/autoprompts'}/${selected}.md`;
  return (
    <div className="prompts-split">
      <div className="prompt-source-select-wrap"><label htmlFor="prompt-source-select">Prompt source</label><select id="prompt-source-select" className="prompt-source-select" value={selected} disabled={loading || !files.length} onChange={(e) => pick(e.target.value)}>{!files.length && <option value="">No prompt sources</option>}{files.map((f) => <option key={f.name} value={f.name}>{f.label}{promptIsDirty(drafts[f.name]) ? ' — unsaved' : ''}</option>)}</select></div>
      <div className="prompt-list" aria-label="Prompt sources">
        {files.map((f) => <button type="button" className={'prompt-item' + (f.name === selected ? ' active' : '')} key={f.name} disabled={loading} aria-pressed={f.name === selected} onClick={() => pick(f.name)} title={f.label}><span>{f.label}</span><span className="hint">Source: {f.source}{promptIsDirty(drafts[f.name]) ? ' · Unsaved draft' : ''}{!f.writable ? ' · Read-only' : ''}</span></button>)}
      </div>
      <div className="prompt-edit">
        {loading && <div role="status">Loading prompt sources…</div>}
        {error && <div role="alert">{error} <button className="btn sm" disabled={loading} onClick={studio.reload}>Retry loading</button></div>}
        {!loading && !error && !files.length && <div role="status">No prompt sources are available.</div>}
        <div className="prompt-edit-head">
          <span className="hint">{current?.label}</span><span className="spacer" />
          {isStage && <><label htmlFor="prompt-save-scope">Save destination</label><select id="prompt-save-scope" value={draft?.scope || ''} disabled={invalid || draft?.saving} onChange={(e) => edit({ scope: e.target.value as PromptScope })}><option value="app">ECLucky13 app (all projects)</option><option value="workspace" disabled={!workspace}>This workspace (.ec12)</option></select></>}
          <button className="btn primary sm" disabled={invalid || draft?.saving || !promptIsDirty(draft)} onClick={save}>{draft?.saving ? 'Saving prompt…' : 'Save prompt'}</button>
        </div>
        {current && <div className="hint prompt-save-destination">Loaded source: {current.source}. Save destination: {destination}{!current.writable ? ' · Read-only' : ''}</div>}
        <label htmlFor="prompt-content">Prompt text</label>
        <textarea id="prompt-content" className="prompt-textarea" disabled={invalid} value={draft?.text || ''} onChange={(e) => edit({ text: e.target.value })} spellCheck={false} aria-describedby="prompt-save-status" />
        <div id="prompt-save-status" className="hint" role="status">{draft?.status} {draft ? promptIsDirty(draft) ? 'Unsaved draft — use Save prompt to write this file.' : 'No unsaved changes.' : ''}</div>
        <div className="hint">Prompt files are saved manually. Review stages finish by calling report_verdict with verdict and summary; plain-text verdicts do not complete a stage.</div>
      </div>
    </div>
  );
}

