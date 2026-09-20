import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:3313';
const output = path.join(root, 'test-output');
mkdirSync(output, { recursive: true });
assert.ok((await fetch(base)).ok, 'Parent must start the rebuilt app first.');
const executablePath = [process.env.EDGE_PATH, chromium.executablePath(), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
const calls = [];
const ws = { id: 'ws_parity', path: 'E:\\parity-fixture' };
const ws2 = { id: 'ws_other', path: 'E:\\other-fixture' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const attachments = new Map();
const runs = [];
let attachmentSettings = { maxFiles: 20, maxFileBytes: 20971520, maxTotalBytes: 52428800, maxTextChars: 500000 };
const requestPayloads = new Map();
const supported = ['image/png', 'text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
let holdRun;
let releaseRun;
let releaseFile;
let fileFail = true;
page.on('pageerror', e => errors.push(e.message));
await context.addInitScript(ws => {
  localStorage.setItem('eclucky13.settings.v1', JSON.stringify({ workspace: ws, mode: 'ask', autoPrompt: { enabled: false, stages: [] }, provider: { model: 'fixture', modelSelection: 'pinned' } }));
  localStorage.setItem('eclucky13.session', 'ses_parity');
}, ws);
await page.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url()), p = url.pathname;
  const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (p === '/api/prompts') return json({ ok: true, files: [], appRoot: ws.path, appDir: ws.path });
  if (p === '/api/attachments' && req.method() !== 'POST') {
    if (req.method() === 'PATCH') { attachmentSettings = { ...attachmentSettings, ...req.postDataJSON() }; calls.push({ type: 'attachment-settings', body: structuredClone(attachmentSettings) }); }
    return json({ ok: true, settings: attachmentSettings, supported, unsupported: ['application/msword'] });
  }
  if (p === '/api/models') return json({ ok: true, models: ['fixture'], loaded: ['fixture'], catalog: {} });
  if (p === '/api/integrations') return json({ ok: true, details: {} });
  if (p === '/api/sessions') return json({ ok: true, sessions: [...new Set(runs.filter(r => r.workspaceId === url.searchParams.get('workspaceId')).map(r => r.sessionId))].map(id => ({ id, title: id, pinned: false, updatedAt: new Date().toISOString(), turnCount: 1 })) });
  if (p === '/api/workspaces') { calls.push({ type: 'workspace', body: req.postDataJSON() }); return json({ ok: true, workspace: ws2 }); }
  if (p === '/api/attachments' && req.method() === 'POST') {
    const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData();
    assert.ok([ws.id, ws2.id].includes(form.get('workspaceId')));
    const added = [];
    for (const file of form.getAll('files')) {
      const id = 'att_' + attachments.size;
      const item = { id, name: file.name, mime: file.type, size: file.size, url: '/api/attachments/' + id };
      attachments.set(id, { ...item, bytes: Buffer.from(await file.arrayBuffer()) }); added.push(item);
    }
    return json({ ok: true, attachments: added });
  }
  if (p.startsWith('/api/attachments/')) {
    const a = attachments.get(p.split('/').pop());
    return route.fulfill({ contentType: a.mime, headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}` }, body: a.bytes });
  }
  if (p === '/api/runs') {
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); calls.push({ type: 'run', body });
      const r = { id: 'run_' + runs.length, ...body, workspacePath: body.workspaceId === ws.id ? ws.path : ws2.path, state: runs.some(r => r.workspaceId === body.workspaceId && ['generating', 'queued'].includes(r.state)) ? 'queued' : 'generating', createdAt: new Date().toISOString() };
      runs.unshift(r);
      if (holdRun) { holdRun = false; await new Promise(resolve => { releaseRun = resolve; }); }
      return json({ ok: true, runId: r.id, sessionId: r.sessionId, state: r.state });
    }
    const list = runs.filter(r => !url.searchParams.has('sessionId') || r.sessionId === url.searchParams.get('sessionId'));
    return json({ ok: true, runs: list.slice(0, Number(url.searchParams.get('limit') || 1000)), nextBefore: null });
  }
  if (p.endsWith('/branch')) {
    const body = req.postDataJSON(); calls.push({ type: 'branch', body, source: p.split('/')[3] });
    return json({ ok: true, sessionId: 'ses_branch_' + calls.length, task: body.task, attachmentIds: runs.find(r => r.id === body.runId).attachmentIds });
  }
  if (p.startsWith('/api/runs/')) {
    const r = runs.find(r => r.id === p.split('/')[3]);
    if (p.endsWith('/cancel')) { r.state = 'cancelled'; calls.push({ type: 'cancel', id: r.id }); return json({ ok: true }); }
    if (p.includes('/artifacts/')) return route.fulfill({ contentType: 'application/x-ndjson', headers: { 'Content-Disposition': 'attachment; filename="complete.jsonl"' }, body: JSON.stringify({ type: 'output', data: 'COMPLETE OUTPUT WITHOUT PREVIEW ' + p.split('/').pop() }) + '\n' });
    if (p.includes('/requests/')) {
      const payload = requestPayloads.get(r.id + '/' + p.split('/').pop());
      if (!payload) return json({ ok: false, error: 'Not found' }, 404);
      return route.fulfill({ contentType: 'application/json', headers: { 'Content-Disposition': `attachment; filename="request-${p.split('/').pop()}.json"` }, body: JSON.stringify(payload, null, 2) });
    }
    if (p.endsWith('/events')) {
      const tools = ['main', 'review'].flatMap((scope) => {
        const toolCallId = r.id + '_' + scope;
        const stage = scope === 'review' ? { phase: 'stage', stageId: 'review', stageAttempt: 1 } : {};
        return [['tool.started', { toolCallId, name: scope + '_fixture', argsPreview: '{}', ...stage }], ['tool.finished', { toolCallId, ok: true, durationMs: 1, artifactId: 'out_' + scope, downloadUrl: `/api/runs/${r.id}/artifacts/out_${scope}`, ...(scope === 'review' ? { processArtifactId: 'out_process', processArtifactUrl: `/api/runs/${r.id}/artifacts/out_process` } : {}), ...stage }]];
      });
      const events = [['run.created', { task: r.task }], ['assistant.delta', { text: 'Reply for ' + r.task }], ['request.started', { messages: [{ role: 'user', content: r.task }], maxTokens: 8192 }], ...tools, ['run.state', { state: r.state }]].map(([type, data], i) => ({ type, data, eventId: r.id + '_' + i, sequence: i + 1, sessionId: r.sessionId, runId: r.id }));
      for (const e of events) if (e.type === 'request.started') requestPayloads.set(r.id + '/' + e.eventId, e.data);
      return route.fulfill({ contentType: 'text/event-stream', body: events.filter(e => e.sequence > Number(url.searchParams.get('after') || 0)).map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
    }
    return json({ ok: true, run: r });
  }
  if (p.startsWith('/api/files/')) {
    if (url.searchParams.has('tree')) return json({ ok: true, tree: [{ name: 'hello.ts', path: 'hello.ts', type: 'file' }] });
    await new Promise(resolve => { releaseFile = resolve; });
    return json(fileFail ? { ok: false, error: 'Fixture read failed. Retry.' } : { ok: true, content: 'export const hello = 13;', hash: 'fixture' }, fileFail ? 503 : 200);
  }
  throw new Error('Unmocked request: ' + req.method() + ' ' + p);
});
const wait = async (fn, message) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  assert.fail(message);
};
const composer = page.locator('.composer-bar textarea');
const tasks = () => page.getByRole('button', { name: /^Tasks ·/ }).click();
try {
  await page.goto(base);
  assert.match(await page.locator('.brand').textContent(), /1\.25/, 'Parent must rebuild/start v1.25; the running app is stale.');
  await wait(async () => !(await page.getByRole('button', { name: 'Attach files' }).isDisabled()), 'Hydration did not finish');
  const openLimits = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'limits', exact: true }).click();
    await page.getByLabel('Max files per upload', { exact: true }).waitFor();
  };
  await openLimits();
  const limitsPanel = page.locator('.attachments-settings');
  for (const mime of supported) assert.ok((await limitsPanel.innerText()).includes(mime));
  const values = [7, 1048576, 4194304, 120000];
  for (const [i, label] of ['Max files per upload', 'Max size per file (bytes)', 'Max total upload size (bytes)', 'Max text characters per document'].entries()) await page.getByLabel(label, { exact: true }).fill(String(values[i]));
  await page.getByRole('button', { name: 'Save attachment limits', exact: true }).click();
  await page.getByText('Attachment limits saved.', { exact: true }).waitFor();
  assert.deepEqual(Object.values(calls.find(c => c.type === 'attachment-settings').body), values);
  await page.reload(); await openLimits();
  assert.deepEqual(await page.locator('.attachments-settings input').evaluateAll(inputs => inputs.map(el => Number(el.value))), values);
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles([{ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('DOCUMENT CONTENT') }, { name: 'screen.png', mimeType: 'image/png', buffer: png }]);
  await wait(async () => await page.locator('.attachment-card').count() === 2, 'Upload missing');
  await page.getByRole('button', { name: 'Preview note.txt', exact: true }).click();
  await wait(async () => (await page.locator('.attachment-preview').textContent()).includes('DOCUMENT CONTENT'), 'Document preview missing');
  await wait(async () => page.locator('.attachment-card img').evaluate(el => el.naturalWidth > 0), 'Image preview failed');
  await page.getByRole('button', { name: 'Remove screen.png' }).click();
  for (const kind of ['paste', 'drop']) {
    await page.locator('.composer-bar').evaluate((el, kind) => {
      const data = new DataTransfer(); data.items.add(new File(['extra text'], kind + '.txt', { type: 'text/plain' }));
      if (kind === 'paste') el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      else { el.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); }
    }, kind);
    await page.getByRole('button', { name: 'Remove ' + kind + '.txt' }).waitFor();
  }
  holdRun = true;
  await composer.fill('Alpha'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await wait(() => !!releaseRun, 'POST not held'); await composer.fill('Beta draft'); releaseRun();
  await wait(async () => (await page.locator('.ev.assistant').textContent()).includes('Reply for Alpha'), 'Replay missing');
  assert.equal(await composer.inputValue(), 'Beta draft');
  assert.equal(calls.find(c => c.type === 'run').body.attachmentIds.length, 3);
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  assert.equal(await page.locator('#agent-activity .tool-out').count(), 0);
  const artifactContract = async (link, artifactId) => {
    assert.ok(await link.isVisible());
    const href = await link.getAttribute('href');
    assert.equal(href, `/api/runs/${runs.find(r => r.task === 'Alpha').id}/artifacts/${artifactId}`);
    assert.equal(await link.getAttribute('download'), artifactId + '.jsonl');
    const response = await page.evaluate(async href => {
      const response = await fetch(href);
      return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), text: await response.text() };
    }, href);
    assert.equal(response.status, 200);
    assert.equal(response.type, 'application/x-ndjson');
    assert.equal(response.disposition, 'attachment; filename="complete.jsonl"');
    assert.equal(response.text, JSON.stringify({ type: 'output', data: 'COMPLETE OUTPUT WITHOUT PREVIEW ' + artifactId }) + '\n');
  };
  for (const scope of ['main', 'review']) {
    const card = page.locator('#agent-activity .tool-card', { hasText: scope + '_fixture' });
    await artifactContract(card.getByRole('link', { name: 'Download complete output', exact: true }), 'out_' + scope);
  }
  await artifactContract(page.getByRole('link', { name: 'Download complete process output', exact: true }), 'out_process');
  await page.locator('#agent-activity .request-row summary').first().click();
  const payloadHref = await page.getByRole('link', { name: 'Download payload', exact: true }).getAttribute('href');
  assert.match(payloadHref, new RegExp(`^/api/runs/${runs.find(r => r.task === 'Alpha').id}/requests/`));
  const payloadResponse = await page.evaluate(async href => {
    const response = await fetch(href);
    return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), text: await response.text() };
  }, payloadHref);
  assert.equal(payloadResponse.status, 200);
  assert.match(payloadResponse.type, /application\/json/);
  assert.match(payloadResponse.disposition, /^attachment; filename="request-.*\.json"$/);
  assert.ok(payloadResponse.text.includes('Alpha'), 'Request payload does not carry the prompt');
  // The endpoint download is asserted via fetch above (status/headers/content), matching
  // this file's artifactContract precedent: same-origin intercepted link downloads do not
  // complete under route.fulfill in Chromium (download starts with no request and is
  // canceled), while data: URLs and cross-origin links do. Real browsers hit the live
  // endpoint, which serves the same headers verified here.
  assert.equal(await page.getByRole('link', { name: 'Download payload', exact: true }).getAttribute('download'), 'request-1.json');
  await page.getByRole('tab', { name: 'Auto-prompts', exact: true }).click();
  assert.equal(await page.locator('#agent-autoprompts input:not(:disabled)').count(), 0);
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await tasks(); await page.getByRole('button', { name: 'New independent task' }).click();
  await composer.fill('Queued'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await wait(() => runs.some(r => r.task === 'Queued'), 'Independent run absent');
  assert.notEqual(runs[0].sessionId, runs[1].sessionId); assert.equal(runs[0].state, 'queued');
  await page.locator('.ws-chip').click(); const dialog = page.getByRole('dialog', { name: 'Choose workspace' });
  await wait(async () => dialog.locator('input').evaluate(el => el === document.activeElement), 'Workspace focus missing');
  await dialog.locator('input').fill(ws2.path); await dialog.getByRole('button', { name: 'Open folder' }).click();
  await composer.fill('Parallel'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await wait(() => runs.some(r => r.task === 'Parallel'), 'Parallel run absent'); assert.equal(runs[0].workspaceId, ws2.id);
  await tasks(); await page.locator('.task-card', { hasText: 'Alpha' }).getByRole('button', { name: 'Open task' }).click();
  await wait(async () => (await page.locator('.ev.assistant').textContent()).includes('Reply for Alpha'), 'Opening task did not replay');
  assert.equal(await composer.inputValue(), 'Beta draft');
  await tasks(); await page.locator('.task-card', { hasText: 'Queued' }).getByRole('button', { name: 'Cancel queued task' }).click();
  await wait(() => calls.some(c => c.type === 'cancel'), 'Queued cancel absent');
  await page.getByRole('button', { name: 'Close tasks' }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('tab', { name: 'Files', exact: true }).click(); await page.getByRole('button', { name: 'Open file hello.ts' }).click();
  await wait(() => !!releaseFile, 'File read absent'); await page.getByText('Loading hello.ts…', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled()); releaseFile();
  await page.getByRole('button', { name: 'Retry opening file' }).waitFor(); fileFail = false; releaseFile = null;
  await page.getByRole('button', { name: 'Retry opening file' }).click(); await wait(() => !!releaseFile, 'Retry absent'); releaseFile();
  await page.locator('.cm-editor').waitFor(); assert.equal(await page.locator('.tabs button button').count(), 0);
  await page.getByRole('button', { name: 'Close hello.ts' }).focus(); await page.keyboard.press('Enter');
  await wait(async () => await page.locator('.cm-editor').count() === 0, 'Keyboard close failed');
  const separator = page.getByRole('separator', { name: 'Resize sidebar' });
  const previous = await separator.getAttribute('aria-valuenow'); await separator.focus(); await page.keyboard.press('ArrowRight');
  assert.notEqual(await separator.getAttribute('aria-valuenow'), previous);
  await tasks(); await page.locator('.task-card', { hasText: 'Alpha' }).getByRole('button', { name: 'Open task' }).click();
  await page.getByRole('button', { name: 'Edit & branch from before this turn' }).last().click();
  await page.locator('#branch-task').fill('Edited Alpha'); await page.getByRole('button', { name: 'Create branched session' }).click();
  await wait(() => runs.some(r => r.task === 'Edited Alpha'), 'Edited branch absent');
  const branchCall = calls.find(c => c.type === 'branch'); assert.equal(branchCall.body.runId, runs.find(r => r.task === 'Alpha').id); assert.equal(branchCall.body.retry, false);
  await wait(async () => await page.getByRole('button', { name: 'Retry from here' }).count() > 0, 'Retry action absent');
  await page.getByRole('button', { name: 'Retry from here' }).last().click(); await page.getByRole('button', { name: 'Retry in new session' }).click();
  await wait(() => calls.filter(c => c.type === 'branch').length === 2, 'Retry branch absent');
  assert.equal(calls.filter(c => c.type === 'branch')[1].body.retry, true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'lucky-parity-ui.png') });
  writeFileSync(path.join(output, 'lucky-parity-results.json'), JSON.stringify({ passed: true, mockedAPIs: true, checks: ['attachment settings edit/save/reload', 'main/stage/process artifact link + mocked fetch headers/content without preview (not browser download; real click covered by lucky-settings-live.mjs)', 'separate request payload download', 'upload/preview/remove', 'paste/drop', 'late POST draft preservation', 'independent/queued/parallel tasks', 'event replay', 'branch/edit/retry', 'keyboard/focus/loading/error'], pageErrors: errors }, null, 2));
  console.log('PARITY_UI_PASS: attachments, tasks, branch APIs, keyboard, loading/error; mocked APIs, real Chromium');
} finally { await browser.close(); }
