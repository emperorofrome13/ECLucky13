'use client';
import { useEffect, useRef, useState } from 'react';

interface Line { kind: 'cmd' | 'out' | 'err' | 'meta'; text: string }
interface TerminalState { lines: Line[]; history: string[]; cmd: string; busy: boolean }
const terminals = new Map<string, TerminalState>();
const listeners = new Set<() => void>();
function terminal(workspaceId: string): TerminalState {
  let state = terminals.get(workspaceId);
  if (!state) {
    state = { lines: [{ kind: 'meta', text: 'PowerShell in your workspace. Commands use your OS privileges. Output is kept until this page reloads; closing this panel does not stop a command.' }], history: [], cmd: '', busy: false };
    terminals.set(workspaceId, state);
  }
  return state;
}
function update(workspaceId: string, patch: Partial<TerminalState>) {
  terminals.set(workspaceId, { ...terminal(workspaceId), ...patch });
  listeners.forEach((notify) => notify());
}
function push(workspaceId: string, line: Line) { update(workspaceId, { lines: [...terminal(workspaceId).lines, line] }); }

export default function TerminalPanel(props: { workspaceId: string; onClose: () => void }) {
  const [, refresh] = useState(0);
  const [histIdx, setHistIdx] = useState(-1);
  const outRef = useRef<HTMLDivElement>(null);
  const state = terminal(props.workspaceId);
  useEffect(() => { const notify = () => refresh((n) => n + 1); listeners.add(notify); return () => { listeners.delete(notify); }; }, []);
  useEffect(() => { setHistIdx(-1); }, [props.workspaceId]);
  useEffect(() => { outRef.current?.scrollTo({ top: outRef.current.scrollHeight }); }, [state.lines]);

  const run = async () => {
    const id = props.workspaceId;
    const current = terminal(id);
    const command = current.cmd.trim();
    if (!command || current.busy || !id) return;
    update(id, { cmd: '', history: [command, ...current.history], busy: true });
    setHistIdx(-1);
    push(id, { kind: 'cmd', text: '$ ' + command });
    try {
      const response = await fetch('/api/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: id, command }) });
      const result = await response.json();
      if (result.output) push(id, { kind: result.commandOk ?? result.ok ? 'out' : 'err', text: result.output });
      if (result.error) push(id, { kind: 'err', text: result.error });
      const status = result.cancelled ? 'Cancelled by server' : result.timedOut ? 'Server command timeout' : result.exitCode != null ? `Exit ${result.exitCode}` : 'No exit code received';
      push(id, { kind: 'meta', text: status + (typeof result.durationMs === 'number' ? ` · ${result.durationMs} ms` : '') });
      if (result.reconciliation) push(id, { kind: result.reconciliation.ok ? 'meta' : 'err', text: result.reconciliation.ok ? `${result.workspaceChanges || 0} workspace file(s) reconciled${result.reconciliation.complete ? '' : `; incomplete snapshot (${result.reconciliation.skipped || 0} skipped)`}.` : 'Workspace reconciliation failed. Inspect changed files before continuing.' });
      if (!response.ok && !result.error) push(id, { kind: 'err', text: `Command request failed (HTTP ${response.status}).` });
    } catch (error) {
      push(id, { kind: 'err', text: `Command connection failed: ${error instanceof Error ? error.message : String(error)}. The command's final state is unknown; check before retrying.` });
    } finally { update(id, { busy: false }); }
  };

  return (
    <section className="bottom" aria-label="Manual terminal">
      <div className="bottom-head">
        <span className="bottom-tab active">Terminal</span>
        {state.busy && <span className="hint" role="status">Running; closing does not cancel</span>}
        <div className="spacer" />
        <button className="btn ghost sm" onClick={props.onClose} aria-label="Close terminal">Close</button>
      </div>
      <div className="term-out" ref={outRef} tabIndex={0} aria-label="Terminal output">
        {state.lines.map((line, i) => <div key={i} className={line.kind}>{line.text}</div>)}
      </div>
      <div className="term-in">
        <span className="prompt" aria-hidden="true">$</span>
        <input aria-label="PowerShell command" value={state.cmd} onChange={(e) => update(props.workspaceId, { cmd: e.target.value })} onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void run(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); const i = Math.min(histIdx + 1, state.history.length - 1); if (i >= 0) { setHistIdx(i); update(props.workspaceId, { cmd: state.history[i] }); } }
          else if (e.key === 'ArrowDown') { e.preventDefault(); const i = Math.max(-1, histIdx - 1); setHistIdx(i); update(props.workspaceId, { cmd: i >= 0 ? state.history[i] : '' }); }
        }} placeholder={!props.workspaceId ? 'Choose a workspace first' : state.busy ? 'Running…' : 'Type a command and press Enter'} disabled={state.busy || !props.workspaceId} />
        <button className="btn sm" onClick={run} disabled={state.busy || !props.workspaceId || !state.cmd.trim()}>Run</button>
      </div>
    </section>
  );
}
