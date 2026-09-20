import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const port=process.env.PORT||'3313';
const url=`http://127.0.0.1:${port}`;
function run(command,args,env=process.env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true,env});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${command} exited with code ${code}`)));})}
const open=()=>{if(process.env.ECLucky13_NO_BROWSER!=='1')spawn('cmd.exe',['/d','/c','start','',url],{windowsHide:true,stdio:'ignore'}).unref()};
async function main(){
 const occupied=await new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(true));s.listen(Number(port),'127.0.0.1',()=>s.close(()=>resolve(false)))});
 if(occupied){const html=await fetch(url).then(r=>r.text()).catch(()=>'');if(html.includes('<title>ECLucky13 v1.24</title>')){console.log('ECLucky13 is already running at '+url);console.log('Opening your browser — this window closes in 15 seconds.');open();await new Promise(r=>setTimeout(r,15000));return;}throw Error(`Port ${port} is in use. Close the other app or set PORT to another port.`)}
 const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
 const manifestTime=Math.max(...['package.json','package-lock.json'].filter(f=>fs.existsSync(f)).map(f=>fs.statSync(f).mtimeMs));
 const installStamp='node_modules/.ec12-install-stamp';
 if(!fs.existsSync(installStamp)||fs.statSync(installStamp).mtimeMs<manifestTime||Object.keys({...pkg.dependencies,...pkg.devDependencies}).some(name=>!fs.existsSync(path.join('node_modules',name,'package.json')))){console.log('[1/3] Installing dependencies...');await run('cmd.exe',['/d','/c','npm.cmd','install','--include=dev','--cache','.npm-cache','--no-audit','--no-fund']);fs.writeFileSync(installStamp,String(Date.now()));}
 const stamp='.next-build/BUILD_ID';let fresh=fs.existsSync(stamp);const built=fresh?fs.statSync(stamp).mtimeMs:0;
 const newer=dir=>fs.readdirSync(dir,{withFileTypes:true}).some(e=>e.isDirectory()?newer(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).mtimeMs>built);
 if(!fresh||newer('src')||newer('scripts')||['package.json','package-lock.json','next.config.js','tsconfig.json',installStamp].some(f=>fs.existsSync(f)&&fs.statSync(f).mtimeMs>built)){console.log('[2/3] Building ECLucky13...');await run(process.execPath,['scripts/next.mjs','build']);}
 console.log('[3/3] Starting ECLucky13 at '+url+' — keep this window open. Press Ctrl+C to stop.');
 const child=spawn(process.execPath,['scripts/next.mjs','start'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,PORT:port}});
 let exited=false;child.on('error',e=>{exited=true;console.error(e.message);process.exitCode=1});child.on('exit',code=>{exited=true;process.exitCode=code||0});
 const wait=()=>new Promise(r=>setTimeout(r,500));
 while(!exited){try{const r=await fetch(url);if(r.ok){console.log('ECLucky13 v1.24 ready: HTTP '+r.status+' '+url);open();break}}catch{}await wait()}
}
main().catch(e=>{console.error('Could not start ECLucky13: '+e.message);process.exitCode=1});
