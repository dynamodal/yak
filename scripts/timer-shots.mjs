// Screenshots of the Timer page for review without a deploy: realistic entries over several days
// in both spaces, a running timer, a frozen clock, at desktop, tablet, phone and "mini window"
// sizes, in light and dark. Runs against dist/ served with the real headers.
//
//   npm install --no-save playwright-core && npm run build
//   node scripts/serve-dist.mjs 4210 &
//   TARGET=http://127.0.0.1:4210/ node scripts/timer-shots.mjs /tmp/timer-shots after
//
// The second argument is a file name prefix (`before`, `after`). Pages that fail to load a shot's
// optional interaction (a hover, an open menu) still get their plain shot.
//
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './e2e/lib.mjs';

const BASE = process.env.TARGET || 'http://127.0.0.1:4210/';
const [outDir = '/tmp/timer-shots', prefix = 'shot'] = process.argv.slice(2);
// Wednesday 14 October 2026, 15:40 in Berlin.
const NOW = new Date('2026-10-14T13:40:00Z');
// Local Berlin time (CEST, UTC+2) on a day relative to NOW.
const at = (dayOffset, h, m = 0) => new Date(Date.UTC(2026, 9, 14 + dayOffset, h - 2, m)).toISOString();

const PERSONAL = {
  clients: [{ ref: 'acme', name: 'Acme Corp' }, { ref: 'north', name: 'Northwind' }],
  projects: [
    { ref: 'web', name: 'Website relaunch', client: 'acme', rate: 95, color: '#2f6fde' },
    { ref: 'app', name: 'Mobile app', client: 'acme', rate: 95, color: '#8e44ad' },
    { ref: 'audit', name: 'Security audit', client: 'north', rate: 110, color: '#1a7f37' },
    { ref: 'admin', name: 'Admin', billable: false, color: '#b26a00' },
  ],
  entries: [
    // Today
    { start: at(0, 8, 30), stop: at(0, 8, 45), description: 'Standup', project: 'web', tags: ['meeting'], billable: true },
    { start: at(0, 8, 50), stop: at(0, 10, 40), description: 'Checkout page layout', project: 'web', tags: ['frontend'], billable: true },
    { start: at(0, 10, 55), stop: at(0, 12, 5), description: 'Checkout page layout', project: 'web', tags: ['frontend'], billable: true },
    { start: at(0, 13, 0), stop: at(0, 13, 25), description: 'Email and invoices', project: 'admin' },
    { start: at(0, 13, 30), stop: at(0, 14, 50), description: 'Push notification spike with a deliberately long description that has to wrap or truncate', project: 'app', tags: ['research'], billable: true },
    { start: at(0, 14, 55), stop: null, description: 'Code review', project: 'web', tags: ['review'], billable: true },
    // Yesterday
    { start: at(-1, 8, 30), stop: at(-1, 8, 45), description: 'Standup', project: 'web', tags: ['meeting'], billable: true },
    { start: at(-1, 9, 0), stop: at(-1, 11, 30), description: 'Threat model workshop', project: 'audit', tags: ['meeting'], billable: true },
    { start: at(-1, 12, 15), stop: at(-1, 15, 0), description: 'Dependency review', project: 'audit', billable: true },
    { start: at(-1, 15, 10), stop: at(-1, 16, 40), description: 'Dependency review', project: 'audit', billable: true },
    { start: at(-1, 16, 45), stop: at(-1, 17, 30), description: 'Dependency review', project: 'audit', billable: true },
    // Monday
    { start: at(-2, 8, 30), stop: at(-2, 8, 45), description: 'Standup', project: 'web', tags: ['meeting'], billable: true },
    { start: at(-2, 9, 0), stop: at(-2, 12, 0), description: 'Hero section', project: 'web', tags: ['frontend'], billable: true },
    { start: at(-2, 13, 0), stop: at(-2, 13, 40), description: 'Email and invoices', project: 'admin' },
    { start: at(-2, 14, 0), stop: at(-2, 17, 15), description: 'Offline sync bug', project: 'app', tags: ['bug'], billable: true },
    // Last Friday
    { start: at(-5, 9, 0), stop: at(-5, 9, 30), description: 'Weekly planning' },
    { start: at(-5, 9, 30), stop: at(-5, 12, 30), description: 'Report draft', project: 'audit', billable: true },
    { start: at(-5, 13, 30), stop: at(-5, 16, 0), description: 'Report draft', project: 'audit', billable: true },
  ],
};
const WORK = {
  projects: [{ ref: 'ops', name: 'Operations', color: '#c4312b', billable: false }],
  entries: [{ start: at(-1, 17, 45), stop: at(-1, 18, 15), description: 'On-call handover', project: 'ops' }],
};

