// End-to-end for the reports module: seeds records through the page (`?test` hook), opens each
// report and checks totals, sorting, filters, exports, the hours format and a 375 px layout.
// Fails on any CSP violation, console error or page error. The browser runs in Europe/Berlin so
// the dates below (which include the 2025-03-30 daylight-saving change) are the same everywhere.
//
//   npm run e2e reports
//
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, launch, check, watchPage, finish } from './lib.mjs';


const browser = await launch();
const context = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'en-US', viewport: { width: 1100, height: 900 }, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
const page = await context.newPage();
watchPage(page, 'reports', { consoleErrors: true });

const SEED_PERSONAL = {
  clients: [{ ref: 'acme', name: 'Acme' }],
  projects: [
    { ref: 'web', name: 'Website', client: 'acme', rate: 100, currency: 'USD', color: '#2f6fde' },
    { ref: 'audit', name: 'Audit', rate: 80, currency: 'EUR', color: '#1a7f37' },
    { ref: 'old', name: 'Old job', active: false, billable: false, color: '#b26a00' },
  ],
  entries: [
    { start: '2025-03-24T08:00:00Z', stop: '2025-03-24T10:00:00Z', description: 'Design', project: 'web', billable: true, tags: ['ui', 'review'] },
    { start: '2025-03-25T08:00:00Z', stop: '2025-03-25T09:30:00Z', description: 'Audit work', project: 'audit', billable: true },
    { start: '2025-03-25T12:00:00Z', stop: '2025-03-25T13:00:00Z', description: 'Admin', project: 'old', tags: ['ops'] },
    { start: '2025-03-26T08:00:00Z', stop: '2025-03-26T09:00:00Z', description: 'design notes' },
    { start: '2025-03-26T10:00:00Z', stop: '2025-03-26T20:00:00Z', description: 'deleted entry', deleted: true },
    // 23:00 CET to 07:00 CEST across the clock change: 7 real hours, 1 on the 29th and 6 on the 30th.
    { start: '2025-03-29T22:00:00Z', stop: '2025-03-30T05:00:00Z', description: 'Overnight' },
  ],
};
const SEED_WORK = {
  projects: [{ ref: 'web', name: 'Website', rate: 50, currency: 'USD' }],
  entries: [{ start: '2025-03-27T08:00:00Z', stop: '2025-03-27T10:00:00Z', description: 'Work task', project: 'web', billable: true }],
};

const text = (sel) => page.locator(sel).first().innerText();
const select = async (label, value) => { await page.getByLabel(label, { exact: true }).selectOption(value); };
const settle = () => page.waitForTimeout(150);
// The one space filter in the page header (shared with Timer and Week).
const spaceFilter = (v) => page.getByLabel('Show space').selectOption(v === 'all' ? 'all' : { label: v });

await page.goto(BASE + '?test#/time/reports');
await page.waitForFunction(() => window.__reports);
check((await page.locator('.tabs a.active').innerText()).trim() === 'Time' && (await page.locator('.seg a.active').innerText()).trim() === 'Reports', 'Reports is the Reports segment of the Time page');
check((await page.locator('.timer-bar').count()) === 0 && (await page.locator('.add-entry').count()) === 0, 'no timer bar or Add entry on Reports');
check((await text('.rp-range')).length > 0 && (await page.locator('.rp-back').count()) === 0, 'the default range (This week) has no way-back button');

await page.evaluate(([p, w]) => { window.__reports.seed('personal', p); window.__reports.seed('work', w); }, [SEED_PERSONAL, SEED_WORK]);
// The filters start collapsed in one line; open them.
await page.locator('#rp-controls .rp-fold').click();
await spaceFilter('Personal');
await select('Range', 'custom');
await page.getByLabel('From', { exact: true }).fill('2025-03-24');
await page.getByLabel('To', { exact: true }).fill('2025-03-31');
await settle();

// ---- Summary
let totals = await text('.rp-totals');
check(/Total\s*12\.50 h/.test(totals), `summary total 12.50 h (${totals.replace(/\s+/g, ' ')})`);
check(/Billable\s*3\.50 h/.test(totals), 'billable total 3.50 h');
check(totals.includes('€120.00') && totals.includes('$200.00'), 'amounts per currency');
const web = page.locator('.rp-table tbody tr', { hasText: 'Website' }).first();
check(/2\.00 h/.test(await web.innerText()) && /\$200\.00/.test(await web.innerText()), 'Website row 2.00 h and $200.00');
check(await page.locator('.rp-table tbody tr', { hasText: 'Old job (archived)' }).count() === 1, 'archived project is labelled and included');
check(await page.locator('.rp-table tbody tr', { hasText: '(No project)' }).count() === 1, 'entries without project grouped');
check((await page.locator('svg.rp-svg').getAttribute('role')) === 'img', 'chart is an image with a label');
check(await page.locator('svg.rp-svg title').filter({ hasText: 'Sun 2025-03-30: 6.00 h' }).count() === 1, 'chart: clock-change day shows 6.00 h');
check(await page.locator('svg.rp-svg title').filter({ hasText: 'Sat 2025-03-29: 1.00 h' }).count() === 1, 'chart: midnight crossing puts 1.00 h on the 29th');
check(await page.locator('svg.rp-svg rect.rp-bar-billable').count() === 2, 'chart: two days with billable time');
check(await page.locator('svg.rp-svg [style]').count() === 0, 'chart has no inline style attributes');

