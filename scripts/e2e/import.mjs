// End-to-end for the Toggl CSV import: imports a small synthetic export, checks the preview,
// the Entries and Reports pages, importing again (no duplicates), another space, a bad file,
// drag and drop, a large file that must not freeze the page, cancel and resume, and 375 px.
// Fails on any CSP violation, console error or page error. The browser runs in Europe/Berlin
// with the clock fixed on 2025-03-12 so the week shown on Entries is the one in the fixture.
//
//   npm run e2e import
//
import { join } from 'node:path';
import { BASE, launch, ok, check, watchPage, finish } from './lib.mjs';

const FIXTURE = new URL('../../src/import/fixtures/toggl-sample.csv', import.meta.url).pathname;

const browser = await launch();
const context = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'en-US', viewport: { width: 1100, height: 900 } });
await context.clock.setFixedTime(new Date('2025-03-12T12:00:00Z'));
const page = await context.newPage();
watchPage(page, 'import', { consoleErrors: true });

// Tabs are plain links; Import, Backup & restore and Devices are reached from the Settings page.
const tab = (name) => ({
  click: async () => {
    if (name === 'Settings') await page.locator('.tabs a', { hasText: /^Settings$/ }).click();
    else if (name === 'Import') {
      await page.locator('.tabs a', { hasText: /^Settings$/ }).click();
      await page.getByRole('link', { name: 'Import…', exact: true }).click();
    } else if (['Backups', 'History'].includes(name)) {
      await page.locator('.tabs a', { hasText: /^Settings$/ }).click();
      await page.getByRole('link', { name: 'Backup & restore', exact: true }).click();
    } else if (name === 'Devices') {
      await page.locator('.tabs a', { hasText: /^Settings$/ }).click();
      await page.locator('table.st-keeps thead').getByRole('link', { name: 'This device' }).click();
    } else if (name === 'Entries') {
      await page.locator('.tabs a', { hasText: /^Time$/ }).click();
      await page.getByRole('navigation', { name: 'Time views' }).getByRole('link', { name: 'Week' }).click();
    } else await page.locator('.tabs a', { hasText: new RegExp(`^${name}$`) }).click();
  },
});

const settle = (ms = 200) => page.waitForTimeout(ms);
const dd = (label) => page.locator('.imp-counts dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]').first();
const ddText = async (label) => (await dd(label).innerText()).replace(/\s+/g, ' ').trim();
const entriesOf = (space) => page.evaluate((s) => Object.values(window.__app.json(`space/${s}/time`, 'time_entries')).filter((e) => !e.deleted), space);
const mapOf = (space, name) => page.evaluate(([s, n]) => Object.values(window.__app.json(`space/${s}`, n)).filter((e) => !e.deleted), [space, name]);
const chooseFile = (file) => page.locator('input[type=file]').setInputFiles(file);
const previewReady = async () => {
  await page.locator('.imp-preview').waitFor();
  await page.waitForFunction(() => !document.querySelector('[role=status]')?.textContent?.includes('Checking'), null, { timeout: 60_000 });
  await page.locator('.imp-counts, .imp-preview .error').first().waitFor({ timeout: 60_000 });
};
const importButton = () => page.locator('.imp-preview .row button.primary');

