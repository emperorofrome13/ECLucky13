// EC12 full UI drive (no model server needed): workspace, explorer, editor save, terminal, settings.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const WS = 'E:\\aiprojects\\coders\\ec\\ec12\\workspace-test';
fs.mkdirSync(WS, { recursive: true });
fs.writeFileSync(path.join(WS, 'ui-drive.txt'), 'seed\n');

const c = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = c.find((p) => fs.existsSync(p));
const b = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await b.newContext()).newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));

await page.goto('http://127.0.0.1:3211', { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('.topbar', { timeout: 15000 });
console.log('brand=', await page.textContent('.brand'));

// Register workspace via API-driven picker fallback (type path directly)
const wsPath = await page.evaluate(async (dir) => {
  const r = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dir }) });
  return r.json();
}, WS);
console.log('workspace ok=', wsPath.ok, wsPath.workspace?.id);
// seed into localStorage settings and reload so the app uses it
await page.evaluate((id) => {
  const s = JSON.parse(localStorage.getItem('ec12.settings.v1') || '{}');
  s.workspace = { id, path: 'E:\\aiprojects\\coders\\ec\\ec12\\workspace-test' };
  localStorage.setItem('ec12.settings.v1', JSON.stringify(s));
}, ws.workspace.id);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.tree-row', { timeout: 15000 });
const rows = await page.$$eval('.tree-row .tree-row, .tree-row', (els) => els.slice(0, 8).map((e) => e.textContent));
console.log('tree_rows=', JSON.stringify(rows));

// open a file in the editor
await page.click('.tree-row:has-text("ui-drive.txt")');
await page.waitForSelector('.editor-pane', { timeout: 15000 });
console.log('editor_open=', true);
// edit + save via CodeMirror
await page.click('.cm-content');
await page.keyboard.press('Control+a');
await page.keyboard.type('edited via ec12 ui\n');
await page.waitForTimeout(300);
await page.click('button:has-text("Save")');
await page.waitForTimeout(1200);
const saved = fs.readFileSync('E:\\aiprojects\\coders\\ec\\ec12\\workspace-test\\ui-drive.txt', 'utf8');
console.log('saved_content=', JSON.stringify(saved.slice(0, 40)));

// terminal exec with reconciliation
await page.click('button:has-text("terminal")');
await page.waitForSelector('.term-in input', { timeout: 5000 });
await page.fill('.term-in input', "Set-Content -Path 'ui-made.txt' -Value 'made by terminal'");
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const term = await page.textContent('.term-out');
console.log('terminal_has_reconcile=', /reconciled|workspace file\(s\)/.test(term));
console.log('ui-made exists=', fs.existsSync('E:\\aiprojects\\coders\\ec\\ec12\\workspace-test\\ui-made.txt'));

// settings drawer + model picker
await page.click('button:has-text("Settings")');
await page.waitForSelector('.drawer', { timeout: 5000 });
await page.waitForTimeout(1200);
const modelCount = await page.$$eval('.model-row .model-id', (els) => els.length);
console.log('picker_models_visible=', modelCount);
await page.screenshot({ path: 'ec12-ui-full.png' });

await b.close();
console.log('EC12_DRIVE_OK');
function path2(p) { return p; }