await select('Then by', 'description');
await settle();
check(await page.locator('.rp-child th', { hasText: /^Design$/ }).count() === 1, 'sub-group rows: project then description');
await page.getByRole('button', { name: 'Collapse Website' }).click();
check(await page.locator('.rp-child th', { hasText: /^Design$/ }).count() === 0, 'sub-groups collapse');
await select('Then by', '');

await select('Group by', 'tag');
await settle();
check((await text('.rp-sub-note, main .hint')).length >= 0 && (await page.getByText('counts toward each of its tags').count()) >= 1, 'tag grouping explains the overlap');
const tagRows = await page.locator('.rp-table tbody tr').allInnerTexts();
check(tagRows.some((r) => r.startsWith('ui') && r.includes('2.00 h')) && tagRows.some((r) => r.startsWith('review') && r.includes('2.00 h')), 'entry with two tags counted under each');
await select('Group by', 'day');
await settle();
check(await page.locator('.rp-table tbody tr', { hasText: 'Sun 2025-03-30' }).count() === 1, 'group by day');
await select('Group by', 'project');

// ---- Filters
await select('Project', await page.locator('select:has(option:text("Any project")) option', { hasText: 'Website' }).first().getAttribute('value'));
await settle();
check(/Total\s*2\.00 h/.test(await text('.rp-totals')), 'project filter');
await page.getByRole('button', { name: 'Clear filters' }).click();
await select('Billable', 'non-billable');
await settle();
check(/Total\s*9\.00 h/.test(await text('.rp-totals')), 'non-billable filter');
await select('Billable', 'all');
await page.getByLabel('Description contains', { exact: true }).fill('DESIGN');
await settle();
check(/Total\s*3\.00 h/.test(await text('.rp-totals')), 'description filter is case-insensitive');
await page.getByRole('button', { name: 'Clear filters' }).click();
await select('Tag', 'ops');
await settle();
check(/Total\s*1\.00 h/.test(await text('.rp-totals')), 'tag filter');
await page.getByRole('button', { name: 'Clear filters' }).click();

// ---- All spaces
await spaceFilter('all');
await settle();
check(/Total\s*14\.50 h/.test(await text('.rp-totals')), 'all spaces total 14.50 h');
check(await page.locator('.rp-table tbody tr', { has: page.locator('.rp-name[title="Website · Work"]') }).count() === 1, 'projects carry the space name in all-spaces mode');
check((await page.locator('.rp-table tbody .rp-name[title="Website · Work"] .rp-name-space').innerText()) === 'Work', 'the space name sits on its own line');
await spaceFilter('Personal');
await settle();

// ---- Detailed (a foldable section of the same page; an old link opens it)
check(await page.locator('.rp-detail').count() === 0, 'the entries section starts folded');
await page.evaluate(() => { location.hash = '#/time/reports/detailed'; });
await settle();
check(await page.locator('.rp-detail').count() === 1 && await page.locator('.rp-table tbody tr').count() > 0, 'the old Detailed link opens the page with the entries section open');
check((await page.getByRole('button', { name: 'Entries' }).getAttribute('aria-expanded')) === 'true', 'the section button says it is open');
check(await page.locator('.rp-detail tbody tr').count() === 5, 'detailed: 5 entries, deleted one hidden');
check((await page.locator('.rp-detail tbody tr').first().innerText()).includes('Overnight'), 'detailed: newest first');
await page.getByRole('button', { name: 'Duration' }).click();
check((await page.locator('.rp-detail tbody tr').first().innerText()).includes('Overnight'), 'detailed: sort by duration descending');
check((await page.locator('th:has(button:text("Duration"))').getAttribute('aria-sort')) === 'descending', 'aria-sort follows the sort');
await page.getByRole('button', { name: 'Duration' }).click();
check((await page.locator('.rp-detail tbody tr').first().innerText()).includes('Admin') || (await page.locator('.rp-detail tbody tr').first().innerText()).includes('design notes'), 'detailed: sort by duration ascending');
await page.getByRole('button', { name: 'Amount' }).click();
check((await page.locator('.rp-detail tbody tr').first().innerText()).includes('Design'), 'detailed: sort by amount puts the largest first');

