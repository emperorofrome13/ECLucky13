import { chromium } from 'playwright-core';
import fs from 'fs';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await browser.newContext()).newPage({ viewport: { width: 1400, height: 940 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.addInitScript(() => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({
    workingDirectory: 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test', theme: 'neon',
    provider: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'openai/gpt-4o', maxTokens: 65536, temperature: 0.7, contextWindow: 65536, connectTimeoutMs: 60000, completionTimeoutMs: 600000, streamIdleTimeoutMs: 300000, retries: 3, inputCostPer1M: 0, outputCostPer1M: 0, currency: '$' },
    agent: { maxIterations: 0, stageMaxIterations: 0, autoAcceptChanges: true },
    autoPrompt: { enabled: false, stages: [] }, contextTools: { skills: false },
    recentModels: ['anthropic/claude-sonnet-4'],
  }));
  window.localStorage.removeItem('ec11.sessions.v1');
});
await page.goto('http://127.0.0.1:3000', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.topbar', { timeout: 20000 });
console.log('brand=', await page.textContent('.brand'));
await page.waitForTimeout(2500);
await page.click('button:has-text("Settings")');
await page.waitForSelector('.model-picker input', { timeout: 5000 });
await page.click('.model-picker input');
await page.waitForSelector('.model-controls', { timeout: 5000 });
const activeScope = await page.$eval('.model-scopes .scope.active', (e) => e.textContent);
const vendorOpts = await page.$$eval('.model-controls select option', (els) => els.map((e) => e.textContent));
console.log('default_scope=', activeScope);
console.log('vendor_option_count=', vendorOpts.length, 'first=', JSON.stringify(vendorOpts.slice(0, 4)));
let rowCount = (await page.$$('.model-row .model-id')).length;
console.log('rows_recent_scope=', rowCount);

// switch to all vendors
await page.click('.model-scopes .scope:has-text("all")');
await page.waitForTimeout(300);
rowCount = (await page.$$('.model-row .model-id')).length;
console.log('rows_all_scope=', rowCount);

// filter by vendor
await page.selectOption('.model-controls select', 'anthropic');
await page.waitForTimeout(300);
rowCount = (await page.$$('.model-row .model-id')).length;
console.log('rows_anthropic=', rowCount);
const countLabel = await page.textContent('.model-count');
console.log('count_label=', countLabel);

// search + keyboard pick
await page.fill('.model-picker input', 'opus');
await page.waitForTimeout(300);
const firstRow = await page.textContent('.model-row .model-id');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const fields = await page.$$eval('.drawer .field', (els) => els.map((e) => ({ label: e.querySelector('label')?.textContent, value: (e.querySelector('input,select') || {}).value })));
const find = (l) => (fields.find((f) => f.label === l) || {}).value;
console.log('picked_model=', find('Model'), 'ctx=', find('Model context window'), 'max=', find('Max output tokens'));
await page.screenshot({ path: 'ui-v112-picker.png' });

await browser.close();
console.log('V112_OK');
