import { chromium } from 'playwright-core';
import fs from 'fs';
const DIR = 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await browser.newContext()).newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.addInitScript((dir) => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({
    workingDirectory: dir, theme: 'neon',
    provider: { preset: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: 'google/gemma-4-12b', maxTokens: 4096, temperature: 0.7, contextWindow: 8192, connectTimeoutMs: 60000, completionTimeoutMs: 600000, streamIdleTimeoutMs: 300000, retries: 3, inputCostPer1M: 0, outputCostPer1M: 0, currency: '$' },
    agent: { maxIterations: 0, stageMaxIterations: 0, autoAcceptChanges: true },
    autoPrompt: { enabled: false, stages: [] },
    contextTools: { skills: true },
  }));
  window.localStorage.removeItem('ec11.sessions.v1');
}, DIR);
await page.goto('http://127.0.0.1:3000', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.topbar', { timeout: 20000 });
console.log('brand=', await page.textContent('.brand'));
await page.waitForTimeout(4000); // let probe auto-select the loaded model
const topbar = await page.textContent('.topbar');
const modelChip = await page.$$eval('.topbar .chip.click', (els) => els.map((e) => e.textContent));
console.log('topbar_chips=', JSON.stringify(modelChip.filter((t) => t && !t.includes('workspace'))));

await page.click('button:has-text("Settings")');
await page.waitForSelector('.drawer', { timeout: 5000 });
await page.waitForTimeout(1500);
const modelVal = await page.inputValue('.drawer input[list="ec11-models"]');
console.log('model_after_probe=', modelVal);
const fields = await page.$$eval('.drawer .field', (els) => els.map((e) => ({ label: e.querySelector('label')?.textContent, value: (e.querySelector('input,select') || {}).value })));
const find = (l) => (fields.find((f) => f.label === l) || {}).value;
console.log('context_window=', find('Model context window'), 'max_output=', find('Max output tokens'));
const loadedHint = await page.$$eval('.drawer .hint', (els) => els.map((e) => e.textContent).find((t) => t.startsWith('Loaded on the server')));
console.log('loaded_hint=', JSON.stringify(loadedHint));

await browser.close();
console.log('V109_OK');
