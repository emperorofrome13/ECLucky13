import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { GET, POST, PATCH, DELETE, PUT } from '../src/app/api/mcp-servers/route.ts';
import { readMcpServers, saveMcpServer, deleteMcpServer, discoverMcpTools, callCustomMcpTool, mcpToolName } from '../src/server/custom-mcp.ts';
import { buildRegistry, executeTool, toolsForRun } from '../src/server/tools/registry.ts';
import { DEFAULT_CUSTOM_MCP_LIMITS } from '../src/shared/settings-schema.ts';

const root = fs.mkdtempSync(path.resolve('test-output/lucky-custom-mcp-'));
process.env.EC12_DATA_DIR = path.join(root, 'data');
const fixture = path.join(root, 'fixture.mjs');
fs.writeFileSync(fixture, `import readline from 'node:readline';
const input = readline.createInterface({input:process.stdin});
input.on('line', line => {
 const m = JSON.parse(line);
 const reply = result => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
 if(m.method === 'initialize') reply({protocolVersion:'2025-06-18',capabilities:{tools:{}}});
 if(m.method === 'tools/list') reply({tools:[{name:'echo',description:'Echo input',inputSchema:{type:'object',properties:{text:{type:'string'}}},annotations:{readOnlyHint:true}},{name:'write',inputSchema:{type:'object'}}]});
 if(m.method === 'tools/call') {
  if(m.params.arguments.text === 'hang') return;
  if(m.params.arguments.text === 'pid') return reply({content:[{type:'text',text:String(process.pid)}]});
  reply({content:[{type:'text',text:(m.params.arguments.text || '')+process.env.FIXTURE_SECRET}]});
 }
});
input.on('close',()=>process.exit(0));
`);
const limits = { ...DEFAULT_CUSTOM_MCP_LIMITS, timeoutMs: 3000, shutdownGraceMs: 100, outputMaxChars: 0, schemaMaxChars: 0 };
const req = (method, body, suffix = '') => new Request('http://127.0.0.1:3313/api/mcp-servers' + suffix, { method, headers: { host: '127.0.0.1:3313', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
let id;

test('API creates server, never returns secrets, preserves redactions, discovers through real stdio', async () => {
 const response = await POST(req('POST', {name:'Fixture',transport:'stdio',command:process.execPath,args:[fixture],cwd:root,env:{FIXTURE_SECRET:'private-value-123'},replaceEnv:true,limits}));
 assert.equal(response.status,200);
 const created = await response.json(); id = created.server.id;
 assert.equal(created.server.env.FIXTURE_SECRET,'[redacted]');
 assert.ok(!JSON.stringify(created).includes('private-value-123'));
 const listing = await (await GET(req('GET'))).json();
 assert.equal(listing.servers.length,1);
 const updated = await PATCH(req('PATCH',{...listing.servers[0],name:'Renamed'}));
 assert.equal(updated.status,200);
 assert.equal(readMcpServers()[0].env.FIXTURE_SECRET,'private-value-123');
 const discovery = await (await PUT(req('PUT',{id,workspace:root}))).json();
 assert.equal(discovery.ok,true,discovery.error);
 assert.equal(discovery.tools.length,2);
 const called = await callCustomMcpTool(readMcpServers()[0],discovery.tools[0],{text:'hello '},root);
 assert.equal(called.output,'hello [redacted]');
 const denied = await PATCH(req('PATCH',{id,env:{FIXTURE_SECRET:'new-secret'}}));
 assert.equal(denied.status,400);
 assert.equal((await PATCH(req('PATCH',{id,env:{FIXTURE_SECRET:'replacement-value'},replaceEnv:true}))).status,200);
 assert.equal(readMcpServers()[0].env.FIXTURE_SECRET,'replacement-value');
});

test('registry bridge discovers per run, honors snapshot, enforces modes and namespace', async () => {
 const ctx = {env:{workspacePath:root,runId:'fixture-run',sessionId:'fixture',reviewMode:false},mode:'code',contextTools:{}};
 assert.ok(toolsForRun('code',ctx.contextTools).some(t=>t.name==='mcp_discover_tools'));
 saveMcpServer({enabled:false},id);
 const registry = await buildRegistry(ctx);
 assert.equal(registry.errors.length,0);
 const tool = registry.tools.find(t=>t.remoteName==='echo');
 assert.ok(tool);
 assert.equal((await registry.execute(tool.name,{text:'snapshot '})).result.output,'snapshot [redacted]');
 assert.equal((await executeTool({...ctx,mode:'ask'},'mcp_call_tool',{name:mcpToolName(id,'write'),arguments:{}})).result.ok,false);
 assert.notEqual(mcpToolName(id,'echo'),mcpToolName('another','echo'));
 const next = {...ctx,contextTools:{},env:{...ctx.env,runId:'next'}};
 const unavailable = await executeTool(next,'mcp_discover_tools',{});
 assert.match(unavailable.result.error,/disabled/);
 saveMcpServer({enabled:true},id);
});

test('stdio cancellation, timeout, budget errors and child cleanup are real', async () => {
 const saved = saveMcpServer({name:'Lifecycle fixture',transport:'stdio',command:process.execPath,args:[fixture],cwd:root,env:{FIXTURE_SECRET:'lifecycle-secret'},replaceEnv:true,limits});
 const server = readMcpServers().find(s=>s.id===saved.id);
 const tools = await discoverMcpTools(server,root);
 const controller = new AbortController();
 const pending = callCustomMcpTool({...server,limits:{...limits,timeoutMs:0,shutdownGraceMs:0}},tools[0],{text:'hang'},root,controller.signal);
 setTimeout(()=>controller.abort(),150);
 const cancelled = await pending;
 assert.match(cancelled.error,/cancelled/i);
 const timed = await callCustomMcpTool({...server,limits:{...limits,timeoutMs:100}},tools[0],{text:'hang'},root);
 assert.match(timed.error,/respond within/);
 await assert.rejects(discoverMcpTools({...server,limits:{...limits,schemaMaxChars:1}},root),/schemaMaxChars/);
 const pid = await callCustomMcpTool(server,tools[0],{text:'pid'},root);
 assert.throws(()=>process.kill(Number(pid.output),0));
 const capped = await callCustomMcpTool({...server,limits:{...limits,outputMaxChars:3}},tools[0],{text:'long text'},root);
 assert.match(capped.output,/truncated/);
});

test('streamable HTTP handles initialized session, persistent SSE response, credentials and DELETE', async () => {
 let deleted = 0, initialized = false;
 const server = http.createServer(async (request,response)=>{
  assert.equal(request.headers.authorization,'Bearer http-private-value');
  if(request.method==='DELETE'){deleted++;response.writeHead(204);response.end();return;}
  let raw='';for await(const chunk of request)raw+=chunk;
  const m=JSON.parse(raw);
  if(m.method==='notifications/initialized'){initialized=true;response.writeHead(202);response.end();return;}
  let result;
  if(m.method==='initialize'){response.setHeader('mcp-session-id','local-session');result={protocolVersion:'2025-06-18',capabilities:{tools:{}}};}
  else {
   assert.ok(initialized);assert.equal(request.headers['mcp-session-id'],'local-session');
   result=m.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'Bearer http-private-value'}]};
  }
  response.writeHead(200,{'content-type':'text/event-stream'});
  response.write('event: message\r\ndata: '+JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\r\n\r\n');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const saved=saveMcpServer({name:'HTTP',transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer http-private-value'},replaceHeaders:true,limits});
  const config=readMcpServers().find(s=>s.id===saved.id);
  const tools=await discoverMcpTools(config,root);
  assert.equal(tools.length,1);
  const output=await callCustomMcpTool(config,tools[0],{},root);
  assert.equal(output.output,'[redacted]');
  assert.equal(deleted,2);
  deleteMcpServer(saved.id);
 } finally {server.closeAllConnections();server.close();}
});

