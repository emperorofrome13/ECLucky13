// ECLucky13 desktop shell: native window + tray + server lifecycle.
// First run: copies the app source into %LOCALAPPDATA%\ECLucky13\app, runs
// npm install + build with a progress window, then starts the server.
// Later runs: starts the server and opens the window directly.
'use strict';
const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.EC13_PORT || '3313';
const APP_DIR = path.join(app.getPath('appData'), 'ECLucky13', 'app');
const DATA_DIR = process.env.EC12_DATA_DIR || path.join(app.getPath('appData'), 'ECLucky13', 'data');
const VERSION_FILE = path.join(APP_DIR, '.desktop-version');
const APP_VERSION = app.getVersion();
const URL = `http://127.0.0.1:${PORT}/`;

// Top-level entries of the repo that ship inside the desktop app.
const SHIP = ['package.json', 'package-lock.json', 'next.config.js', 'tsconfig.json',
  'scripts', 'src', 'autoprompts', 'docs'];

let mainWin = null;
let setupWin = null;
let tray = null;
let serverProc = null;
let quitting = false;

// Main-process log beside the data dir, so headless failures stay diagnosable.
try {
  const logDir = path.join(app.getPath('appData'), 'ECLucky13');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'desktop-shell.log');
  const stamp = () => new Date().toISOString();
  for (const m of ['log', 'error', 'warn']) {
    const orig = console[m].bind(console);
    console[m] = (...a) => {
      orig(...a);
      try { fs.appendFileSync(logFile, `${stamp()} [${m}] ${a.map((x) => String(x && x.stack || x)).join(' ')}\n`); } catch { /* ignore */ }
    };
  }
  process.on('uncaughtException', (e) => console.error('UNCAUGHT', e));
  process.on('unhandledRejection', (e) => console.error('UNHANDLED', e));
} catch { /* logging must never break startup */ }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function logLine(win, s) {
  try { win.webContents.executeJavaScript(`addLog(${JSON.stringify(String(s).slice(0, 500))})`).catch(() => {}); } catch { /* closed */ }
}

