import { chromium } from 'playwright-core';
import fs from 'fs';

const DIR = 'E:\\aiprojects\\coders\\ec\\ec11\\workspace-test';
const FILE = DIR + '\\app.js';
const MODEL = 'qwen3.5-4b-claude-4.6-opus-reasoning-distilled-v2';
fs.writeFileSync(FILE, "console.log('hello world');\n");

const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await browser.newContext()).newPage({ viewport: { width: 1500, height: 940 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.addInitScript(({ dir, model }) => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({
    workingDirectory: dir, theme: 'neon',
    provider: { model, baseUrl: 'http://127.0.0.1:1234/v1', maxTokens: 4000, temperature: 0.2, contextWindow: 16384, connectTimeoutMs: 30000, completionTimeoutMs: 600000, streamIdleTimeoutMs: 300000, retries: 1 },
    agent: { maxIterations: 10, stageMaxIterations: 4, autoAcceptChanges: true },
    autoPrompt: { enabled: false, stages: [] },
  }));
  window.localStorage.removeItem('ec11.sessions.v1');
}, { dir: DIR, model: MODEL });

await page.goto('http://127.0.0.1:3000', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.composer-bar textarea', { timeout: 20000 });
console.log('brand=', await page.textContent('.brand'));
await page.fill('.composer-bar textarea', "Read app.js. Use edit_file to change 'hello world' to 'hello EC11'. Then call attempt_completion.");
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.body.innerText.includes('Task complete.'), null, { timeout: 300000 });
await page.waitForTimeout(1200);

const topbar = (await page.textContent('.topbar')).replace(/\s+/g, ' ');
console.log('topbar_has_pending_badge=', /change\(s\)/.test(topbar));

await page.click('.rail-btn:nth-child(2)');
await page.waitForSelector('.change-file', { timeout: 10000 });
const rowText = (await page.textContent('.change-file')).replace(/\s+/g, ' ');
console.log('change_row=', rowText);
console.log('has_applied_badge=', /applied/.test(rowText));
const buttons = await page.$$eval('.change-file button', (els) => els.map((e) => e.textContent));
console.log('row_buttons=', JSON.stringify(buttons));
await page.click('.change-file');
await page.waitForSelector('.diff-line', { timeout: 8000 });
console.log('file_after_agent=', JSON.stringify(fs.readFileSync(FILE, 'utf8')));
await page.screenshot({ path: 'ui-v108-autoaccept.png' });

// Revert should restore original
await page.click('.change-file button:has-text("revert")');
await page.waitForTimeout(800);
console.log('file_after_revert=', JSON.stringify(fs.readFileSync(FILE, 'utf8')));

await browser.close();
console.log('V108_OK');
