'use client';
import { useState } from 'react';
import type { UIAttachment } from './AttachmentList';

export interface TaskRun {
  id: string; sessionId: string; workspaceId: string; workspacePath?: string;
  task?: string; state: string; createdAt: string; finalText?: string;
  configuredModel?: string; attachmentIds?: string[]; attachments?: UIAttachment[];
}
export const isActiveTask = (state: string) => ['queued', 'preparing', 'generating', 'executing_tool', 'compacting', 'verifying', 'reviewing', 'cancelling'].includes(state);

export default function TaskBoard(props: { runs: TaskRun[]; selected: string; error: string; busy: boolean; onClose: () => void; onRefresh: () => void; onOpen: (run: TaskRun) => void; onNew: () => void; onStop: (run: TaskRun) => Promise<void> }) {
  const [filter, setFilter] = useState('');
  const [stopping, setStopping] = useState('');
  const matches = props.runs.filter((r) => `${r.task} ${r.workspacePath} ${r.state}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="task-board" aria-label="Background tasks">
    <div className="panel-head"><b>Background tasks</b><button className="btn sm" onClick={props.onClose}>Close tasks</button><button className="btn sm" onClick={props.onRefresh} disabled={props.busy}>Refresh tasks</button></div>
    <p className="hint">Tasks continue on the server when you switch chats or close this browser. Same workspace: queued in order. Other workspaces: parallel.</p>
    <button className="btn primary" onClick={props.onNew}>New independent task</button>
    <label htmlFor="task-filter">Find task or workspace</label><input id="task-filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
    {props.error && <p role="alert">{props.error}</p>}
    {props.busy && !props.runs.length && <p role="status">Loading tasks…</p>}
    {!props.busy && !matches.length && <p className="hint">No tasks found. Start an independent task above.</p>}
    {matches.map((run) => <article className={'task-card' + (run.id === props.selected ? ' active' : '')} key={run.id}>
      <b>{run.task || 'Untitled task'}</b><span className="badge">{run.state}</span><p className="hint">{run.workspacePath || run.workspaceId}</p>
      <button className="btn sm" onClick={() => props.onOpen(run)}>Open task</button>
      {isActiveTask(run.state) && <button className="btn danger sm" disabled={stopping === run.id || run.state === 'cancelling'} onClick={async () => { setStopping(run.id); try { await props.onStop(run); } finally { setStopping(''); } }}>{stopping === run.id ? 'Stopping…' : run.state === 'queued' ? 'Cancel queued task' : 'Stop task'}</button>}
    </article>)}
  </section>;
}
