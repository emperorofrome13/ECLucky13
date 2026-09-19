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

// Workspace chip opens the dedicated picker directly
await page.click('.ws-chip');
await page.waitForSelector('.drawer.workspace', { timeout: 5000 });
console.log('workspace_picker_opened=', !!(await page.$('.drawer.workspace')));
await page.screenshot({ path: 'ui-v105-workspace.png' });
await page.click('.drawer.workspace .drawer-head button');

// Settings: working folder first, and new defaults
await page.click('button:has-text("Settings")');
await page.waitForSelector('.drawer', { timeout: 5000 });
const legends = await page.$$eval('.drawer legend', (els) => els.map((e) => e.textContent));
console.log('settings_sections=', JSON.stringify(legends));
const fields = await page.$$eval('.drawer .field', (els) => els.map((e) => ({ label: e.querySelector('label')?.textContent, value: (e.querySelector('input,select') || {}).value })));
const find = (l) => (fields.find((f) => f.label === l) || {}).value;
console.log('max_output=', find('Max output tokens'));
console.log('context_window=', find('Model context window'));
console.log('max_agent_iterations=', find('Max agent iterations'));
console.log('max_stage_iterations=', find('Max iterations per stage'));
await page.screenshot({ path: 'ui-v105-settings.png' });

await browser.close();
console.log('V105_UI_OK');
