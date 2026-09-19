import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { newConversation, estimateTokens, prepareRequest, prepareConversation, compactConversation } from '../src/server/agent/context-manager.ts';
import { discoverModels, resolveEffectiveModel } from '../src/server/providers/model-discovery.ts';

test('reasoning is counted, completed local reasoning is excluded without deleting saved history', () => {
  const c = newConversation();
  c.messages = [{role:'user',content:'first'}, {role:'assistant',content:'done',reasoning_content:'thinking '.repeat(5000)}, {role:'user',content:'next'}, {role:'assistant',content:null,reasoning_content:'current reasoning',tool_calls:[{id:'a',type:'function',function:{name:'read_file',arguments:'{}'}}]}, {role:'tool',tool_call_id:'a',content:'result'}];
  assert.ok(estimateTokens(c.messages) > 5000);
  const local = prepareConversation(c, ['instructions'], [], 16000, 16000, true, 80, 4, false);
  assert.equal(local.messages[2].reasoning_content, undefined);
  assert.equal(local.messages[4].reasoning_content, 'current reasoning');
  assert.ok(c.messages[1].reasoning_content.length > 10000);
  const remote = prepareConversation(c, [], [], 16000, 16000, true, 80, 4, true);
  assert.ok(remote.messages[2].reasoning_content);
  assert.ok(local.usedTokens < remote.usedTokens);
});

test('a single long coding turn compacts completed tool batches without orphaned results', () => {
  const c = newConversation(); c.originalTask = 'Fix the parser'; c.plan = ['inspect', 'test'];
  c.messages.push({role:'user',content:c.originalTask});
  for(let i=0;i<12;i++) c.messages.push({role:'assistant',content:null,reasoning_content:'reasoning '.repeat(300),tool_calls:[{id:`t${i}`,type:'function',function:{name:'read_file',arguments:'{"path":"parser.ts"}'}}]}, {role:'tool',tool_call_id:`t${i}`,content:`Observation ${i}: `+'parser detail '.repeat(1600)});
  const p = prepareConversation(c, ['project instructions'], [], 8192, 8192, true, 80, 4, false);
  assert.equal(p.compaction.compacted, true);
  assert.ok(p.usedTokens < 8192 * .8);
  assert.ok(p.maxTokens > 8192 * .2);
  assert.match(c.summary, /Observation 10/);
  const calls = new Set(p.messages.flatMap(m=>(m.tool_calls||[]).map(c=>c.id)));
  for(const m of p.messages.filter(m=>m.role==='tool')) assert.ok(calls.has(m.tool_call_id));
  assert.ok(p.messages.some(m=>m.role==='user'&&m.content==='Fix the parser'));
});

test('new compacted observations survive an already-full summary', () => {
  const c = newConversation(); c.summary='old '.repeat(4000);
  c.messages=[{role:'user',content:'NEW_DECISION use SQLite'}, {role:'assistant',content:'acknowledged'}, {role:'user',content:'continue'}, {role:'assistant',content:'working'}];
  compactConversation(c, 8000, 1);
  assert.match(c.summary,/NEW_DECISION/);
});

test('an oversized latest tool result fits without dropping its call or task', () => {
  const messages=[{role:'user',content:'Inspect the file'}, {role:'assistant',content:null,tool_calls:[{id:'large',type:'function',function:{name:'read_file',arguments:'{}'}}]}, {role:'tool',tool_call_id:'large',content:'file contents '.repeat(6000)}];
  const p=prepareRequest(messages,[],4096,4096);
  assert.ok(p.usedTokens+p.maxTokens<4096);
  assert.equal(p.messages[1].tool_calls[0].id,p.messages[2].tool_call_id);
  assert.match(p.messages[2].content,/Earlier detail omitted/);
  assert.equal(messages[2].content.length,'file contents '.repeat(6000).length);
});

test('LM Studio loaded instance overrides stale model and training context', async () => {
  let current='instance-A'; let ctx=16384;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(req.url==='/api/v1/models'?{models:[{type:'llm',key:'model-file',max_context_length:262144,loaded_instances:[{id:current,config:{context_length:ctx}}]}]}:{data:[{id:'old',max_context_length:262144}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/v1`;
  try {
    let d=await discoverModels(url,'');assert.deepEqual(d.loaded,['instance-A']);assert.equal(d.catalog[current].ctx,16384);
    current='instance-B';ctx=32768;d=await discoverModels(url,'');
    const r=resolveEffectiveModel('auto','instance-A',d.loaded,d.catalog);assert.equal(r.effective,'instance-B');assert.equal(r.ctx,32768);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('local single-model discovery follows external switches immediately and refreshes limits', async () => {
  let model='first';
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json'); if(req.url==='/v1/models')res.end(JSON.stringify({data:[{id:model,max_model_len:model==='first'?32000:64000}]}));else{res.statusCode=404;res.end('{}');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/v1`;
  try {
    const a=await discoverModels(url,''); assert.deepEqual(a.loaded,['first']);
    model='second';
    const b=await discoverModels(url,''); assert.deepEqual(b.models,['second']);assert.deepEqual(b.loaded,['second']);
    const resolved=resolveEffectiveModel('auto','first',b.loaded,b.catalog);assert.equal(resolved.effective,'second');assert.equal(resolved.ctx,64000);
    assert.equal(resolveEffectiveModel('pinned','first',b.loaded,b.catalog).effective,'first');
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