const SIZES = [
  { name: '1280', width: 1280, height: 800, full: true },
  { name: '768', width: 768, height: 1024, full: true },
  { name: '375', width: 375, height: 812, full: true },
  { name: 'mini-360x560', width: 360, height: 560, full: false },
];

mkdirSync(outDir, { recursive: true });
const browser = await launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme, timezoneId: 'Europe/Berlin', locale: 'en-GB', viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) console.error('CSP:', m.text().slice(0, 200)); });
  await page.clock.setFixedTime(NOW);
  await page.goto(`${BASE}?test#/time/reports`);
  await page.waitForFunction(() => window.__reports);
  await page.evaluate(([p, w]) => { window.__reports.seed('personal', p); window.__reports.seed('work', w); }, [PERSONAL, WORK]);
  // Let IndexedDB store the seed before the first reload, or the reload loses part of it.
  await new Promise((r) => setTimeout(r, 1500));
  const sizes = scheme === 'light' ? SIZES : SIZES.filter((s) => s.name === '1280' || s.name.startsWith('mini'));
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${BASE}?test#/time`);
    // A fresh page per size, so an expanded group or open editor from the last size is gone.
    await page.reload();
    await page.locator('.page').first().waitFor();
    await page.waitForTimeout(400);
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    const file = (extra = '') => join(outDir, `${prefix}-${size.name}${extra}${scheme === 'dark' ? '-dark' : ''}.png`);
    await page.screenshot({ path: file(), fullPage: size.full, caret: 'hide', animations: 'disabled' });
    if (scheme !== 'light' || prefix === 'before') continue;
    // Interaction shots: a hovered row, and its "more" menu open.
    const row = page.locator('.te-row').nth(1);
    if (await row.count()) {
      await row.hover();
      await page.waitForTimeout(150);
      if (size.name === '1280' || size.name.startsWith('mini')) await page.screenshot({ path: file('-hover'), fullPage: false, caret: 'hide', animations: 'disabled' });
      const more = row.getByRole('button', { name: /^More actions/ });
      if (size.name.startsWith('mini') && (await more.count())) {
        await more.click();
        await page.waitForTimeout(150);
        await page.screenshot({ path: file('-menu'), fullPage: false, caret: 'hide', animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
    if (size.name === '1280' || size.name.startsWith('mini')) {
      const project = page.locator('.tb').getByRole('button', { name: /^Project/ });
      if (await project.count()) {
        await project.click();
        await page.waitForTimeout(150);
        await page.screenshot({ path: file('-project'), fullPage: false, caret: 'hide', animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
      const group = page.locator('.te-count').first();
      if (await group.count()) {
        await group.click();
        await page.waitForTimeout(150);
        await page.screenshot({ path: file('-group'), fullPage: !size.name.startsWith('mini'), caret: 'hide', animations: 'disabled' });
      }
    }
  }
  if (scheme === 'light' && prefix !== 'before') {
    // Stopped: the bar offers projects of every space; and the mode for adding a finished entry.
    await page.locator('.timer-bar').getByRole('button', { name: 'Stop', exact: true }).click();
    for (const size of SIZES.filter((s) => s.name === '1280' || s.name.startsWith('mini'))) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${BASE}?test#/time`);
      await page.locator('.page').first().waitFor();
      await page.waitForTimeout(300);
      const file = (extra) => join(outDir, `${prefix}-${size.name}${extra}.png`);
      await page.locator('.tb').getByRole('button', { name: /^Project/ }).click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: file('-stopped-project'), caret: 'hide', animations: 'disabled' });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add a finished entry' }).click();
      await page.waitForTimeout(150);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: file('-stopped-manual'), caret: 'hide', animations: 'disabled' });
      await page.getByRole('button', { name: 'Back to the timer' }).click();
      if (size.name.startsWith('mini')) {
        // Delete a row: the Undo toast, then the "Recently deleted" list.
        const row = page.locator('.te-row', { hasText: 'Email and invoices' }).first();
        await row.hover();
        await row.getByRole('button', { name: /^More actions/ }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: file('-deleted-undo'), caret: 'hide', animations: 'disabled' });
        await page.locator('.toast').getByRole('button', { name: 'Dismiss' }).click();
        await page.locator('.tl-deleted summary').click();
        await page.locator('.tl-deleted').scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.screenshot({ path: file('-deleted-list'), caret: 'hide', animations: 'disabled' });
      }
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`shots in ${outDir}`);
