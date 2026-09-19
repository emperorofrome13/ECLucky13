import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:3313';
assert.ok((await fetch(base)).ok, 'Parent must build and start the app before this test.');
const output = path.join(root, 'test-output');
fs.mkdirSync(output, { recursive: true });
const workspacePath = fs.mkdtempSync(path.join(output, 'lucky-settings-live-'));
fs.writeFileSync(path.join(workspacePath, 'evidence.txt'), 'LIVE COMPLETE TOOL OUTPUT\n');
const api = async (endpoint, method = 'GET', body) => {
  const response = await fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.headers.get('content-type')?.includes('application/json'), `${method} ${endpoint}: HTTP ${response.status}, non-JSON response. Parent must rebuild/start v1.16; the running app may be stale.`);
  const data = await response.json();
  assert.ok(response.ok && data.ok, `${method} ${endpoint}: ${data.error || response.status}`);
  return data;
};
const wait = async (fn, message) => {
  const end = Date.now() + 60000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail(message);
};
const originalLimits = (await api('/api/attachments')).settings;
const originalServers = (await api('/api/mcp-servers')).servers;
const requests = [];
const rpcCalls = [];
const fixtureErrors = [];
const runIds = [];
const checks = [];
const cleanupErrors = [];
let releaseBackground;
const fixture = http.createServer(async (req, res) => {
  try {
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.url === '/mcp') {
      if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
      let raw = ''; for await (const chunk of req) raw += chunk;
      const message = JSON.parse(raw); rpcCalls.push(message.method);
      if (message.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      const result = message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lucky-live-fixture', version: '1.0' } } : { tools: [{ name: 'echo', description: 'Local acceptance fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }] };
      return json({ jsonrpc: '2.0', id: message.id, result });
    }
    if (req.method === 'GET') return json({ data: [{ id: 'lucky-live-model', state: 'loaded', max_context_length: 32000 }] });
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    if (JSON.stringify(body.messages).includes('BACKGROUND HOLD')) await new Promise(resolve => { releaseBackground = resolve; });
    const called = body.messages.some(message => message.role === 'tool');
    const message = called ? { role: 'assistant', content: 'LIVE FIXTURE ANSWER: documents and image received.' } : { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + crypto.randomUUID(), type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'evidence.txt' }) } }] };
    return json({ choices: [{ message, finish_reason: called ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  } catch (error) { fixtureErrors.push(error.message); res.writeHead(500); res.end('Fixture failed'); }
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const fixtureBase = `http://127.0.0.1:${fixture.address().port}`;
const executablePath = [process.env.EDGE_PATH, chromium.executablePath(), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => p && fs.existsSync(p));
let browser;
let page;
let mcpId;
let failure;
const pageErrors = [];
const name = 'Lucky live ' + Date.now();
const bgTask = 'BACKGROUND HOLD ' + Date.now();
const fields = ['Max files per upload', 'Max size per file (bytes)', 'Max total upload size (bytes)', 'Max text characters per document'];
const openSettings = async tab => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: tab, exact: true }).click();
};
const closeSettings = () => page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
const saveLimits = async values => {
  for (const [i, field] of fields.entries()) await page.getByLabel(field, { exact: true }).fill(String(values[i]));
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/attachments' && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save attachment limits', exact: true }).click();
  assert.ok((await saved).ok());
  await page.getByText('Attachment limits saved.', { exact: true }).waitFor();
};
const pdfFixture = () => {
  const stream = 'BT /F1 12 Tf 20 100 Td (LIVE PDF DOCUMENT CONTENT) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
};
try {
  const workspace = (await api('/api/workspaces', 'POST', { path: workspacePath })).workspace;
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', async response => {
    if (new URL(response.url()).pathname === '/api/runs' && response.request().method() === 'POST') {
      const data = await response.json().catch(() => ({})); if (data.runId) runIds.push(data.runId);
    }
  });
  await context.addInitScript(({ workspace, fixtureBase }) => {
    if (localStorage.getItem('lucky-live-initialized')) return;
    localStorage.setItem('lucky-live-initialized', '1');
    localStorage.setItem('eclucky13.settings.v1', JSON.stringify({ workspace, mode: 'ask', provider: { preset: 'custom', baseUrl: fixtureBase + '/v1', model: 'lucky-live-model', modelSelection: 'pinned', autoModelLimits: false, contextWindow: 32000, maxTokens: 1000 }, agent: { maxIterations: 6 }, autoPrompt: { enabled: false, stages: [] }, contextTools: { ponytail: false, codegraph: false, skills: false, search: false, rtk: false, context7: false } }));
    localStorage.setItem('eclucky13.session', 'live_' + Date.now());
  }, { workspace, fixtureBase });
  await page.goto(base);
  await page.getByRole('button', { name: 'Attach files', exact: true }).waitFor();
  assert.match(await page.locator('.brand').innerText(), /1\.21/);
  await openSettings('MCP servers');
  await page.getByRole('button', { name: 'Add MCP server', exact: true }).click();
  await page.getByLabel('Server name', { exact: true }).fill(name);
  await page.getByLabel('Transport', { exact: true }).selectOption('http');
  await page.getByLabel('Streamable HTTP endpoint', { exact: true }).fill(fixtureBase + '/mcp');
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/mcp-servers' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save server', exact: true }).click();
  const createdData = await (await created).json(); assert.ok(createdData.ok); mcpId = createdData.server.id;
  const card = () => page.locator('div').filter({ has: page.locator('strong', { hasText: name }) }).filter({ has: page.getByRole('button', { name: 'Test connection', exact: true }) }).last();
  await card().getByRole('button', { name: 'Test connection', exact: true }).click();
  await page.getByText('Connection and tool discovery passed: 1 tools. No tool was executed.', { exact: true }).waitFor();
  assert.ok(rpcCalls.includes('initialize') && rpcCalls.includes('tools/list'));
  await card().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Server name', { exact: true }).fill(name + ' edited');
  await page.locator('#mcp-limit-timeoutMs').fill('12345');
  await page.getByRole('button', { name: 'Save server', exact: true }).click();
  await wait(async () => (await api('/api/mcp-servers')).servers.some(s => s.id === mcpId && s.name === name + ' edited' && s.limits.timeoutMs === 12345), 'MCP edit did not persist');
  await page.reload(); await openSettings('MCP servers');
  await card().getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('#mcp-limit-timeoutMs').inputValue(), '12345');
  await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
  await card().getByRole('button', { name: 'Delete', exact: true }).click();
  await wait(async () => !(await api('/api/mcp-servers')).servers.some(s => s.id === mcpId), 'MCP UI deletion did not persist');
  mcpId = undefined; checks.push('real MCP UI create/test/edit/reload/delete');
  await closeSettings(); await openSettings('limits');
  const changed = [9, 2097152, 8388608, 123456];
  await saveLimits(changed);
  assert.deepEqual(Object.values((await api('/api/attachments')).settings), changed);
  await page.reload(); await openSettings('limits');
   await page.getByLabel('Max files per upload', { exact: true }).waitFor();
   assert.deepEqual(await page.locator('.attachments-settings input').evaluateAll(inputs => inputs.map(input => Number(input.value))), changed);
  const supportedText = await page.locator('.attachments-settings').innerText();
  assert.ok(supportedText.includes('application/pdf') && supportedText.includes('wordprocessingml.document'));
  checks.push('real attachment limits UI save/backend/reload');
  await closeSettings();
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>LIVE DOCX DOCUMENT CONTENT</w:t></w:r></w:p></w:body></w:document>');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (await chooser).setFiles([{ name: 'live.txt', mimeType: 'text/plain', buffer: Buffer.from('LIVE TEXT DOCUMENT CONTENT') }, { name: 'live.pdf', mimeType: 'application/pdf', buffer: pdfFixture() }, { name: 'live.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }, { name: 'live.png', mimeType: 'image/png', buffer: png }]);
  await wait(async () => await page.locator('.composer-attachments .attachment-card').count() === 4, 'Real upload failed');
  await page.getByRole('button', { name: 'Preview live.txt', exact: true }).click();
  await wait(async () => (await page.locator('.attachment-preview').innerText()).includes('LIVE TEXT DOCUMENT CONTENT'), 'Text preview did not load');
  await wait(async () => page.locator('.attachment-card img').evaluate(image => image.naturalWidth > 0), 'Image did not render');
  await page.locator('.composer-bar textarea').fill('Read evidence.txt and inspect all four attachments.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await wait(() => requests.length > 0 && runIds.length > 0, 'No actual provider request');
  const wire = requests[0].messages.flatMap(message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]);
  const text = wire.filter(part => part.type === 'text').map(part => part.text).join('\n');
  for (const kind of ['TEXT', 'PDF', 'DOCX']) assert.ok(text.includes('LIVE ' + kind + ' DOCUMENT CONTENT'), kind + ' not in provider body');
  assert.ok(wire.some(part => part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,' + png.toString('base64')));
  await wait(async () => (await api('/api/runs/' + runIds[0])).run.finalText?.includes('LIVE FIXTURE ANSWER'), 'Real run did not complete');
  checks.push('real upload text/PDF/DOCX/image and controlled provider wire body');
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download complete output', exact: true }).first().click();
  const download = await downloading; assert.equal(await download.failure(), null);
  const stream = await download.createReadStream(); let full = ''; for await (const chunk of stream) full += chunk;
  assert.ok(full.includes('LIVE COMPLETE TOOL OUTPUT')); checks.push('real output artifact UI download');
  await page.getByRole('button', { name: 'Edit & branch from before this turn', exact: true }).last().click();
  await page.locator('#branch-task').fill('Branch acceptance: read evidence.txt.');
  await page.getByRole('button', { name: 'Create branched session', exact: true }).click();
  await wait(() => runIds.length === 2, 'Branch did not submit a real run');
  await wait(async () => (await api('/api/runs/' + runIds[1])).run.finalText?.includes('LIVE FIXTURE ANSWER'), 'Branched run did not complete');
  const original = (await api('/api/runs/' + runIds[0])).run;
  const branched = (await api('/api/runs/' + runIds[1])).run;
  assert.notEqual(original.sessionId, branched.sessionId); assert.deepEqual(branched.attachmentIds, original.attachmentIds);
  checks.push('real edit/branch submit and attachment retention');
  await page.getByRole('button', { name: /^Tasks ·/ }).click();
  await page.getByRole('button', { name: 'New independent task', exact: true }).click();
  await page.locator('.composer-bar textarea').fill(bgTask); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await wait(() => !!releaseBackground && runIds.length === 3, 'Background provider request missing');
  await page.getByRole('button', { name: /^Tasks ·/ }).click();
  await page.getByRole('button', { name: 'New independent task', exact: true }).click();
  assert.ok(['generating', 'running'].includes((await api('/api/runs/' + runIds[2])).run.state));
  await page.getByRole('button', { name: /^Tasks ·/ }).click();
  // The task text is unique per run and we wait for exactly one card: older suite runs
  // reuse this task family in the shared data dir, and the 3s task poller can lag the send.
  await wait(async () => await page.locator('.task-card', { hasText: bgTask }).count() === 1, 'Background task card missing or ambiguous');
  await page.locator('.task-card', { hasText: bgTask }).getByRole('button', { name: 'Open task', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  releaseBackground(); releaseBackground = undefined;
  await wait(async () => (await api('/api/runs/' + runIds[2])).run.state === 'cancelled', 'Background task did not cancel');
  checks.push('real background task survives switching, reopens and stops');
  await openSettings('limits'); await saveLimits(Object.values(originalLimits)); await closeSettings();
  assert.deepEqual((await api('/api/attachments')).settings, originalLimits);
  assert.deepEqual((await api('/api/mcp-servers')).servers, originalServers);
  assert.deepEqual(pageErrors, []); assert.deepEqual(fixtureErrors, []);
  await page.screenshot({ path: path.join(workspacePath, 'acceptance.png'), fullPage: true });
} catch (error) {
  failure = error;
  if (page) { await page.screenshot({ path: path.join(workspacePath, 'failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(workspacePath, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Unavailable')); }
} finally {
  releaseBackground?.();
  for (const id of runIds) await api('/api/runs/' + id + '/cancel', 'POST').catch(() => {});
  await api('/api/attachments', 'PATCH', originalLimits).catch(error => cleanupErrors.push(error.message));
  const servers = await api('/api/mcp-servers').catch(error => { cleanupErrors.push(error.message); return { servers: [] }; });
  for (const server of servers.servers.filter(server => server.id === mcpId || (!originalServers.some(original => original.id === server.id) && server.name.startsWith(name)))) await api('/api/mcp-servers?id=' + encodeURIComponent(server.id), 'DELETE').catch(error => cleanupErrors.push(error.message));
  await api('/api/attachments').then(data => assert.deepEqual(data.settings, originalLimits)).catch(error => cleanupErrors.push(error.message));
  await api('/api/mcp-servers').then(data => assert.deepEqual(data.servers, originalServers)).catch(error => cleanupErrors.push(error.message));
  await browser?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  fs.writeFileSync(path.join(workspacePath, 'results.json'), JSON.stringify({ passed: !failure && !cleanupErrors.length, mockedAppAPIs: false, controlledLocalModel: true, checks, runIds, providerRequests: requests.length, rpcCalls, pageErrors, fixtureErrors, cleanupErrors, failure: failure?.message }, null, 2));
}
if (failure) throw failure;
assert.deepEqual(cleanupErrors, []);
console.log('SETTINGS_LIVE_PASS', JSON.stringify({ checks, evidence: workspacePath }));
