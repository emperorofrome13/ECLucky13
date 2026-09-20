import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3313';
const output = path.join(root, 'test-output');
mkdirSync(output, { recursive: true });
const executablePath = [process.env.EDGE_PATH, process.env.PLAYWRIGHT_EXECUTABLE_PATH, chromium.executablePath(), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((candidate) => candidate && existsSync(candidate));
assert.ok(executablePath, 'Install a Playwright browser or set EDGE_PATH to msedge.exe.');
const readiness = await fetch(baseURL, { signal: AbortSignal.timeout(10000) }).catch(() => null);
assert.ok(readiness?.ok, `Parent must start ECLucky13 before verification: ${baseURL}`);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const results = [];
const models = Array.from({ length: 36 }, (_, i) => `${i % 2 ? 'vendor-b' : 'vendor-a'}/model-${String(i).padStart(2, '0')}`);
const workspace = { id: 'ws_lucky_ui', path: 'E:\\lucky-ui-fixture' };
const summary = { outcome: 'unverified', model: models[0], filesChanged: [], checks: [], stages: [], remaining: ['No checks were run.'] };
const runs = [
  { id: 'run_lucky_latest', sessionId: 'ses_lucky_ui', workspaceId: workspace.id, task: 'LUCKY_USER_LATEST', finalText: 'LUCKY-ASSISTANT-LATEST', state: 'succeeded', createdAt: '2026-09-17T10:01:00.000Z', summary },
  { id: 'run_lucky_earlier', sessionId: 'ses_lucky_ui', workspaceId: workspace.id, task: 'LUCKY_USER_EARLIER', finalText: 'LUCKY-ASSISTANT-EARLIER\n\n```js\nconst longLine = "' + 'x'.repeat(300) + '";\n```', state: 'succeeded', createdAt: '2026-09-17T10:00:00.000Z', summary },
];
const promptFiles = [
  { name: 'AGENTS.md', label: 'App instructions', content: 'Original app instructions\n' + 'Readable prompt line\n'.repeat(80), source: 'app', writable: true },
  { name: 'review', label: 'Review stage', content: 'Original review prompt', source: 'app', writable: true },
];
let releaseSave;
let capturedSave;
let failSave = false;
const unexpectedRequests = [];
await context.addInitScript(({ workspace, model }) => {
  localStorage.setItem('eclucky13.settings.v1', JSON.stringify({ workspace, provider: { model, modelSelection: 'pinned', autoModelLimits: false }, recentModels: [], hiddenModels: [], hideVariants: false }));
  localStorage.setItem('eclucky13.session', 'ses_lucky_ui');
}, { workspace, model: models[0] });
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (url.pathname === '/api/models') return json({ ok: true, models, loaded: [models[0], models[1]], catalog: {} });
  if (url.pathname === '/api/integrations') return json({ ok: true, browser: true, editor: 'CodeMirror', details: {} });
  if (url.pathname === '/api/sessions') return json({ ok: true, sessions: [{ id: 'ses_lucky_ui', title: 'Browser fixture', pinned: false, updatedAt: runs[0].createdAt, turnCount: 2, originalTask: runs[1].task }] });
  if (url.pathname === '/api/runs') return json({ ok: true, runs, hasMore: false, nextBefore: null });
  if (/\/api\/runs\/[^/]+\/events$/.test(url.pathname)) {
    const data = [
      ['run.created', { task: runs[0].task }],
      ['request.started', { requestId: 'req_lucky_1', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], tools: [{ name: 'tool_a' }, { name: 'tool_b' }, { name: 'tool_c' }], maxTokens: 1000 }],
      ['assistant.delta', { text: runs[0].finalText }],
      ['usage', { requestId: 'req_lucky_1', usage: { promptTokens: 48210, completionTokens: 3120, totalTokens: 51330 } }],
      ['reasoning.delta', { text: 'Readable reasoning fixture.' }],
      ['request.finished', { requestId: 'req_lucky_1', usageStatus: 'reported', completed: true, cancelled: false }],
      ['run.finished', { summary }],
    ].map(([type, data], index) => ({ type, data, eventId: `lucky_event_${index}`, sequence: index + 1, runId: runs[0].id, sessionId: 'ses_lucky_ui' }));
    const after = Number(url.searchParams.get('after') || 0);
    return route.fulfill({ contentType: 'text/event-stream', body: data.filter((event) => event.sequence > after).flatMap((event) => [`data: ${JSON.stringify(event)}\n\n`, `data: ${JSON.stringify(event)}\n\n`]).join('') });
  }
  if (url.pathname.startsWith('/api/runs/')) return json({ ok: true, run: runs[0], changes: [] });
  if (url.pathname === '/api/prompts') {
    if (request.method() === 'GET') return json({ ok: true, files: promptFiles, appRoot: 'E:/lucky-ui-fixture', appDir: 'E:/lucky-ui-fixture/autoprompts' });
    capturedSave = request.postDataJSON();
    await new Promise((resolve) => { releaseSave = resolve; });
    releaseSave = undefined;
    return json(failSave ? { ok: false, error: 'Fixture save unavailable; retry.' } : { ok: true, file: capturedSave.name }, failSave ? 503 : 200);
  }
  if (url.pathname.startsWith('/api/files/')) return json(url.searchParams.has('tree') ? { ok: true, tree: [{ name: 'src', path: 'src', type: 'dir', children: [{ name: 'hello.ts', path: 'src/hello.ts', type: 'file' }] }] } : { ok: true, content: 'export const hello = 13;\n', hash: 'fixture-hash' });
  if (url.pathname === '/api/exec') return json({ ok: true, commandOk: true, output: 'LUCKY_MANUAL_OUTPUT', exitCode: 0, durationMs: 1, workspaceChanges: 0, reconciliation: { ok: true, complete: true, skipped: 0 } });
  unexpectedRequests.push(`${request.method()} ${url.pathname}`);
  return json({ ok: false, error: 'Unmocked fixture endpoint' }, 400);
});
async function eventually(check, message) {
  const deadline = Date.now() + 12000;
  do { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } while (Date.now() < deadline);
  assert.fail(message);
}
async function test(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); await page.screenshot({ path: path.join(output, `lucky-ui-failure-${results.length}.png`), fullPage: true }).catch(() => {}); }
}
async function noOverflow() {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page has horizontal overflow');
}
async function inViewport(locator, minimumHeight = 1) {
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  assert.ok(box && box.width > 0 && box.height >= minimumHeight && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, `Clipped or undersized: ${locator}`);
}
try {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  await test('Prompt editor layouts, own scrolling, header and footer', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Prompt Studio', exact: true }).click();
    await page.locator('#prompt-content').waitFor();
    await eventually(async () => !(await page.locator('#prompt-content').isDisabled()), 'Prompt did not load');
    for (const [width, height] of [[1280, 800], [800, 700]]) {
      await page.setViewportSize({ width, height });
      await inViewport(page.locator('#prompt-content'), 120);
      await inViewport(page.locator('.drawer-head'));
      await inViewport(page.locator('.drawer-foot'));
      await noOverflow();
      assert.equal(await page.locator('.prompts-split').evaluate((el) => getComputedStyle(el).display), 'grid');
      if (width === 1280) assert.match(await page.locator('.prompts-split').evaluate((el) => getComputedStyle(el).gridTemplateColumns), /^260px /);
      if (width === 800) assert.ok(await page.locator('.prompt-source-select').isVisible());
      await page.locator('#prompt-content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      assert.ok(await page.locator('#prompt-content').evaluate((el) => el.scrollTop > 0));
      await page.screenshot({ path: path.join(output, `lucky-ui-prompts-${width}x${height}.png`) });
    }
  });
  await test('Prompt drafts retain newer edits, source and tab switches, failed save', async () => {
    await page.locator('#prompt-content').fill('Draft submitted');
    await page.getByRole('button', { name: 'Save prompt', exact: true }).click();
    await eventually(() => !!releaseSave, 'Save request not captured');
    assert.equal(capturedSave.content, 'Draft submitted');
    await page.locator('#prompt-content').fill('Newer draft retained');
    releaseSave();
    await eventually(async () => (await page.locator('#prompt-save-status').textContent()).includes('Newer edits'), 'Newer edit save status missing');
    await page.locator('.prompt-source-select').selectOption('review');
    await page.locator('#prompt-content').fill('Review draft retained');
    await page.locator('.prompt-source-select').selectOption('AGENTS.md');
    assert.equal(await page.locator('#prompt-content').inputValue(), 'Newer draft retained');
    await page.getByRole('button', { name: 'server', exact: true }).click();
    await page.getByRole('button', { name: 'Prompt Studio', exact: true }).click();
    assert.equal(await page.locator('#prompt-content').inputValue(), 'Newer draft retained');
    failSave = true;
    await page.getByRole('button', { name: 'Save prompt', exact: true }).click();
    await eventually(() => !!releaseSave, 'Second save not captured');
    releaseSave();
    await eventually(async () => (await page.locator('#prompt-save-status').textContent()).includes('Save failed'), 'Save failure not visible');
    assert.equal(await page.locator('#prompt-content').inputValue(), 'Newer draft retained');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Return to drafts' }).waitFor();
    assert.ok(await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible());
    await page.getByRole('button', { name: 'Discard drafts and close' }).click();
  });
  await test('Settings focus trap and restoration', async () => {
    const opener = page.getByRole('button', { name: 'Settings', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('button', { name: 'Done', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
    await page.keyboard.press('Shift+Tab');
    assert.ok(await dialog.getByRole('button', { name: 'Done', exact: true }).evaluate((el) => el === document.activeElement));
    await page.keyboard.press('Escape');
    assert.ok(await opener.evaluate((el) => el === document.activeElement));
  });
  await test('Model search, grouped keyboard order, scope and hide buttons', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.model-browse').click();
    const search = page.getByRole('textbox', { name: 'Search models', exact: true });
    const selected = page.getByRole('textbox', { name: 'Selected model ID', exact: true });
    const initial = await selected.inputValue();
    await search.fill('model-35');
    assert.equal(await selected.inputValue(), initial);
    await search.fill('');
    assert.ok(await page.locator('.model-group').count() > 1);
    await search.press('ArrowDown');
    const expected = await page.locator('.model-row.hi .model-id').textContent();
    await search.press('Enter');
    assert.equal(await selected.inputValue(), expected);
    await page.locator('.model-browse').click();
    await page.getByRole('button', { name: 'all', exact: true }).press('Enter');
    await search.focus();
    for (let i = 0; i < 30; i++) await search.press('ArrowDown');
    await search.fill('model-35');
    assert.equal(await page.locator('.model-row.hi').count(), 1);
    await search.press('Enter');
    assert.equal(await selected.inputValue(), models[35]);
    await page.locator('.model-browse').click();
    await page.getByRole('button', { name: 'all', exact: true }).press('Enter');
    await page.getByRole('button', { name: `Hide ${models[35]}`, exact: true }).press('Enter');
    assert.equal(await selected.inputValue(), models[35]);
    await page.getByRole('button', { name: /^hidden/ }).press('Enter');
    await page.getByRole('button', { name: `Unhide ${models[35]}`, exact: true }).press('Space');
    await search.fill('no-such-model');
    await search.press('ArrowDown');
    await search.press('Enter');
    assert.equal(await selected.inputValue(), models[35]);
    await search.press('Escape');
    assert.ok(await page.locator('.model-browse').evaluate((el) => el === document.activeElement));
    await page.keyboard.press('Escape');
  });
  await test('Transcript roles, Markdown, duplicate replay and reasoning', async () => {
    for (const token of ['LUCKY_USER_EARLIER', 'LUCKY-ASSISTANT-EARLIER', 'LUCKY_USER_LATEST', 'LUCKY-ASSISTANT-LATEST']) {
      await eventually(async () => (await page.locator('.agent-main').innerText()).includes(token), `Missing ${token}`);
      assert.equal((await page.locator('.agent-main').innerText()).split(token).length - 1, 1, `Duplicate ${token}`);
    }
    for (const el of await page.locator('.ev.assistant').all()) assert.equal(await el.evaluate((node) => getComputedStyle(node).fontSize), '16px');
    const userRows = page.locator('.ev.user');
    assert.ok(await userRows.count() > 0, 'Missing user turn rows');
    for (const el of await userRows.all()) assert.equal(await el.evaluate((node) => getComputedStyle(node).fontSize), '16px');
    for (const tag of await page.locator('.ev .tag').all()) assert.equal(await tag.evaluate((el) => getComputedStyle(el).fontSize), '14px');
    const code = page.locator('.message-content pre').first();
    assert.equal(await code.evaluate((el) => getComputedStyle(el).whiteSpace), 'pre');
    assert.ok(await code.evaluate((el) => el.scrollWidth > el.clientWidth));
    assert.ok(await page.locator('.message-content').getByRole('button', { name: /copy/i }).count() > 0);
    const reasoning = page.locator('.ev.reasoning');
    if (await reasoning.count()) {
      assert.equal(await reasoning.evaluate((el) => getComputedStyle(el).fontStyle), 'normal');
      assert.equal(await reasoning.evaluate((el) => getComputedStyle(el).fontSize), '14px');
    }
    const outcomeRows = page.locator('.run-details, .run-summary');
    assert.ok(await outcomeRows.count() > 0, 'Missing outcome summary row');
    const firstOutcome = outcomeRows.first();
    const outcomeColor = await firstOutcome.evaluate((el) => getComputedStyle(el).borderLeftColor);
    assert.notEqual(outcomeColor, 'rgb(34, 56, 79)', 'Outcome row does not carry an outcome color');
    assert.match(await firstOutcome.getAttribute('class'), /unverified/);
    assert.notEqual(outcomeColor, 'rgb(0, 230, 118)', 'Unverified outcome must not be success green');
    assert.ok(await firstOutcome.evaluate((el) => Array.from(el.parentElement.children).slice(0, Array.from(el.parentElement.children).indexOf(el)).some((node) => node.classList.contains('assistant') && node.textContent.includes('LUCKY-ASSISTANT-LATEST'))), 'Final answer must precede run details');
    const userBubble = page.locator('.ev.user').first();
    assert.equal(await userBubble.evaluate((el) => getComputedStyle(el).borderRadius), '12px');
    const userMargins = await userBubble.evaluate((el) => { const s = getComputedStyle(el); return [parseFloat(s.marginLeft), parseFloat(s.marginRight)]; });
    assert.ok(userMargins[0] > userMargins[1], 'User message is not a right-aligned bubble');
    const assistantCard = page.locator('.ev.assistant').first();
    assert.equal(await assistantCard.evaluate((el) => getComputedStyle(el).borderRadius), '10px');
    assert.notEqual(await assistantCard.evaluate((el) => getComputedStyle(el).backgroundColor), await userBubble.evaluate((el) => getComputedStyle(el).backgroundColor), 'Assistant card is indistinguishable from the user bubble');
    assert.ok(await assistantCard.locator('.assistant-head .avatar').count() > 0, 'Assistant card header missing');
    assert.ok(await assistantCard.locator('.turn-actions').count() > 0, 'Hover action row missing');
  });
  await test('Requests live in the Activity panel, not the chat', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const toggle = page.getByRole('button', { name: 'Inspector', exact: true });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await eventually(async () => (await page.locator('#agent-activity').innerText()).includes('Request 1'), 'Request row missing from Activity panel');
    const activityText = await page.locator('#agent-activity').innerText();
    assert.match(activityText, /2 msgs/);
    assert.match(activityText, /↑48.?210/);
    assert.match(activityText, /↓3.?120/);
    assert.ok(await page.locator('.request-row a', { hasText: 'Download payload' }).count() > 0, 'Request payload download missing');
    assert.equal(await page.locator('.agent-main .request-row, .agent-main .request-payload').count(), 0, 'Request payloads are still dumped in the chat');
    assert.ok(await page.locator('.run-grid').count() > 0, 'Structured run details grid missing');
    await page.screenshot({ path: path.join(output, 'lucky-ui-chat-restyle.png') });
  });
  await test('Workbench widths, inspector toggle and 125% zoom', async () => {
    for (const width of [1100, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await noOverflow();
      const toggle = page.getByRole('button', { name: 'Inspector', exact: true });
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
      assert.ok(!(await page.getByLabel('Agent inspector', { exact: true }).isVisible()), 'Hidden inspector is still visible');
      await noOverflow();
      await toggle.click();
      assert.ok(await page.getByLabel('Agent inspector', { exact: true }).isVisible());
      await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
      await noOverflow();
      await page.screenshot({ path: path.join(output, `lucky-ui-workbench-${width}-zoom125.png`) });
      await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    }
  });
  await test('FileTree keyboard open and terminal retention across unmount', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    const folder = page.getByRole('button', { name: 'Folder src', exact: true });
    await folder.focus();
    await folder.press('Enter');
    assert.equal(await folder.getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: 'Open file src/hello.ts', exact: true }).press('Space');
    await page.locator('.cm-editor').waitFor();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /Agent output/ }).count(), 0);
    await page.getByRole('textbox', { name: 'PowerShell command' }).fill('Write-Output LUCKY_MANUAL_OUTPUT');
    await page.getByRole('textbox', { name: 'PowerShell command' }).press('Enter');
    await eventually(async () => (await page.getByLabel('Terminal output', { exact: true }).innerText()).includes('Exit 0'), 'Terminal fixture did not finish');
    await page.getByRole('button', { name: 'Close terminal' }).click();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    assert.match(await page.getByLabel('Terminal output', { exact: true }).innerText(), /LUCKY_MANUAL_OUTPUT/);
    await page.screenshot({ path: path.join(output, 'lucky-ui-files-terminal.png') });
  });
  await test('No browser crashes or unexpected API requests', async () => {
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpectedRequests, []);
    assert.match(await page.title(), /ECLucky13 v1\.24/);
  });
} finally {
  releaseSave?.();
  writeFileSync(path.join(output, 'lucky-ui-results.json'), JSON.stringify({ baseURL, mockedAPIs: true, results, pageErrors }, null, 2));
  await browser.close();
}
const failed = results.filter((result) => !result.passed);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots: ${output}`);
if (failed.length) process.exitCode = 1;
