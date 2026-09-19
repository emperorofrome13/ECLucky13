import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const base=process.env.EC12_BASE||'http://127.0.0.1:3211';
const root=path.resolve('test-output','e2e-v104-'+Date.now());fs.mkdirSync(root,{recursive:true});
const post=async(url,data)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!d.ok)throw Error(JSON.stringify(d));return d};
const settings={provider:{baseUrl:'http://127.0.0.1:1234/v1',model:'qwen/qwen3.5-9b',modelSelection:'auto',autoModelLimits:true,temperature:0.2},agent:{maxIterations:0,stageMaxIterations:0},contextTools:{skills:false},autoPrompt:{enabled:false,stages:[]}};
const ws=await post('/api/workspaces',{path:root});const sessionId='e2e_'+Date.now();const evidence=[];
async function task(prompt,mode='ask',overrides={}){
 const created=await post('/api/runs',{clientRequestId:crypto.randomUUID(),sessionId,workspaceId:ws.workspace.id,mode,task:prompt,settings:{...settings,...overrides}});
 console.log('RUN',created.runId,prompt); const response=await fetch(base+'/api/runs/'+created.runId+'/events');let buffer='';const dec=new TextDecoder();const events=[];
 for await(const chunk of response.body){buffer+=dec.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.startsWith('data:'))continue;const e=JSON.parse(line.slice(5));events.push(e);if(['tool.finished','stage.finished','run.finished','error'].includes(e.type))console.log(e.type,JSON.stringify(e.data).slice(0,500));}}
 const {run}=await fetch(base+'/api/runs/'+created.runId).then(r=>r.json());fs.writeFileSync(path.join(root,created.runId+'.evidence.json'),JSON.stringify({run,events},null,2));evidence.push({id:run.id,state:run.state,reply:run.finalText});return {run,events};
}
const a=await task('Remember codeword citron. Reply exactly: Ready citron.');assert.equal(a.run.state,'succeeded');assert.match(a.run.finalText,/citron/i);
const b=await task('What codeword did I give you? Answer only that word.');assert.match(b.run.finalText,/citron/i);
fs.writeFileSync(path.join(root,'math.cjs'),'exports.add = (a, b) => a - b;\n');
fs.writeFileSync(path.join(root,'math.test.cjs'),"const assert=require('node:assert/strict');const {add}=require('./math.cjs');assert.equal(add(2,3),5);assert.equal(add(-1,1),0);console.log('math tests passed');\n");
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'ec12-live-fixture',scripts:{test:'node math.test.cjs'}}));
const c=await task('Fix the bug in math.cjs. Read math.test.cjs, make the minimal edit, run npm test, and finish with a concise summary.','code',{autoPrompt:{enabled:true,stages:['review']}});
assert.equal(c.run.state,'succeeded');assert.ok(c.events.some(e=>e.type==='change.applied'));assert.ok(c.events.some(e=>e.type==='stage.finished'&&e.data.passed));assert.match(fs.readFileSync(path.join(root,'math.cjs'),'utf8'),/a\s*\+\s*b/);
console.log('LIVE_E2E_PASS',JSON.stringify(evidence));console.log('Evidence folder:',root);
