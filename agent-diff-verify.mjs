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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(({ dir, model }) => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({
    workingDirectory: dir,
    theme: 'neon',
    provider: { model, baseUrl: 'http://127.0.0.1:1234/v1', maxTokens: 4000, temperature: 0.2, contextWindow: 16384, connectTimeoutMs: 30000, completionTimeoutMs: 600000, streamIdleTimeoutMs: 300000, retries: 1 },
    agent: { maxIterations: 10, stageMaxIterations: 6 },
    autoPrompt: { enabled: false, stages: [] },
  }));
  window.localStorage.removeItem('ec11.sessions.v1');
}, { dir: DIR, model: MODEL });

await page.goto('http://127.0.0.1:3620', { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('.composer-bar textarea', { timeout: 10000 });
await page.fill('.composer-bar textarea', "Read app.js. Use edit_file to change the text 'hello world' to 'hello EC11'. Then call attempt_completion.");
await page.keyboard.press('Enter');
console.log('task sent; waiting for agent...');

// wait for the done event text to appear in the agent log
await page.waitForFunction(() => document.body.innerText.includes('Task complete.'), { timeout: 300000 });
console.log('agent finished');
await page.waitForTimeout(1500);

// look at changes
await page.click('.rail-btn:nth-child(2)');
await page.waitForSelector('.change-file', { timeout: 10000 });
const changeName = await page.textContent('.change-file .cname');
console.log('change_file=', JSON.stringify(changeName));
await page.click('.change-file');
await page.waitForSelector('.diff-line', { timeout: 8000 });
const addLines = await page.$$eval('.diff-line.add', (els) => els.map((e) => e.textContent));
const delLines = await page.$$eval('.diff-line.del', (els) => els.map((e) => e.textContent));
console.log('diff_added=', JSON.stringify(addLines));
console.log('diff_removed=', JSON.stringify(delLines));
await page.screenshot({ path: 'ui-ide-diff.png' });

const fileAfterEdit = fs.readFileSync(FILE, 'utf8');
console.log('file_after_agent=', JSON.stringify(fileAfterEdit));

// Reject -> should restore original content
await page.click('text=Reject');
await page.waitForTimeout(800);
const fileAfterReject = fs.readFileSync(FILE, 'utf8');
console.log('file_after_reject=', JSON.stringify(fileAfterReject));
const changesLeft = await page.$$('.change-file');
console.log('change_files_left=', changesLeft.length);

await browser.close();
console.log('DIFF_FLOW_OK');

