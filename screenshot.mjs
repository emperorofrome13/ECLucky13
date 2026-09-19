// Screenshot the live EC11 UI for verification.
import { chromium } from 'playwright-core';
import fs from 'fs';

const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM,
  ...fs.readdirSync(process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright')
    .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
    .map((d) => process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright\\' + d + '\\chrome-win\\chrome.exe'),
].filter(Boolean);

const exe = candidates.find((p) => fs.existsSync(p));
console.log('chromium=', exe || '(default)');

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.goto('http://127.0.0.1:3620', { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('.brand', { timeout: 10000 });
const brand = await page.textContent('.brand');
const stages = await page.$$eval('.stage .stage-name', (els) => els.map((e) => e.textContent));
const hasComposer = await page.$('.composer textarea');
console.log('brand=', brand);
console.log('autoprompt_stages_visible=', JSON.stringify(stages));
console.log('composer_present=', !!hasComposer);
await page.screenshot({ path: 'ui-main.png' });

await page.click('text=Settings');
await page.waitForSelector('.drawer', { timeout: 5000 });
const legends = await page.$$eval('.drawer legend', (els) => els.map((e) => e.textContent));
const fields = await page.$$eval('.drawer label', (els) => els.map((e) => e.textContent).filter(Boolean).slice(0, 20));
console.log('settings_sections=', JSON.stringify(legends));
console.log('settings_labels=', JSON.stringify(fields));
await page.screenshot({ path: 'ui-settings.png' });

await browser.close();
console.log('SCREENSHOTS_OK');
