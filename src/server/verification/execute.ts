// Execute discovered checks. Zero executed applicable checks cannot produce "verified".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { VerificationCheck, VerificationResult, CheckStatus } from '@/shared/contracts';
import { runProcess } from '../tools/process';
import { workspaceRevision } from '../workspace/path-policy';
import type { DiscoveredCheck } from './discover';

const require_ = createRequire(import.meta.url);

async function killTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      killer.once('error', () => { try { process.kill(pid, 'SIGKILL'); } catch {} resolve(); });
      killer.once('close', (code) => { if (code) { try { process.kill(pid, 'SIGKILL'); } catch {} } resolve(); });
    });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = require_('node:net').createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', () => resolve(18080 + Math.floor(Math.random() * 500)));
  });
}

function chromiumPath(): string | null {
  try {
    const pw = require_('playwright-core');
    const exe = pw.chromium?.executablePath?.();
    return exe && fs.existsSync(exe) ? exe : null;
  } catch { return null; }
}

async function browserSmoke(workspace: string, files: string[]): Promise<{ status: CheckStatus; preview: string }> {
  if (!files.length) return { status: 'skipped', preview: 'no html files to check' };
  const pw = (() => { try { return require_('playwright-core'); } catch { return null; } })();
  if (!pw || !chromiumPath()) return { status: 'unavailable', preview: 'No runnable browser (playwright-core present without a browser binary, or not installed).' };
  let browser: any = null;
  const errors: string[] = [];
  const assertions: Array<{ file: string; title: string; textChars: number }> = [];
  try {
    browser = await pw.chromium.launch({ headless: true, executablePath: chromiumPath() });
    for (const f of files.slice(0, 5)) {
      const page = await browser.newPage();
      page.on('pageerror', (e: any) => errors.push(`${f}: ${String(e).slice(0, 140)}`));
      page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`${f}: ${m.text().slice(0, 140)}`); });
      await page.goto('file:///' + path.join(workspace, f).replace(/\\/g, '/'), { waitUntil: 'load', timeout: 15000 }).catch((e: any) => errors.push(`${f}: load ${String(e.message).slice(0, 120)}`));
      await page.waitForTimeout(500);
      // Minimal presence assertions: a usable page has a title or visible text.
      try {
        const title = await page.title();
        const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : '').trim().slice(0, 2000));
        assertions.push({ file: f, title: title || '(no title)', textChars: bodyText.length });
        if (!title && bodyText.length === 0) errors.push(`${f}: page has no title and no visible text`);
      } catch (e: any) { errors.push(`${f}: assertion ${String(e.message).slice(0, 120)}`); }
      await page.close();
    }
    return { status: errors.length ? 'failed' : 'passed', preview: [...assertions.map((a) => `${a.file}: title="${a.title.slice(0, 60)}" text=${a.textChars} chars`), ...errors].join(' | ').slice(0, 1500) || `loaded ${Math.min(files.length, 5)} page(s) with 0 errors` };
  } catch (e: any) {
    return { status: 'unavailable', preview: 'browser error: ' + String(e?.message || e).slice(0, 160) };
  } finally { try { await browser?.close(); } catch { /* ignore */ } }
}