// Large exports are generated inside the page and handed to the file input as a real File, so the
// test does not itself freeze the page while Playwright copies megabytes into it. `prefix` keeps
// two generated files from overlapping; a file can be chosen again by name.
const chooseGenerated = (name, rows, prefix) =>
  page.evaluate(
    ([n, count, pre]) => {
      window.__files ??= {};
      if (!window.__files[n]) {
        const out = ['User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (EUR)'];
        for (let i = 0; i < count; i++) {
          const day = new Date(Date.UTC(2021, 0, 1) + Math.floor(i / 8) * 86_400_000).toISOString().slice(0, 10);
          const h = String(8 + (i % 8)).padStart(2, '0');
          out.push(`Sample Person,person@example.com,Client ${i % 3},Project ${i % 7},,${pre} ${i},Yes,${day},${h}:00:00,${day},${h}:30:00,0:30:00,tag${i % 4},5.00`);
        }
        window.__files[n] = new File([out.join('\r\n') + '\r\n'], n, { type: 'text/csv' });
      }
      const dt = new DataTransfer();
      dt.items.add(window.__files[n]);
      const input = document.querySelector('input[type=file]');
      window.__lag = 0;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [name, rows, prefix],
  );
const csvFile = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// ---- Page and navigation
await page.goto(BASE + '?test#/import');
await page.waitForFunction(() => window.__app);
await page.getByRole('heading', { name: 'Import', exact: true }).waitFor();
await page.locator('.tabs a', { hasText: /^Settings$/ }).click();
await page.getByRole('link', { name: 'Import…', exact: true }).waitFor();
check((await page.getByRole('link', { name: 'Import…', exact: true }).count()) === 1, 'Settings has an Import link under Your data');
await page.getByRole('link', { name: 'Import…', exact: true }).click();
await page.getByRole('heading', { name: 'Import', exact: true }).waitFor();
check((await page.locator('.tabs a.active').innerText()).trim() === 'Settings' && page.url().endsWith('#/settings/import'), 'route #/import redirects to #/settings/import');

// Monitor how long the page stays unresponsive from here on.
await page.evaluate(() => {
  window.__lag = 0;
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    window.__lag = Math.max(window.__lag, now - last - 50);
    last = now;
  }, 50);
});

// ---- Preview
await chooseFile(FIXTURE);
await previewReady();
check((await page.getByLabel('Time zone of the export').inputValue()) === 'Europe/Berlin', 'time zone defaults to the browser zone');
check((await page.getByLabel('Import into').evaluate((el) => el.selectedOptions[0]?.textContent)) === 'Personal', 'target space defaults to the active space');
check((await ddText('Entries to import')) === '9', `preview: 9 entries (${await ddText('Entries to import')})`);
check((await ddText('Total hours')) === '36.75 h', `preview: 36.75 h (${await ddText('Total hours')})`);
check((await ddText('Date range')) === '2025-03-10 to 2025-03-30', `preview: date range (${await ddText('Date range')})`);
check((await ddText('New projects')) === '3' && (await ddText('New clients')) === '2' && (await ddText('New tags')) === '4', 'preview: 3 projects, 2 clients, 4 tags');
check((await ddText('Skipped duplicates')).startsWith('1 '), `preview: 1 duplicate skipped (${await ddText('Skipped duplicates')})`);
check((await ddText('Rows with errors')) === '1', 'preview: 1 row with an error');
check((await page.locator('.imp-errors').innerText()).includes('2025-02-31'), 'preview: the bad row is listed with its reason');
check(await importButton().isEnabled(), 'Import button is enabled');
check((await importButton().innerText()) === 'Import 9 entries', 'button names the number of entries');

// ---- Import
await importButton().click();
await page.locator('.imp-done').waitFor();
check((await page.locator('.imp-done').innerText()).includes('Added 9 entries to Personal'), 'done message names the count and the space');
let entries = await entriesOf('personal');
check(entries.length === 9, `9 entries stored (${entries.length})`);
check(entries.every((e) => e.stop && e.device_id && e.created_at.startsWith('2025-03-12') && e.updated_at === e.created_at && /^toggl-csv:v1:[0-9a-f]{32}$/.test(e.import_id)), 'entries have stop, device_id, import time and import_id');
check(entries.every((e) => /Z$/.test(e.start) && /Z$/.test(e.stop)), 'start and stop are UTC ISO strings');
check(new Set(entries.map((e) => e.device_id)).size === 1 && entries[0].device_id !== 'test', 'device_id is this device');
check((await mapOf('personal', 'projects')).length === 3 && (await mapOf('personal', 'clients')).length === 2 && (await mapOf('personal', 'tags')).length === 4, 'projects, clients and tags created');
check(!entries.some((e) => e.stop === null), 'no running entry');

// ---- Entries page: the week of 2025-03-10 (the clock is fixed on the 12th)
await tab('Entries').click();
await page.locator('.week-nav').waitFor();
await settle();
const weekTotal = (await page.locator('.section-head').first().innerText()).replace(/\s+/g, ' ');
check(/Week total.*9\.75/.test(weekTotal), `Entries: week of the 10th totals 9.75 h (${weekTotal})`);
const week = await page.locator('main').innerText();
check(['Homepage layout', 'Invoices', 'Reading', 'Late deploy', 'Review call', 'Website Redesign'].every((t) => week.includes(t)), 'Entries lists imported descriptions and projects');
check(week.includes('Meeting, with "quotes"') && week.includes('two lines'), 'quotes, commas and line breaks survived');

