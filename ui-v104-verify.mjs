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
await page.addInitScript((dir) => {
  window.localStorage.setItem('ec11.settings.v1', JSON.stringify({ workingDirectory: dir, theme: 'neon', contextTools: { skills: true, ponytail: true } }));
}, DIR);
await page.goto('http://127.0.0.1:3620', { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('.rail', { timeout: 10000 });
console.log('brand=', await page.textContent('.brand'));

await page.click('button.rail-btn[title*="Edit prompts"]');
await page.waitForSelector('.drawer.wide', { timeout: 5000 });
const promptItems = await page.$$eval('.prompt-item', (els) => els.map((e) => e.textContent.split('—')[0].trim()));
console.log('prompt_files=', JSON.stringify(promptItems));
const textareaVal = await page.inputValue('.prompt-textarea');
console.log('system_prompt_first_line=', JSON.stringify(textareaVal.split('\n')[0]));
await page.screenshot({ path: 'ui-v104-prompts.png' });

await page.click('.drawer-head button:has-text("Skills")');
await page.waitForSelector('.prompt-item', { timeout: 5000 });
await page.waitForTimeout(300);
const skills = await page.$$eval('.prompt-item div:first-child', (els) => els.map((e) => e.textContent));
console.log('skills_count=', skills.length, 'first=', JSON.stringify(skills.slice(0, 6)));
await page.click('.prompt-item');
await page.waitForTimeout(800);
const skillVal = await page.inputValue('.prompt-textarea');
console.log('skill_preview_first_line=', JSON.stringify((skillVal || '').split('\n').slice(0, 3).join(' | ').slice(0, 120)));
await page.screenshot({ path: 'ui-v104-skills.png' });

await browser.close();
console.log('V104_UI_OK');