test('real agent loop uses discovery bridge and retains active configuration snapshot', async () => {
 const { runMainLoop } = await import('../src/server/agent/loop.ts');
 const { newConversation } = await import('../src/server/agent/context-manager.ts');
 const config = saveMcpServer({name:'Loop fixture',transport:'stdio',command:process.execPath,args:[fixture],cwd:root,env:{FIXTURE_SECRET:'loop-secret'},replaceEnv:true,limits});
 const events=[]; let turn=0;
 const provider={async *stream(messages,opts){
  assert.ok(opts.tools.some(t=>t.function.name==='mcp_discover_tools'));
  let name,args;
  if(turn===0){saveMcpServer({enabled:false},config.id);name='mcp_discover_tools';args={};}
  else if(turn===1){let discovered;const raw=messages.filter(m=>m.role==='tool').at(-1).content;try{discovered=JSON.parse(raw);}catch{assert.fail('discovery tool message was not JSON: '+raw);}name='mcp_call_tool';args={name:discovered.tools.find(t=>t.serverId===config.id&&t.remoteName==='echo').name,arguments:{text:'loop result '}};}
  else {assert.match(messages.filter(m=>m.role==='tool').at(-1).content,/loop result \[redacted\]/);name='attempt_completion';args={result:'MCP loop verified'};}
  yield {type:'tool_delta',index:0,id:'mcp-loop-'+turn++,name,argsDelta:JSON.stringify(args)};
  yield {type:'done',finishReason:'tool_calls'};
 }};
 const outcome=await runMainLoop({runId:'mcp-loop',sessionId:'mcp-loop',workspace:root,mode:'code',signal:new AbortController().signal,provider,contextWindow:32000,requestedMaxTokens:1000,autoCompact:false,maxIterations:5,repeatedFailureLimit:3,contextTools:{},journalEnv:{workspacePath:root,runId:'mcp-loop',sessionId:'mcp-loop',reviewMode:false},conversation:newConversation(),systemBlocks:['Test MCP'],task:'Use custom MCP',emit:(type,data)=>events.push({type,data})});
 assert.equal(outcome.error,undefined);assert.equal(outcome.content,'MCP loop verified');
 assert.ok(events.some(e=>e.type==='tool.finished'&&e.data.name==='mcp_call_tool'&&e.data.ok));
 assert.ok(!JSON.stringify(events).includes('loop-secret'));
});

test('API visibly rejects missing/disabled server, invalid config and cross origin', async () => {
 saveMcpServer({enabled:false},id);
 const disabled=await (await PUT(req('PUT',{id}))).json();assert.match(disabled.error,/disabled/);
 assert.equal((await PUT(req('PUT',{id:'missing'}))).status,404);
 assert.equal((await POST(req('POST',{name:'bad',transport:'http',url:'http://localhost/mcp?token=secret'}))).status,400);
 const cross=new Request('http://127.0.0.1:3313/api/mcp-servers',{headers:{host:'127.0.0.1:3313',origin:'http://example.invalid'}});
 assert.equal((await GET(cross)).status,403);
 assert.equal((await DELETE(req('DELETE',undefined,'?id='+id))).status,200);
 assert.ok(!readMcpServers().some(s=>s.id===id));
});
