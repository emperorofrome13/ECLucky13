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
  }));
  window.localStorage.removeItem('ec11.sessions.v1');
});
await page.goto('http://127.0.0.1:3000', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.topbar', { timeout: 20000 });
console.log('brand=', await page.textContent('.brand'));
await page.waitForTimeout(2500); // probe OpenRouter catalog

await page.click('button:has-text("Settings")');
await page.waitForSelector('.drawer', { timeout: 5000 });
await page.waitForSelector('.model-picker input', { timeout: 5000 });
await page.click('.model-picker input');
await page.waitForSelector('.model-list', { timeout: 5000 });
await page.fill('.model-picker input', 'claude-sonnet');
await page.waitForTimeout(400);
const rows = await page.$$eval('.model-row', (els) => els.slice(0, 5).map((e) => e.textContent.replace(/\s+/g, ' ')));
console.log('rows=', JSON.stringify(rows));
await page.screenshot({ path: 'ui-v111-picker.png' });

// Pick the claude-sonnet-4 row
await page.click('.model-row:has-text("claude-sonnet-4")');
await page.waitForTimeout(500);
const fields = await page.$$eval('.drawer .field', (els) => els.map((e) => ({ label: e.querySelector('label')?.textContent, value: (e.querySelector('input,select') || {}).value })));
const find = (l) => (fields.find((f) => f.label === l) || {}).value;
console.log('model=', find('Model'));
console.log('context_window=', find('Model context window'));
console.log('max_output=', find('Max output tokens'));
console.log('input_price=', find('Input price / 1M tokens'));
console.log('output_price=', find('Output price / 1M tokens'));

await browser.close();
console.log('V111_OK');
