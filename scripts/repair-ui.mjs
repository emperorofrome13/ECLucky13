import fs from 'node:fs';
const file='src/components/Ec12App.tsx';
let s=fs.readFileSync(file,'utf8');
const edit=(a,b)=>{if(!s.includes(a))throw Error('Missing '+a.slice(0,100));s=s.replace(a,b)};
edit("APP_VERSION = '1.03'", "APP_VERSION = '1.04'");
edit("const [task, setTask] = useState('');", `const [task, setTask] = useState('');
  const [currentTask, setCurrentTask] = useState('');
  const sending = useRef(false);
  const [question, setQuestion] = useState<{ question: string; options?: string[] } | null>(null);
  const [answer, setAnswer] = useState('');
  const [plan, setPlan] = useState<string[]>([]);
  const [contextUsage, setContextUsage] = useState<{ usedTokens: number; contextWindow: number; maxTokens: number } | null>(null);
  const [sessions, setSessions] = useState<Array<{ sessionId: string; task?: string; id: string }>>([]);`);
edit("let s = normalizeSettings(JSON.parse(localStorage.getItem(SKEY) || '{}'));", "let s = DEFAULT_SETTINGS; try { s = normalizeSettings(JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch { /* recover malformed settings */ }");
edit('if (old) s =', 'if (old && !localStorage.getItem(SKEY)) s =');
edit("setSettings(s); setSessionId(newId('ses')); setHydrated(true);", "setSettings(s); setSessionId(localStorage.getItem('ec12.session') || newId('ses')); setHydrated(true);");
edit("const { apiKey, ...safe } = settings as any; localStorage.setItem(SKEY, JSON.stringify(safe));", "localStorage.setItem(SKEY, JSON.stringify({ ...settings, provider: { ...settings.provider, apiKey: '' }, contextTools: { ...settings.contextTools, context7ApiKey: '' } }));");
edit('setCatalog(d.catalog || {});', `setCatalog(d.catalog || {});
      setSettings((s) => {
        const model = s.provider.modelSelection === 'auto' && d.loaded?.length ? (d.loaded.includes(s.provider.model) ? s.provider.model : d.loaded[0]) : s.provider.model;
        const meta = d.catalog?.[model];
        return { ...s, provider: { ...s.provider, model, ...(s.provider.autoModelLimits && meta?.ctx ? { contextWindow: meta.ctx, maxTokens: meta.maxOut || meta.ctx } : {}) } };
      });`);
edit('} finally { setModelsBusy(false); }', "} catch { setError('Could not load models. Check the server URL and refresh the list.'); } finally { setModelsBusy(false); }");
edit('switch (e.type) {', `switch (e.type) {
      case 'run.created': setCurrentTask(d.task || ''); break;
      case 'model.resolved': setEffectiveModel(d.model); setContextUsage({ usedTokens: 0, contextWindow: d.contextWindow, maxTokens: d.maxTokens }); break;
      case 'context.usage': setContextUsage(d); break;
      case 'plan.updated': setPlan(d.steps || []); break;
      case 'question.asked': setQuestion(d); break;
      case 'question.answered': setQuestion(null); setAnswer(''); break;
      case 'stage.started': setRunDetail('Reviewing: ' + d.label); break;`);
edit("setProviderPhase('idle'); loadHistory(sessionIdRef.current); break;", "setProviderPhase('idle'); setRunDetail(''); setQuestion(null); esRef.current?.close(); loadHistory(sessionIdRef.current); break;");
edit('useEffect(() => () => esRef.current?.close(), []);', `useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => {
    if (!hydrated || !sessionId) return;
    localStorage.setItem('ec12.session', sessionId);
    let disposed = false;
    fetch('/api/runs?sessionId=' + encodeURIComponent(sessionId)).then((r) => r.json()).then((d) => {
      if (disposed || runIdRef.current || !d.runs?.length) return;
      const latest = d.runs[0];
      setRunId(latest.id); runIdRef.current = latest.id; setRunState(latest.state);
      startedAt.current = Date.parse(latest.createdAt); lastSeq.current = 0; seen.current.clear(); subscribe(latest.id);
      loadHistory(sessionId, latest.id);
    }).catch(() => setError('Could not restore this session. Reload after the app reconnects.'));
    return () => { disposed = true; };
  }, [hydrated, sessionId, subscribe, loadHistory]);
  useEffect(() => { if (atBottom) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [assistant, atBottom]);`);