function setupHtml(title) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{background:#04120a;color:#f0e9d2;font:14px Consolas,monospace;margin:0;padding:24px}h1{font-size:16px;color:#ffd166}#log{background:#071b10;border:1px solid #1f6b43;height:60vh;overflow:auto;padding:12px;white-space:pre-wrap}.bar{height:8px;background:#14402a;margin:12px 0}.bar>i{display:block;height:100%;width:0;background:#ffd166;transition:width .3s}</style>
</head><body><h1>ECLucky13 desktop setup</h1><div class="bar"><i id="p"></i></div><div id="log"></div>
<script>function addLog(s){const l=document.getElementById('log');l.textContent+=s+"\\n";l.scrollTop=l.scrollHeight}function progress(f){document.getElementById('p').style.width=Math.round(f*100)+"%"}</script>`);
}

function copySource(win) {
  // Repo root in dev (desktop/..) or inside the packaged app (resources).
  const candidates = [path.join(__dirname, '..'), path.join(process.resourcesPath, 'app-source')];
  const root = candidates.find((c) => SHIP.every((e) => fs.existsSync(path.join(c, e))));
  if (!root) throw new Error('App source not found next to the desktop shell.');
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const e of SHIP) {
    logLine(win, `copy ${e}`);
    fs.cpSync(path.join(root, e), path.join(APP_DIR, e), { recursive: true });
  }
}

function runCmd(win, cmd, args, cwd, extraEnv) {
  return new Promise((resolve, reject) => {
    logLine(win, `$ ${cmd} ${args.join(' ')}`);
    const p = spawn(cmd, args, { cwd, shell: true, windowsHide: true, env: { ...process.env, ...(extraEnv || {}) } });
    p.stdout.on('data', (d) => logLine(win, String(d).trimEnd().split('\n').slice(-3).join('\n')));
    p.stderr.on('data', (d) => logLine(win, String(d).trimEnd().split('\n').slice(-3).join('\n')));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function firstRunSetup(win) {
  const prog = (f) => { try { win.webContents.executeJavaScript(`progress(${f})`).catch(() => {}); } catch { /* closed */ } };
  logLine(win, `ECLucky13 ${APP_VERSION}: first-run setup into ${APP_DIR}`);
  copySource(win); prog(0.2);
  // Drop any dev-dir build from an older setup so only .next-build is served.
  fs.rmSync(path.join(APP_DIR, '.next'), { recursive: true, force: true });
  // Full install (not --omit=dev): Next resolves the @/* webpack alias through
  // TypeScript, so typescript must be present at build time.
  await runCmd(win, 'npm', ['install', '--no-audit', '--no-fund'], APP_DIR); prog(0.6);
  // Build MUST target .next-build: the server starts with EC12_DIST_DIR=.next-build.
  await runCmd(win, 'npm', ['run', 'build'], APP_DIR, { EC12_DIST_DIR: '.next-build' }); prog(0.9);
  fs.writeFileSync(VERSION_FILE, APP_VERSION + '\n');
  logLine(win, 'Setup complete. Starting the server…'); prog(1);
}

function needsSetup() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim() !== APP_VERSION
      || !fs.existsSync(path.join(APP_DIR, '.next-build', 'BUILD_ID'));
  } catch { return true; }
}

function startServer() {
  if (serverProc) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Run the server under Electron's Node (ELECTRON_RUN_AS_NODE), so the
  // packaged app needs no system-wide Node install.
  serverProc = spawn(process.execPath, [path.join(APP_DIR, 'scripts', 'next.mjs'), 'start'], {
    cwd: APP_DIR,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT, EC12_DATA_DIR: DATA_DIR, EC12_DIST_DIR: '.next-build' },
  });
  serverProc.on('exit', () => {
    serverProc = null;
    if (!quitting && mainWin) {
      dialog.showMessageBox(mainWin, { type: 'error', title: 'ECLucky13', message: 'The server stopped unexpectedly.', buttons: ['Restart', 'Quit'] })
        .then(({ response }) => { if (response === 0) { startServer(); waitForServer(mainWin); } else app.quit(); }).catch(() => {});
    }
  });
}

async function waitForServer(win, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(URL, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { win.loadURL(URL); return; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  win.webContents.executeJavaScript(`document.body.innerHTML='<h1>Server did not start</h1><p>Use the tray menu: Restart server, or Quit and relaunch.</p>'`).catch(() => {});
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 640,
    title: `ECLucky13 v${APP_VERSION}`,
    backgroundColor: '#04120a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });
  mainWin.loadURL(setupHtml('Starting ECLucky13…'));
  startServer();
  waitForServer(mainWin);
  mainWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  } catch (e) {
    console.error('tray icon unavailable, continuing without tray', e);
    return;
  }
  const ctx = Menu.buildFromTemplate([
    { label: `ECLucky13 v${APP_VERSION}`, enabled: false },
    { label: 'Open window', click: () => { mainWin.show(); } },
    { label: 'Restart server', click: () => { if (serverProc) serverProc.kill(); else { startServer(); if (mainWin) waitForServer(mainWin); } } },
    { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setToolTip(`ECLucky13 v${APP_VERSION}`);
  tray.setContextMenu(ctx);
  tray.on('click', () => { if (mainWin) { mainWin.isVisible() ? mainWin.hide() : mainWin.show(); } });
}

app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (needsSetup()) {
    setupWin = new BrowserWindow({ width: 760, height: 620, title: 'ECLucky13 setup', backgroundColor: '#04120a', autoHideMenuBar: true });
    setupWin.loadURL(setupHtml('ECLucky13 setup'));
    setupWin.webContents.on('did-finish-load', async () => {
      try {
        await firstRunSetup(setupWin);
        setupWin.close(); setupWin = null;
        createTray(); createMainWindow();
      } catch (err) {
        logLine(setupWin, 'SETUP FAILED: ' + (err && err.message || err));
        const { response } = await dialog.showMessageBox(setupWin, { type: 'error', title: 'ECLucky13 setup failed', message: String(err && err.message || err), buttons: ['Retry', 'Quit'] });
        if (response === 0) { try { await firstRunSetup(setupWin); setupWin.close(); setupWin = null; createTray(); createMainWindow(); } catch { app.quit(); } }
        else app.quit();
      }
    });
  } else {
    createTray(); createMainWindow();
  }
});

app.on('window-all-closed', () => { /* tray keeps running */ });
app.on('before-quit', () => {
  quitting = true;
  if (serverProc) { try { execFile('taskkill', ['/PID', String(serverProc.pid), '/F', '/T']); } catch { try { serverProc.kill(); } catch { /* gone */ } } }
});
