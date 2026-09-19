import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { OpenAICompatProvider, parseTextToolCalls } from '../src/server/providers/openai-compatible.ts';
import { normalizeSettings } from '../src/shared/settings-schema.ts';
import { prepareRequest, newConversation } from '../src/server/agent/context-manager.ts';
import { runMainLoop, runStage } from '../src/server/agent/loop.ts';
const cfg={baseUrl:'',apiKey:'',model:'fixture',maxTokens:1000,temperature:0,connectTimeoutMs:1,firstTokenTimeoutMs:1,streamIdleTimeoutMs:1,requestTimeoutMs:1,retries:0};
async function withServer(fn,run) {
  const server=http.createServer(fn); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try { await run(new OpenAICompatProvider({...cfg,baseUrl:`http://127.0.0.1:${server.address().port}/v1`})); }
  finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
}
const collect=async(p,signal)=>{const out=[];for await(const e of p.stream([{role:'user',content:'hi'}],{maxTokens:1000},signal))out.push(e);return out};
test('local inference ignores stale timeout settings and accepts trailing SSE without newline',async()=>{
  await withServer((q,r)=>{setTimeout(()=>{r.writeHead(200,{'Content-Type':'text/event-stream'});r.end('data: {"choices":[{"delta":{"content":"slow reply"},"finish_reason":"stop"}]}')},80)},async(p)=>{
    const out=await collect(p);assert.equal(out.find(e=>e.type==='content').text,'slow reply');assert.equal(out.at(-1).type,'done');
  });
});
test('JSON completion from a stream request is visible',async()=>{
 await withServer((q,r)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({choices:[{message:{role:'assistant',content:'JSON reply'},finish_reason:'stop'}]}))},async p=>{const out=await collect(p);assert.equal(out[0].text,'JSON reply')});
});
test('empty response and interrupted partial tool streams fail visibly',async()=>{
 for(const data of ['','data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"write_file","arguments":"{}"}}]}}]}\n\n']) {
 await withServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/event-stream'});r.end(data)},async p=>{const out=await collect(p);assert.equal(out.at(-1).type,'error');assert.ok(!out.some(e=>e.type==='done'))});
 }
});
test('Stop aborts a local request waiting indefinitely for headers',async()=>{
 await withServer(()=>{},async p=>{const ac=new AbortController();setTimeout(()=>ac.abort(),50);const out=await collect(p,ac.signal);assert.match(out.at(-1).message,/Cancelled/)});
});
test('text tool fallback executes only complete unquoted response tags',()=>{
 assert.equal(parseTextToolCalls('<tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>').calls.length,1);
 assert.equal(parseTextToolCalls('Example: <tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>').calls.length,0);
 assert.ok(parseTextToolCalls('<tool_call>{"name":').invalid.length);
});
test('zero token auto and zero remote timeout settings survive normalization',()=>{
 const p=normalizeSettings({provider:{maxTokens:0,requestTimeoutMs:0,firstTokenTimeoutMs:0,streamIdleTimeoutMs:0,connectTimeoutMs:0}}).provider;
 assert.equal(p.maxTokens,0);assert.equal(p.requestTimeoutMs,0);assert.equal(p.firstTokenTimeoutMs,0);assert.equal(p.autoModelLimits,true);
});
test('request budget includes tool schemas and adapts output to remaining context',()=>{
 const r=prepareRequest([{role:'system',content:'You code.'},{role:'user',content:'fix'}],[{name:'write',description:'A long schema '.repeat(100)}],4096,32768);
 assert.ok(r.maxTokens<4096);assert.ok(r.usedTokens+r.maxTokens<=4096);assert.ok(r.usedTokens>300);
});
const deps=(provider,conversation=newConversation())=>({runId:'fixture',sessionId:'fixture',workspace:process.cwd(),mode:'ask',signal:new AbortController().signal,provider,contextWindow:16384,requestedMaxTokens:1000,maxIterations:4,repeatedFailureLimit:3,contextTools:{},journalEnv:{workspacePath:process.cwd(),runId:'fixture',sessionId:'fixture',reviewMode:false},conversation,systemBlocks:['Answer the question.'],task:'Remember the codeword citron.',emit:()=>{}});
test('original request persists into tool follow-up without an empty user message',async()=>{
 const calls=[];let n=0;const p={async *stream(messages){calls.push(structuredClone(messages));if(n++===0)yield {type:'tool_delta',index:0,id:'t',name:'todo',argsDelta:'{"steps":["answer"]}'};else yield {type:'content',text:'citron'};yield {type:'done',finishReason:'stop'}}};
 const d=deps(p);await runMainLoop(d);assert.ok(calls[1].some(m=>m.role==='user'&&m.content===d.task));assert.ok(!calls[1].some(m=>m.role==='user'&&!m.content));assert.equal(d.conversation.messages[0].content,d.task);
});
test('empty and partial-error model turns cannot be successful',async()=>{
 let r=await runMainLoop(deps({async *stream(){yield {type:'done'}}}));assert.match(r.error,/no visible answer/);
 r=await runMainLoop(deps({async *stream(){yield {type:'content',text:'partial'};yield {type:'error',message:'broken stream'}}}));assert.equal(r.error,'broken stream');assert.equal(r.content,'partial');
});
test('stage exits immediately on verdict and output budget has no 8192 cap',async()=>{
 let count=0;let budget=0;
 const provider={async *stream(m,o){count++;budget=o.maxTokens;yield {type:'tool_delta',index:0,id:'v',name:'report_verdict',argsDelta:'{"verdict":"PASS","summary":"verified"}'};yield {type:'done'}}};
 const d=deps(provider);const r=await runStage('review',{...d,contextWindow:65536,requestedMaxTokens:32768,stagePrompt:'review',conversationContext:'Changes'});assert.equal(r.passed,true);assert.equal(count,1);assert.ok(budget>8192);
});
