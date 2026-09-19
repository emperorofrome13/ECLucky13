import { chromium } from 'playwright-core';
import fs from 'fs';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await browser.newContext()).newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.goto('http://127.0.0.1:3000', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.topbar', { timeout: 20000 });
console.log('brand=', await page.textContent('.brand'));

await page.click('button:has-text("Settings")');
await page.waitForSelector('.drawer', { timeout: 5000 });
console.log('model=', await page.inputValue('.drawer input[list="ec11-models"]'));
await page.waitForTimeout(3000); // let auto-detect run

const fields = await page.$$eval('.drawer .field', (els) => els.map((e) => ({ label: e.querySelector('label')?.textContent, value: (e.querySelector('input,select') || {}).value })));
const find = (l) => (fields.find((f) => f.label === l) || {}).value;
console.log('max_output=', find('Max output tokens'));
console.log('context_window=', find('Model context window'));
const info = await page.$$eval('.drawer .hint', (els) => els.map((e) => e.textContent).filter((t) => /Auto|context|Detect|report/i.test(t)));
console.log('detect_hint=', JSON.stringify(info.find((t) => t.startsWith('Auto')) || info.slice(0, 3)));
await page.screenshot({ path: 'ui-v106-dynamic.png' });

await browser.close();
console.log('V106_UI_OK');
