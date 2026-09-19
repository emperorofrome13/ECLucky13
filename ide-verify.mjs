import { chromium } from 'playwright-core';
import fs from 'fs';

const WORKDIR = 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript((wd) => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({ workingDirectory: wd, theme: 'neon' }));
}, WORKDIR);

await page.goto('http://127.0.0.1:3620', { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('.rail', { timeout: 10000 });
console.log('brand=', await page.textContent('.brand'));
console.log('rail_buttons=', (await page.$$('.rail-btn')).length);
await page.waitForSelector('.tree-row', { timeout: 10000 });
console.log('tree_rows=', (await page.$$('.tree-row')).length);
await page.screenshot({ path: 'ui-ide-main.png' });

// Open the file in the editor
await page.click('.tree-row');
await page.waitForSelector('.code-edit', { timeout: 8000 });
const code = await page.inputValue('.code-edit');
console.log('editor_content=', JSON.stringify(code));
console.log('tabs=', await page.$$eval('.tab', (els) => els.map((e) => e.textContent)));
await page.screenshot({ path: 'ui-ide-editor.png' });

// Open terminal and run a command
await page.keyboard.press('Control+`');
await page.waitForSelector('.term-in input', { timeout: 5000 });
await page.fill('.term-in input', 'node hello.js');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
console.log('terminal_text=', JSON.stringify((await page.textContent('.term-out')).slice(0, 200)));
await page.screenshot({ path: 'ui-ide-terminal.png' });

// Command palette
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette', { timeout: 5000 });
console.log('palette_items=', (await page.$$('.palette-item')).length);
await page.screenshot({ path: 'ui-ide-palette.png' });
await page.keyboard.press('Escape');

// Changes panel (empty until agent writes)
await page.click('.rail-btn:nth-child(2)');
await page.waitForTimeout(400);
await page.screenshot({ path: 'ui-ide-changes.png' });

await browser.close();
console.log('IDE_SCREENSHOTS_OK');
