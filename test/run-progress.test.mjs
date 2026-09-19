import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { startShell, inspectShell } from '../src/server/tools/managed-shell.ts';
import { OpenAICompatProvider } from '../src/server/providers/openai-compatible.ts';
import { runMainLoop } from '../src/server/agent/loop.ts';
import { newConversation } from '../src/server/agent/context-manager.ts';
import { echo, sleepSeconds, sequence } from './shell-compat.mjs';

fs.mkdirSync('test-output',{recursive:true});
const root=fs.mkdtempSync(path.resolve('test-output/run-progress-'));
process.env.EC12_DATA_DIR=path.join(root,'data');
const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
const env={workspacePath:workspace,sessionId:'progress',runId:'progress',reviewMode:false};

test('long shell yields, stays alive, and later returns the real exit code',async()=>{
  const first=await startShell(env,sequence(echo('started'),sleepSeconds(2),echo('finished'),'exit 7'),undefined,10);
  assert.match(first.result.output,/STILL RUNNING/);assert.equal(first.result.exitCode,null);
  const id=/Process ID: (proc_[\w-]+)/.exec(first.result.output)[1];
  assert.equal((await inspectShell({...env,sessionId:'other'},id,false,0)).result.ok,false);
  const end=await inspectShell(env,id,false,10000);
  assert.equal(end.result.exitCode,7);assert.equal(end.result.ok,false);assert.match(end.result.output,/finished/);
});

test('Stop terminates a managed server process',async()=>{
  const first=await startShell(env,sleepSeconds(60),undefined,100);
  const id=/Process ID: (proc_[\w-]+)/.exec(first.result.output)[1];
  const stopped=await inspectShell(env,id,true,10000);
  assert.equal(stopped.result.ok,false);assert.match(stopped.result.output,/cancelled/);
});

test('the coding loop continues after launching a long command and observes completion',async()=>{
  let request=0;
  const provider={async *stream(messages){
    request++;
    if(request===1) yield {type:'tool_delta',index:0,id:'launch',name:'shell_command',argsDelta:JSON.stringify({command:sequence(sleepSeconds(1),echo('WORK_FINISHED')),yield_ms:1})};
    else if(request===2){
      const output=messages.filter(m=>m.role==='tool').at(-1).content;
      const id=/Process ID: (proc_[\w-]+)/.exec(output)[1];
      yield {type:'tool_delta',index:0,id:'poll',name:'shell_process',argsDelta:JSON.stringify({process_id:id,wait_ms:10000})};
    }else{
      const output=messages.filter(m=>m.role==='tool').at(-1).content;
      assert.match(output,/exit code 0/);assert.match(output,/WORK_FINISHED/);
      yield {type:'content',text:'Verified command completion.'};
    }
    yield {type:'done',finishReason:'stop'};
  }};
  const result=await runMainLoop({runId:'loop',sessionId:'progress',workspace,mode:'code',signal:new AbortController().signal,provider,contextWindow:32000,requestedMaxTokens:32000,autoCompact:true,autoCompactAtPercent:80,keepRecentTurns:4,maxIterations:0,repeatedFailureLimit:3,contextTools:{},journalEnv:env,conversation:newConversation(),systemBlocks:['Test'],task:'Run the check',emit:()=>{}});
  assert.equal(request,3);assert.equal(result.error,undefined);assert.equal(result.content,'Verified command completion.');
});

test('SSE DONE finishes even when the server keeps its HTTP connection open',async()=>{
  const server=http.createServer((req,res)=>{
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6},"choices":[]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1500);
  try{
    const p=new OpenAICompatProvider({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'test',apiKey:'',maxTokens:1000,temperature:0,connectTimeoutMs:0,firstTokenTimeoutMs:0,streamIdleTimeoutMs:0,requestTimeoutMs:0,retries:0});
    const events=[];for await(const e of p.stream([{role:'user',content:'hi'}],{maxTokens:1000},controller.signal))events.push(e);
    assert.equal(events.at(-1).type,'done');assert.equal(events.find(e=>e.type==='usage').usage.totalTokens,6);assert.ok(!controller.signal.aborted);
  }finally{clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));}
});


test('workspace search skips custom Python environments and can be cancelled', async () => {
  const { searchFiles } = await import('../src/server/tools/registry.ts');
  const scan=path.join(root,'search');fs.mkdirSync(scan);
  fs.writeFileSync(path.join(scan,'source.py'),'Realism source');
  const venv=path.join(scan,'.custom_env');fs.mkdirSync(venv);
  fs.writeFileSync(path.join(venv,'pyvenv.cfg'),'home = python');
  fs.writeFileSync(path.join(venv,'dependency.py'),'Realism dependency');
  const result=await searchFiles(scan,{query:'Realism'});
  assert.match(result.output,/source.py/);assert.doesNotMatch(result.output,/dependency/);
  const controller=new AbortController();
  const pending=searchFiles(scan,{query:'Realism'},controller.signal);controller.abort();
  await assert.rejects(pending,/abort/i);
});

test('importing the run manager does not interrupt stored runs; recovery skips live owners',async()=>{
  const { dataDir, writeJsonAtomic }=await import('../src/server/store.ts');
  const record={id:'legacy',sessionId:'progress',state:'generating',createdAt:new Date().toISOString()};
  writeJsonAtomic(dataDir('runs','legacy.json'),record);
  const { runs,loadRun,markUnfinishedInterrupted }=await import('../src/server/runs/manager.ts');
  assert.equal(loadRun('legacy').state,'generating');
  writeJsonAtomic(dataDir('runs','owned.json'),{...record,id:'owned',ownerPid:process.pid});
  markUnfinishedInterrupted();
  assert.equal(loadRun('legacy').state,'interrupted');assert.equal(loadRun('owned').state,'generating');
  const controller=new AbortController();
  const live={...record,id:'cancel-test',state:'generating'};
  runs.live.set(live.id,{record:live,controller});
  assert.equal(runs.cancel(live.id).ok,true);assert.equal(controller.signal.aborted,true);
  assert.equal(runs.cancel(live.id).ok,true);
  runs.setState(live,'generating');assert.equal(live.state,'cancelling');
  runs.finish(live,'succeeded',{summary:{outcome:'succeeded'}});
  assert.equal(loadRun(live.id).state,'cancelled');
});