// ---- CSV and Markdown
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
const csv = readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
const lines = csv.trim().split('\r\n');
check(download.suggestedFilename() === 'time-entries-2025-03-24_to_2025-03-31.csv', `CSV file name (${download.suggestedFilename()})`);
check(lines.length === 6 && lines[0].startsWith('Space,Client,Project,Description'), 'CSV: header and 5 entries');
check(lines.some((l) => l.includes('Overnight') && l.includes('7:00:00,7.0000')), 'CSV: overnight entry is 7 real hours');
await page.getByRole('button', { name: 'Copy as Markdown' }).click();
await settle();
const md = await page.evaluate(() => navigator.clipboard.readText());
check(md.includes('## Time report 2025-03-24 to 2025-03-31') && md.includes('| **Total** | **12.50 h**'), 'Markdown copied with a summary table');

// ---- Hours per day in the one table (the old Weekly grid)
await page.evaluate(() => { location.hash = '#/time/reports/weekly'; });
await settle();
const header = await page.locator('.rp-grid-table thead th').allInnerTexts();
check(header.length === 12 && header[1] === 'Mon 24' && header[9] === 'Total' && header[11] === 'Amount', `weekly header (${header.join('|')})`);
const webRow = (await page.locator('.rp-grid-table tbody tr', { hasText: 'Website' }).first().innerText()).replace(/\s+/g, ' ');
check(webRow.includes('2.00'), `weekly: Website row (${webRow})`);
const footer = (await page.locator('.rp-grid-table tfoot tr').innerText()).replace(/\s+/g, ' ');
check(footer.includes('12.50') && footer.includes('6.00'), `weekly: column and grand totals (${footer})`);

// ---- Hours format (shared setting)
await page.evaluate(() => window.__reports.setHoursFormat('hm'));
await settle();
check((await page.locator('.rp-grid-table tfoot tr').innerText()).replace(/\s+/g, ' ').includes('12:30'), 'h:mm format via the shared setting');
const stored = await page.evaluate(() => window.__app && true);
check(stored === true, 'test hook present');
await page.evaluate(() => window.__reports.setHoursFormat('decimal'));

// ---- Keyboard
await page.getByLabel('Group by', { exact: true }).focus();
await page.keyboard.press('ArrowDown');
await settle();
check(await page.getByLabel('Group by', { exact: true }).inputValue() !== 'project', 'keyboard: select changes with the arrow keys');
await select('Group by', 'project');

// ---- Previous / next period (#277, R-335): the range is 24 to 31 March 2025 (custom, 8 days)
const label = () => text('.rp-range');
const prev = page.getByRole('button', { name: 'Previous period' });
const next = page.getByRole('button', { name: 'Next period' });
check((await page.locator('.rp-back').count()) === 1 && (await page.locator('.rp-pill.off').count()) === 1, 'a range other than This week shows the highlighted label and the way back');
await select('Range', 'custom');
await page.getByLabel('From', { exact: true }).fill('2025-03-24');
await page.getByLabel('To', { exact: true }).fill('2025-03-30');
await settle();
const week1 = await label();
await prev.click();
await settle();
check(/2025-03-17 to 2025-03-23/.test(await label()), `Previous steps a 7-day range back by 7 days (${await label()})`);
await next.click();
await settle();
check((await label()) === week1, 'Next steps forward again to the same range');
await page.getByLabel('Range', { exact: true }).selectOption('custom');
await page.getByLabel('From', { exact: true }).fill('2025-03-01');
await page.getByLabel('To', { exact: true }).fill('2025-03-31');
await settle();
await prev.click();
await settle();
check(/2025-02-01 to 2025-02-28/.test(await label()), `a whole month steps to the month before (${await label()})`);
await prev.focus();
await page.keyboard.press('Enter');
await settle();
check(/2025-01-01 to 2025-01-31/.test(await label()), `the buttons work from the keyboard (${await label()})`);
// stepping from a preset: This week, Previous is Last week; Next is off while the period contains today
await select('Range', 'this_week');
await settle();
check(await next.isDisabled(), 'Next is disabled while the period contains today');
check((await page.locator('.rp-back').count()) === 0, 'no way-back button on This week');
await prev.click();
await settle();
check((await page.locator('select#rp-f-range').inputValue()) === 'last_week', 'This week, Previous equals Last week');
check(!(await next.isDisabled()), 'Next is available once the period has ended');
await page.locator('.rp-back').click();
await settle();
check((await page.locator('select#rp-f-range').inputValue()) === 'this_week' && (await page.locator('.rp-back').count()) === 0, 'one tap on the way-back button returns to This week');
await prev.click();
await next.click();
await settle();
check((await page.locator('select#rp-f-range').inputValue()) === 'this_week', 'Previous then Next from This week returns to This week');
// the range and the view are remembered on this device
await prev.click();
await prev.click();
await settle();
const remembered = await label();
await page.goto('about:blank');
await page.goto(BASE + '?test#/time');
await page.waitForFunction(() => window.__reports);
await page.waitForFunction(() => location.hash === '#/time/reports', null, { timeout: 3000 }).catch(() => {});
await page.locator('.rp-nav').waitFor();
check(await page.locator('.rp-nav').count() === 1 && (await label()) === remembered, `the last view (Reports) and its range are remembered (${remembered})`);
await page.locator('#rp-controls .rp-fold').click();
await select('Range', 'custom');
await page.getByLabel('From', { exact: true }).fill('2025-03-24');
await page.getByLabel('To', { exact: true }).fill('2025-03-31');
await settle();
// the space filter is the Time page's: change it here, see it on List
await spaceFilter('Work');
await page.getByRole('link', { name: 'List' }).click();
await page.locator('.tl-summary').waitFor();
check((await page.getByLabel('Show space').inputValue()) !== 'all', 'the space filter is shared with the List view');
await page.getByRole('link', { name: 'Reports' }).click();
await page.locator('.rp-nav').waitFor();
await spaceFilter('Personal');
await page.locator('#rp-controls .rp-fold').click();
await settle();