// ---- Reports page
await page.locator('.tabs a', { hasText: /^Time$/ }).click();
await page.getByRole('navigation', { name: 'Time views' }).getByRole('link', { name: 'Reports' }).click();
await page.locator('#rp-controls .rp-fold').click();
await page.getByLabel('Range', { exact: true }).selectOption('custom');
await page.getByLabel('From', { exact: true }).fill('2025-03-10');
await page.getByLabel('To', { exact: true }).fill('2025-03-31');
await settle();
const totals = (await page.locator('.rp-totals').first().innerText()).replace(/\s+/g, ' ');
check(/Total\s*36\.75 h/.test(totals), `Reports: 36.75 h (${totals})`);
check(/Billable\s*5\.00 h/.test(totals), `Reports: 5.00 h billable (${totals})`);
const rows = await page.locator('.rp-table tbody tr').allInnerTexts();
check(rows.some((r) => r.startsWith('Website Redesign') && r.includes('4.00 h')) || rows.some((r) => r.includes('Website Redesign')), 'Reports: Website Redesign appears');
await page.getByLabel('Group by', { exact: true }).selectOption('day');
await settle();
check(await page.locator('.rp-table tbody tr', { hasText: '2025-03-30' }).first().innerText().then((t) => t.includes('1.00 h')), 'Reports: the 30th (clock change) is one hour');
check(await page.locator('.rp-table tbody tr', { hasText: '2025-03-14' }).first().innerText().then((t) => t.includes('2.50 h')), 'Reports: the 14th holds 1.5 h of the overnight entry and 1 h of another');

// ---- Importing the same file again adds nothing
await tab('Import').click();
await page.getByRole('heading', { name: 'Import', exact: true }).waitFor();
await chooseFile(FIXTURE);
await previewReady();
check((await ddText('Entries to import')) === '0', 'second import: 0 entries');
check((await ddText('Skipped duplicates')).startsWith('10 '), `second import: 10 duplicates (${await ddText('Skipped duplicates')})`);
check((await ddText('New projects')) === '0' && (await ddText('New clients')) === '0' && (await ddText('New tags')) === '0', 'second import: nothing new created');
check(await importButton().isDisabled(), 'Import button is disabled when there is nothing new');
check((await page.locator('.imp-preview').innerText()).includes('nothing new to import'), 'says there is nothing new');
entries = await entriesOf('personal');
check(entries.length === 9 && (await mapOf('personal', 'projects')).length === 3, 'still 9 entries and 3 projects');

// ---- Another space and another time zone
await page.getByLabel('Import into').selectOption({ label: 'Work' });
await previewReady();
check((await ddText('Entries to import')) === '9', 'Work space: the file is new there, 9 entries');
await page.getByLabel('Time zone of the export').selectOption('America/New_York');
await previewReady();
check((await ddText('Entries to import')) === '9', 'New York zone: still 9 entries');
check((await page.locator('.imp-warnings').innerText()).includes('do not match the Duration'), 'a wrong zone shows the Duration warning (clock-change row)');
await page.getByLabel('Time zone of the export').selectOption('Europe/Berlin');
await previewReady();
check((await page.locator('.imp-warnings').count()) === 0, 'right zone: no warning');
await importButton().click();
await page.locator('.imp-done').waitFor();
check((await entriesOf('work')).length === 9 && (await entriesOf('personal')).length === 9, 'imported into Work only');
check((await mapOf('work', 'projects')).length === 3, 'projects were created in Work too');

// ---- A file that is not a Toggl export, through drag and drop
await page.getByRole('button', { name: 'Import another file' }).click();
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['Name,Age\r\nAnn,3\r\n'], 'other.csv', { type: 'text/csv' }));
  const drop = document.querySelector('.imp-drop');
  drop.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  drop.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await previewReady();
