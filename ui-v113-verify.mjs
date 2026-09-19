import { chromium } from 'playwright-core';
import fs from 'fs';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });

async function openPicker(baseUrl, preset) {
  const page = await (await browser.newContext()).newPage({ viewport: { width: 1400, height: 940 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
  await page.addInitScript(({ b, p }) => {
    window.localStorage.setItem('ec11.settings.v1', JSON.stringify({
      workingDirectory: 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test', theme: 'neon',
      provider: { preset: p, baseUrl: b, apiKey: '', model: '', maxTokens: 65536, temperature: 0.7, contextWindow: 65536, connectTimeoutMs: 60000, completionTimeoutMs: 600000, streamIdleTimeoutMs: 300000, retries: 3, inputCostPer1M: 0, outputCostPer1M: 0, currency: '$' },
      agent: { maxIterations: 0, stageMaxIterations: 0, autoAcceptChanges: true },
      autoPrompt: { enabled: false, stages: [] }, contextTools: { skills: false },
      recentModels: [], hiddenModels: [], hideVariants: false,
    }));
    window.localStorage.removeItem('ec11.sessions.v1');
  }, { b: baseUrl, p: preset });
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.topbar', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Settings")');
  await page.waitForSelector('.model-picker input', { timeout: 5000 });
  await page.click('.model-picker input');
  await page.waitForSelector('.model-controls', { timeout: 5000 });
  await page.waitForTimeout(400);
  return page;
}

// ---- OpenRouter: grouping + hide ----
let page = await openPicker('https://openrouter.ai/api/v1', 'openrouter');
console.log('brand=', await page.textContent('.brand'));
const groups = await page.$$eval('.model-group', (els) => els.length);
console.log('openrouter_group_headers=', groups);
console.log('openrouter_all_count=', await page.textContent('.model-count'));
await page.screenshot({ path: 'ui-v113-grouped.png' });

const firstId = await page.textContent('.model-row .model-id');
await page.locator('.model-row .model-hide').first().dispatchEvent('mousedown', { bubbles: true, cancelable: true });
await page.waitForTimeout(500);
const hiddenScopeLabel = await page.textContent('.model-scopes .scope:has-text("hidden")');
console.log('hid=', JSON.stringify(firstId), 'hidden_scope_label=', JSON.stringify(hiddenScopeLabel));
await page.click('.model-scopes .scope:has-text("hidden")');
await page.waitForTimeout(300);
const hiddenRows = await page.$$eval('.model-row .model-id', (els) => els.map((e) => e.textContent));
console.log('hidden_rows=', JSON.stringify(hiddenRows));
await page.screenshot({ path: 'ui-v113-hidden.png' });
await page.close();

// ---- LM Studio: hide variant checkpoints ----
page = await openPicker('http://127.0.0.1:1234/v1', 'lmstudio');
const before = await page.textContent('.model-count');
await page.locator('.variant-toggle input').check();
await page.waitForTimeout(400);
const after = await page.textContent('.model-count');
console.log('lmstudio_count_before_variant_hide=', before, 'after=', after);
await page.screenshot({ path: 'ui-v113-variants.png' });
await page.close();

await browser.close();
console.log('V113_OK');

