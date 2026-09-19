'use client';
// Bundled CodeMirror editor (no CDN). Saves go through /api/files/[id] (journaled, revertible);
// a save is not "successful" until the API confirms; conflicts keep the buffer dirty.
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { useMemo } from 'react';

export default function CodeEditor(props: {
  path: string; value?: string; onChange: (v: string) => void;
  onSave: () => void; dirty: boolean; saving: boolean; saveError?: string;
  loading?: boolean; loadError?: string; onRetry?: () => void; readOnly?: boolean;
}) {
  const loading = props.loading || props.value === undefined;
  const ready = !loading && !props.loadError;
  const lang = useMemo(() => {
    const ext = (props.path.split('.').pop() || '').toLowerCase();
    if (ext === 'json') return json();
    return javascript({ jsx: true, typescript: ext === 'ts' || ext === 'tsx' });
  }, [props.path]);

  return (
    <div className="editor-pane">
      <div className="editor-bar">
        <span className="path">{props.path}</span>
        {props.dirty && <span className="badge running">unsaved</span>}
        {props.saving && <span className="hint">saving…</span>}
        {props.saveError && <span className="badge fail">save failed — kept dirty</span>}
        <span className="spacer" />
        <button className="btn primary sm" onClick={() => { if (ready && !props.readOnly) props.onSave(); }} disabled={!ready || props.readOnly || !props.dirty || props.saving}>Save</button>
      </div>
      {props.loadError ? <div className="ev error" role="alert">Could not open {props.path}: {props.loadError}{props.onRetry && <button className="btn sm" onClick={props.onRetry}>Retry opening file</button>}</div> : loading ? <div className="hint" role="status">Loading {props.path}…</div> : <CodeMirror
        key={props.path}
        value={props.value}
        height="100%"
        theme="dark"
        extensions={[lang]}
        readOnly={props.readOnly || props.saving}
        onChange={(value) => { if (ready && !props.readOnly && !props.saving) props.onChange(value); }}
        aria-label={`Edit ${props.path}`}
        basicSetup={{ foldGutter: true, highlightActiveLine: true }}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', fontSize: 14 }}
      />}
      {props.saveError && <div className="ev error" style={{ margin: 8 }}><span className="tag">save error</span>{props.saveError}</div>}
    </div>
  );
}