// ---- Running entry
await page.evaluate(() => {
  window.__reports.seed('personal', { entries: [{ start: new Date(Date.now() - 5 * 60_000).toISOString(), stop: null, description: 'Running now', billable: false }] });
});
await select('Range', 'today');
await page.waitForFunction(() => !/Total\s*0\.00 h/.test(document.querySelector('.rp-totals')?.textContent ?? ''), null, { timeout: 3000 }).catch(() => {});
check(!/Total\s*0\.00 h/.test(await text('.rp-totals')), 'running entry counts up to now');
check((await page.locator('.rp-detail tbody tr', { hasText: 'Running now' }).innerText()).includes('now'), 'detailed: running entry marked');

// ---- 375 px layout, every report
await page.setViewportSize({ width: 375, height: 800 });
await select('Range', 'custom');
await page.getByLabel('From', { exact: true }).fill('2025-03-24');
await page.getByLabel('To', { exact: true }).fill('2025-03-31');
await settle();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `the page fits 375 px without page scrolling (overflow ${overflow})`);
check(await page.getByRole('region', { name: 'Breakdown table' }).evaluate((el) => el.scrollWidth > el.clientWidth), 'the table scrolls sideways at 375 px');
// a long project name truncates, keeps its full text as title, and the first day stays reachable
await page.evaluate(() => window.__reports.seed('personal', {
  projects: [{ ref: 'long', name: 'ZX-OPS Q4-0000-TEST-0001 very long sample project code' }],
  entries: [{ start: '2025-03-24T08:00:00Z', stop: '2025-03-24T09:00:00Z', description: 'Long', project: 'long' }],
}));
await settle();
const longName = page.locator('.rp-grid-table tbody th', { hasText: 'ZX-OPS Q4-0000' }).first();
check((await longName.evaluate((th) => th.getBoundingClientRect().width)) < 200, 'a long project name stays narrow at 375 px');
check((await longName.locator('.rp-name').getAttribute('title')).includes('very long sample project code'), 'the long name is in the title');
check(await longName.locator('.rp-name-text').evaluate((el) => el.scrollWidth > el.clientWidth), 'the long name is truncated');
check((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'a long name causes no page scrolling at 375 px');
// folds are remembered on this device
await page.getByRole('button', { name: 'Chart', exact: true }).click();
await page.reload();
await page.waitForFunction(() => window.__reports);
check((await page.locator('#rp-controls .rp-fold').getAttribute('aria-expanded')) === 'false' && /·/.test(await page.locator('#rp-controls .rp-fold').innerText()), 'the filters are one line after a reload');
check(await page.locator('svg.rp-svg').count() === 0 && await page.locator('.rp-detail').count() === 1, 'a folded chart stays folded and an opened entries section stays open after a reload');
check(await page.locator('[style]').evaluateAll((els) => els.filter((e) => e.closest('.rp') && !e.classList.contains('rp-dot') && !e.classList.contains('rp-share')).length) === 0, 'no unexpected inline style attributes in the module');

await finish(browser);
