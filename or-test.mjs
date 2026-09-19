const t0 = Date.now();
try {
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
  const txt = await res.text();
  console.log('status', res.status, 'bytes', txt.length, 'ms', Date.now()-t0);
  const j = JSON.parse(txt);
  const arr = j.data || [];
  console.log('models', arr.length);
  const s = arr[0];
  console.log('sample id', s.id);
  console.log('has context_length', typeof s.context_length, s.context_length);
  console.log('top_provider', JSON.stringify(s.top_provider));
  console.log('pricing keys', Object.keys(s.pricing||{}).slice(0,6).join(','));
  const withCtx = arr.filter(m=>typeof m.context_length==='number').length;
  const withMax = arr.filter(m=>m.top_provider && typeof m.top_provider.max_completion_tokens==='number').length;
  console.log('with_context', withCtx, 'with_max_completion', withMax);
} catch(e) { console.log('ERR', String(e.message||e), 'ms', Date.now()-t0); }
