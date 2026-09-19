import { chromium } from 'playwright-core';
import fs from 'fs';
const candidates = fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
  .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
  .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe');
const exe = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });
const ctx = await browser.newContext({ bypassCSP: true });
const page = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const failed = [];
page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR', m.text().slice(0, 160)); });
await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.topbar', { timeout: 20000 });
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const appDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).display);
const sheets = await page.evaluate(() => Array.from(document.styleSheets).map((s) => s.href || '(inline)'));
const ruleCount = await page.evaluate(() => { try { return document.styleSheets[0].cssRules.length; } catch { return -1; } });
console.log('body_background=', bg);
console.log('app_display=', appDisplay);
console.log('styleSheets=', JSON.stringify(sheets));
console.log('firstSheet_rules=', ruleCount);
console.log('failed_requests=', JSON.stringify(failed));
await page.screenshot({ path: 'ui-3000-check.png' });
await browser.close();
