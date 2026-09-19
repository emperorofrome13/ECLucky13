import { chromium } from 'playwright-core';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/shared/settings-schema.ts';
const root=path.resolve('test-output/v112-live-workspace');fs.mkdirSync(root,{recursive:true});
const api=async(url,body)=>fetch('http://127.0.0.1:3000'+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}).then(r=>r.json());
let connected=false,disconnected=false;
const fixture=http.createServer((req,res)=>{
 if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'stop-fixture'}]}));return;}
 req.resume();res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"Waiting for Stop test."}}]}\n\n');connected=true;res.on('close',()=>disconnected=true);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const ws=(await api('/api/workspaces',{path:root})).workspace;
const settings=normalizeSettings({workspace:{id:ws.id,path:ws.path},mode:'ask',provider:{baseUrl:`http://127.0.0.1:${fixture.address().port}/v1`,model:'stop-fixture',modelSelection:'pinned',contextWindow:32000,autoModelLimits:false},contextTools:{skills:false,ponytail:false,codegraph:false,search:false,context7:false}});
const base=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright');
const candidates=fs.readdirSync(base).filter(d=>d.startsWith('chromium-')).flatMap(d=>['chrome-win/chrome.exe','chrome-win64/chrome.exe'].map(p=>path.join(base,d,p)));
const browser=await chromium.launch({headless:true,executablePath:candidates.find(p=>fs.existsSync(p))});
try{
 const context=await browser.newContext({viewport:{width:1500,height:950}});
 await context.addInitScript(s=>{localStorage.setItem('ec12.settings.v1',JSON.stringify(s));localStorage.setItem('ec12.session','ses_v112_stop_verification');},settings);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000');assert.match(await page.title(),/v1.12/);
 await page.locator('.composer-bar textarea').fill('Verify Stop on a waiting local stream');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Waiting for Stop test.',{exact:false}).first().waitFor();
 assert.ok(connected);
 await page.getByRole('button',{name:'Stop',exact:true}).first().click();
 await page.getByRole('button',{name:'Send',exact:true}).waitFor({timeout:10000});
 const list=await api('/api/runs?sessionId=ses_v112_stop_verification');
 assert.equal(list.runs[0].state,'cancelled');assert.ok(disconnected,'model socket closed');
 await page.screenshot({path:'test-output/v112-stop-verified.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({version:await page.title(),state:list.runs[0].state,providerDisconnected:disconnected,pageErrors:errors,screenshot:'test-output/v112-stop-verified.png'}));
}finally{await browser.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}
