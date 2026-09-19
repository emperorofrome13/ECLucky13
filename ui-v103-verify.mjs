import { chromium } from 'playwright-core';
import fs from 'fs';

const DIR = 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(({ dir }) => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({
    workingDirectory: dir,
    theme: 'neon',
    provider: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-xxx', model: 'anthropic/claude-sonnet-4', maxTokens: 30000, temperature: 0.7, contextWindow: 200000, connectTimeoutMs: 60000, completionTimeoutMs: 600000, streamIdleTimeoutMs: 300000, retries: 3, inputCostPer1M: 3, outputCostPer1M: 15, currency: '$' },
    agent: { maxIterations: 200, stageMaxIterations: 60 },
    autoPrompt: { enabled: true, stages: ['review', 'completeness', 'senior_review'] },
    contextTools: { rtk: true, ponytail: true, context7: true, codegraph: true, search: true, context7ApiKey: '' },
  }));
  window.localStorage.setItem('ec11.sessions.v1', JSON.stringify([{
    id: 'demo', title: 'Add a login page', createdAt: Date.now(),
    usage: { promptTokens: 12345, completionTokens: 6789, totalTokens: 19134 },
    events: [{ id: 'e1', kind: 'user', content: 'Add a login page', ts: Date.now() }],
  }]));
}, { dir: DIR });

await page.goto('http://127.0.0.1:3620', { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('.composer-bar textarea', { timeout: 10000 });
console.log('brand=', await page.textContent('.brand'));
const topbar = await page.textContent('.topbar');
console.log('topbar=', topbar.replace(/\s+/g, ' ').trim());
console.log('composer_bar_present=', !!(await page.$('.composer-bar textarea')));
console.log('new_session_btn=', !!(await page.$('text=+ New session')));
await page.screenshot({ path: 'ui-v103-main.png' });

// Plan tab -> tokens/cost
await page.click('text=Plan');
await page.waitForTimeout(300);
const panelText = await page.textContent('.agent-scroll');
console.log('plan_tokens=', /Input[^\n]*12,345/.test(panelText) || panelText.includes('12,345'));
await page.screenshot({ path: 'ui-v103-plan.png' });

// Settings -> presets, cost, context tools
await page.click('text=Settings');
await page.waitForSelector('.drawer', { timeout: 5000 });
const legends = await page.$$eval('.drawer legend', (els) => els.map((e) => e.textContent));
console.log('settings_sections=', JSON.stringify(legends));
const presets = await page.$$eval('.drawer select option', (els) => els.map((e) => e.textContent));
console.log('presets=', JSON.stringify(presets));
const ctxLabels = await page.$$eval('.drawer .stage-toggle .st-name', (els) => els.map((e) => e.textContent));
console.log('context_tools=', JSON.stringify(ctxLabels));
await page.screenshot({ path: 'ui-v103-settings.png' });

await browser.close();
console.log('V103_UI_OK');