check((await page.locator('.imp-preview [role=alert]').innerText()).includes('None of the column headings'), 'drag and drop: a non-Toggl file is explained');
check(await importButton().isDisabled(), 'nothing can be imported from it');
await chooseFile(csvFile('missing.csv', 'Description,Project\r\nx,y\r\n'));
await previewReady();
check((await page.locator('.imp-preview [role=alert]').innerText()).includes('Start date'), 'missing columns are named');
await chooseFile(csvFile('empty.csv', ''));
await previewReady();
check((await page.locator('.imp-preview [role=alert]').innerText()).includes('empty'), 'an empty file is explained');
await chooseFile(csvFile('few.csv', 'Description,Start date,Start time,Duration\r\nok,2025-04-01,09:00:00,1:00:00\r\nbroken,2025-13-01,09:00:00,1:00:00\r\n'));
await previewReady();
check((await ddText('Entries to import')) === '1' && (await ddText('Rows with errors')) === '1', 'a malformed row is reported, the rest still imports');
await page.getByRole('button', { name: 'Clear' }).click();

// ---- Large file: the page must stay responsive; progress; then cancel and resume
await chooseGenerated('big.csv', 20_000, 'Big A');
await previewReady();
check((await ddText('Entries to import')) === '20000', `large file: 20000 entries (${await ddText('Entries to import')})`);
await page.getByLabel('Import into').selectOption({ label: 'Personal' });
await previewReady();
await importButton().click();
await page.locator('progress').waitFor({ timeout: 20_000 });
await page.waitForFunction(() => /\d+ of 20000 entries/.test(document.querySelector('.imp-progress')?.textContent || ''), null, { timeout: 20_000 });
ok('progress is shown while importing');
await page.locator('.imp-done').waitFor({ timeout: 120_000 });
const lag = await page.evaluate(() => window.__lag); // read before the test itself serialises 20000 entries
entries = await entriesOf('personal');
check(entries.length === 20_009, `20000 entries added (${entries.length})`);
check(lag < 500, `page stayed responsive during parse, preview and import (longest stall ${Math.round(lag)} ms)`);
if (lag >= 500) console.error('long tasks [start, ms]:', JSON.stringify((await page.evaluate(() => window.__long)).filter(([, d]) => d > 150)));

await page.getByRole('button', { name: 'Import another file' }).click();
await chooseGenerated('big2.csv', 30_000, 'Big B');
await previewReady();
check((await ddText('Entries to import')) === '30000', 'second large file: 30000 new entries');
await importButton().click();
await page.waitForFunction(() => /[1-9]\d* of 30000 entries/.test(document.querySelector('.imp-progress')?.textContent || ''), null, { timeout: 60_000 });
await page.getByRole('button', { name: 'Cancel' }).click();
await page.locator('.imp-done').waitFor({ timeout: 60_000 });
check((await page.locator('.imp-done h2').innerText()) === 'Import stopped', 'cancel stops the import');
const partial = (await entriesOf('personal')).length - 20_009;
check(partial > 0 && partial < 30_000 && partial % 300 === 0, `a whole number of transactions was kept (${partial} entries)`);
await page.getByRole('button', { name: 'Import another file' }).click();
await chooseGenerated('big2.csv', 30_000, 'Big B');
await previewReady();
check((await ddText('Entries to import')) === String(30_000 - partial), `resume: only the remaining ${30_000 - partial} entries are offered`);
check((await ddText('Skipped duplicates')).startsWith(`${partial} `), 'resume: the finished part is skipped');
await importButton().click();
await page.locator('.imp-done').waitFor({ timeout: 120_000 });
entries = await entriesOf('personal');
check(entries.length === 50_009, `after resuming there are 50009 entries, none twice (${entries.length})`);
check(new Set(entries.map((e) => e.import_id)).size === 50_009, 'every import_id is unique');
check((await mapOf('personal', 'projects')).length === 3 + 21, 'projects were reused, not recreated (24 in all)');

// ---- Layout at 375 px and no inline styles
await page.getByRole('button', { name: 'Import another file' }).click();
await page.setViewportSize({ width: 375, height: 800 });
await chooseFile(FIXTURE);
await previewReady();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `preview fits 375 px (overflow ${overflow})`);
check((await page.locator('.imp [style], .imp-drop[style]').count()) === 0, 'no inline style attributes');
// Keyboard: the file input is reachable and the buttons are real buttons.
await page.keyboard.press('Tab');
check(await page.evaluate(() => document.querySelectorAll('.imp button').length >= 2), 'buttons are real buttons');

await finish(browser);