edit("if (!task.trim()) return;", "if (!task.trim() || sending.current || running) return;");
edit("const sid = sessionIdRef.current || newId('ses');", "setView('agent'); setCurrentTask(task); setRunState('queued'); setRunDetail('Connecting to the model'); sending.current = true;\n    try {\n    const sid = sessionIdRef.current || newId('ses');");
edit("if (!d.ok) { setError(d.error || 'Could not start run.'); return; }", "if (!d.ok) { setRunState('failed'); setError(d.error || 'Could not start run.'); return; }");
edit('subscribe(d.runId);', "subscribe(d.runId);\n    } catch { setRunState('failed'); setError('Could not start the task. Check that the app server is running, then send again.'); } finally { sending.current = false; }");
edit("setSessionId(newId('ses')); setRunId('');", "esRef.current?.close(); lastSeq.current = 0; seen.current.clear(); setHistory([]); setError(''); setReasoning(''); setQuestion(null); setPlan([]); setCurrentTask(''); setContextUsage(null); setSessionId(newId('ses')); setRunId('');");
edit('<button className="btn sm" onClick={newSession}>New session</button>', `<button className="btn sm" disabled={running} onClick={newSession}>New session</button>
        <button className="btn sm" disabled={running} onClick={async () => { const d = await fetch('/api/runs').then((r) => r.json()); const seen = new Set<string>(); setSessions((d.runs || []).filter((r: any) => { if (seen.has(r.sessionId)) return false; seen.add(r.sessionId); return true; })); }}>Sessions</button>`);
edit('<div className="statusbar">', `<div className="statusbar">
        {sessions.length > 0 && <select aria-label="Saved session" value="" onChange={(e) => { const r = sessions.find((s) => s.sessionId === e.target.value); if (r) { newSession(); setSessionId(r.sessionId); setSessions([]); } }}><option value="">Open a saved session…</option>{sessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.task || s.sessionId}</option>)}</select>}`);
edit('{error && <div className="ev error">', '{currentTask && <div className="ev"><span className="tag">you</span>{currentTask}</div>}\n                {error && <div className="ev error">');
edit("h.finalText.slice(0, 2000)", "h.finalText");
edit('<div className="panel-head"><span>Activity</span>', `<div style={{ padding: 10 }}>
            {contextUsage && <><div className="hint">Context: {contextUsage.usedTokens.toLocaleString()} / {contextUsage.contextWindow.toLocaleString()} tokens (estimated)</div><progress aria-label="Context usage" value={contextUsage.usedTokens} max={contextUsage.contextWindow} style={{ width: '100%' }} /><div className="hint">Available output: {contextUsage.maxTokens.toLocaleString()} tokens</div></>}
            {plan.length > 0 && <><b>Plan</b><ol>{plan.map((step, i) => <li key={i}>{step}</li>)}</ol></>}
          </div>
          <div className="panel-head"><span>Activity</span>`);
edit('<div className="composer-bar">', `<div className="composer-bar">
        {question && <div className="ev" style={{ flex: 1 }}><b>{question.question}</b><div>{question.options?.map((o) => <button className="btn sm" key={o} onClick={() => setAnswer(o)}>{o}</button>)}</div><input aria-label="Answer the agent" value={answer} onChange={(e) => setAnswer(e.target.value)} /><button className="btn primary" disabled={!answer.trim()} onClick={async () => { const d = await fetch('/api/runs/' + runId + '/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) }).then((r) => r.json()); if (!d.ok) setError(d.error); }}>Answer and continue</button></div>}`);
fs.writeFileSync(file,s);