async function bootAndProbe(workspace: string, check: DiscoveredCheck, port: number, signal?: AbortSignal) {
  if (signal?.aborted) return { ok: false, evidence: 'cancelled' };
  const env = { ...process.env, PORT: String(port), BROWSER: 'none' };
  let out = '';
  let stopped = false;
  let spawnError = '';
  const controller = new AbortController();
  const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(check.command);
  const child = spawn(isCmd ? 'cmd.exe' : check.command, isCmd ? ['/d', '/s', '/c', check.command, ...check.args] : check.args, {
    cwd: check.cwd || workspace, env, windowsHide: true, detached: process.platform !== 'win32',
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => { stopped = true; resolve(); }));
  child.on('error', (e) => { spawnError = e.message; stopped = true; controller.abort(); });
  child.on('exit', () => { stopped = true; controller.abort(); });
  child.stdout?.on('data', (d) => { out = (out + String(d)).slice(-20000); });
  child.stderr?.on('data', (d) => { out = (out + String(d)).slice(-20000); });
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    for (let i = 0; i < 20; i++) {
      if (signal?.aborted) return { ok: false, evidence: 'cancelled' };
      if (stopped) return { ok: false, evidence: spawnError || 'Process exited before readiness: ' + out.slice(-1500) };
      for (const endpoint of ['/health', '/']) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}${endpoint}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) });
          await r.body?.cancel();
          if (r.ok && !stopped && !signal?.aborted) return { ok: true, evidence: `HTTP ${r.status} ${endpoint}` };
        } catch {}
        if (controller.signal.aborted) break;
      }
      if (!controller.signal.aborted) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 1200);
        controller.signal.addEventListener('abort', done, { once: true });
      });
    }
    return { ok: false, evidence: 'Readiness attempts exhausted: ' + out.slice(-1500) };
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', onAbort);
    if (!stopped) await killTree(child.pid);
    await closed;
  }
}

export async function runVerification(workspace: string, checks: DiscoveredCheck[], signal: AbortSignal | undefined, onCheck: (c: VerificationCheck) => void): Promise<VerificationResult> {
  const revision = workspaceRevision(workspace);
  const results: VerificationCheck[] = [];

  for (const c of checks) {
    if (signal?.aborted) { const cc: VerificationCheck = { checkId: c.checkId, name: c.name, command: [c.command, ...c.args].join(' '), cwd: c.cwd, required: c.required, status: 'cancelled' }; results.push(cc); onCheck(cc); continue; }
    const started = Date.now();
    let rec: VerificationCheck;
    try {
      if (c.kind === 'browser') {
        const files = fs.readdirSync(workspace).filter((f) => f.endsWith('.html'));
        const r = await browserSmoke(workspace, files);
        rec = { checkId: c.checkId, name: c.name, command: '(browser)', cwd: c.cwd, required: c.required, status: r.status, durationMs: Date.now() - started, outputPreview: r.preview };
      } else if (c.kind === 'boot') {
        const port = await freePort();
        const r = await bootAndProbe(workspace, c, port, signal);
        rec = { checkId: c.checkId, name: c.name, command: [c.command, ...c.args].join(' '), cwd: c.cwd, required: c.required, status: r.ok ? 'passed' : 'failed', durationMs: Date.now() - started, outputPreview: r.evidence };
      } else {
        const r = await runProcess({ command: c.command, args: c.args, cwd: c.cwd, timeoutMs: 0, signal, label: c.checkId, env: { NODE_ENV: 'production' } });
        rec = { checkId: c.checkId, name: c.name, command: [c.command, ...c.args].join(' '), cwd: c.cwd, required: c.required, status: r.cancelled ? 'cancelled' : r.terminationReason === 'spawn-error' ? 'unavailable' : r.exitCode === 0 && !r.timedOut ? 'passed' : 'failed', exitCode: r.exitCode, durationMs: r.durationMs, outputPreview: (r.stderr || r.stdout || '').slice(-1500), artifactPath: r.artifactPath };
      }
    } catch (e: any) {
      rec = { checkId: c.checkId, name: c.name, command: [c.command, ...c.args].join(' '), cwd: c.cwd, required: c.required, status: 'unavailable', durationMs: Date.now() - started, outputPreview: String(e?.message || e).slice(0, 300) };
    }
    results.push(rec);
    onCheck(rec);
  }

  const anyFailed = results.some((r) => r.status === 'failed' || r.status === 'cancelled');
  const requiredMissing = results.some((r) => r.required && r.status !== 'passed');
  const anyPassed = results.some((r) => r.status === 'passed');
  let outcome: VerificationResult['outcome'];
  if (signal?.aborted || anyFailed) outcome = 'failed';
  else if (requiredMissing || !anyPassed) outcome = 'unverified';
  else outcome = 'verified';

  return { outcome, checks: results, revision };
}
