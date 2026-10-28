// End-to-end for the Settings page (one page, F-326): hours format and week start change Timer, Entries and
// Reports; theme switch applies; no CSP violations or page errors.
// Runs against dist/ served with the real headers.
//
//   npm run e2e settings
//
import { BASE, launch, check, watchPage, poll, finish } from './lib.mjs';


const browser = await launch();
const context = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'en-US', viewport: { width: 1100, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
watchPage(page, 'settings', { consoleErrors: true });

const go = async (hash, ready) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.locator(ready).first().waitFor();
};
// Shared settings live in the account document.
const stored = () => page.evaluate(() => window.__app.json(`account/${window.__app.accountId()}`, 'settings'));
// First day of the week shown on Entries, as a weekday number (0 = Sunday).
const entriesWeekStartsOn = async () => {
  const label = await page.locator('.week-label').innerText();
  const first = label.split('–')[0].trim();
  return new Date(`${first}, ${new Date().getFullYear()}`).getDay();
};
const reportsWeekStartsOn = async () => {
  const label = await page.locator('.rp-range').innerText();
  const m = /(\d{4})-(\d\d)-(\d\d)/.exec(label);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
};

await page.goto(`${BASE}?test#/settings`);
await page.locator('h1', { hasText: 'Settings' }).waitFor();
check((await page.getByLabel('Week starts on').inputValue()) === 'monday', 'week starts on Monday by default');
check((await page.getByLabel('Hours shown as').inputValue()) === 'decimal', 'hours shown as decimal by default');
check((await page.getByRole('link', { name: 'Import from Toggl' }).count()) === 0, 'Settings does not repeat the Toggl import in Preferences');
check((await page.locator('details > summary', { hasText: 'History warnings' }).count()) === 1, 'Settings folds the history warnings');
check((await page.locator('.manage-list, .manage-tabs').count()) === 0, 'Settings has no sub-menu');
check((await page.getByRole('heading', { level: 2 }).allInnerTexts()).join('|') === 'Your data|Preferences|About & help', 'Settings is three cards: Your data, Preferences, About & help');
// A space: no raw id is shown; renaming keeps the id, and a taken name is refused.
await page.locator('table.st-keeps').getByRole('link', { name: 'Personal', exact: true }).click();
await page.getByLabel('Name of space Personal').waitFor();
const ids = await page.locator('.st-space-id').allInnerTexts();
check(ids.length === 0, 'a space shows no raw id');
const personal = page.getByLabel('Name of space Personal');
await personal.fill('Home');
await personal.press('Enter');
check(
  (await poll(async () => (await page.locator('.st-space-id').allInnerTexts()).map((t) => t.trim()).join() === ids.map((t) => t.trim()).join() && (await page.getByLabel('Name of space Home').count()) === 1)) >= 0,
  'renaming a space keeps its id',
);
await go('#/settings', 'table.st-keeps');
await page.locator('table.st-keeps').getByRole('link', { name: 'Work', exact: true }).click();
const work = page.getByLabel('Name of space Work');
await work.fill('home');
await work.press('Enter');
check((await poll(async () => (await page.getByText('There is already a space called').count()) === 1)) >= 0, 'a name already used by another space (any case) is refused');
await go('#/settings', 'table.st-keeps');
await page.locator('table.st-keeps').getByRole('link', { name: 'Home', exact: true }).click();
await page.getByLabel('Name of space Home').fill('Personal');
await page.getByLabel('Name of space Home').press('Enter');
check((await poll(async () => (await page.getByLabel('Name of space Personal').count()) === 1)) >= 0, 'the space is renamed back');
await go('#/settings', 'h1');

// ---- Defaults on the other pages
await go('#/entries', '.week-label');
check((await entriesWeekStartsOn()) === 1, 'entries: week starts on Monday');
check(/\d+\.\d\d h/.test(await page.locator('.section-head .total').innerText()), 'entries: decimal hours');
await go('#/timer/reports', '.rp-range');
check((await reportsWeekStartsOn()) === 1, 'reports: week starts on Monday');
check((await page.getByLabel('Hours shown as').count()) === 0, 'reports: no hours selector');
await go('#/timer/list', '.timer-bar');
check((await page.getByLabel('Hours format').count()) === 0, 'timer: no hours selector');

// ---- Change both on Settings
await go('#/settings', 'h1');
await page.getByLabel('Week starts on').selectOption('sunday');
await page.getByLabel('Hours shown as').selectOption('hm');
check((await stored()).week_start === 'sunday' && (await stored()).hours_format === 'hm', 'settings map holds sunday and hm');

await go('#/entries', '.week-label');
check((await entriesWeekStartsOn()) === 0, 'entries: week starts on Sunday');
check(/^\d+:\d\d$/.test((await page.locator('.section-head .total').innerText()).trim()), 'entries: h:mm hours');
await go('#/timer/reports', '.rp-range');
check((await reportsWeekStartsOn()) === 0, 'reports: week starts on Sunday');
await go('#/timer/list', '.timer-bar');
check(!/ h\b/.test(await page.locator('.timer-bar').innerText()), 'timer: no decimal hours in the bar');

// ---- Theme
await go('#/settings', 'h1');
const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
await page.getByLabel('Theme').selectOption('dark');
check((await theme()) === 'dark', 'dark theme sets data-theme');
check((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(26, 25, 23)', 'dark background applied');
await page.getByLabel('Theme').selectOption('light');
check((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(250, 247, 242)', 'light background applied');
await page.reload();
await page.locator('h1', { hasText: 'Settings' }).waitFor();
check((await theme()) === 'light', 'theme survives a reload');
await page.getByLabel('Theme').selectOption('system');
check((await theme()) === null, 'system theme removes data-theme');

// ---- Export and import buttons are gone (backups and sync carry the settings)
check((await page.getByRole('button', { name: 'Export settings' }).count()) === 0, 'Settings has no Export settings button');
check((await page.getByLabel('Import settings').count()) === 0, 'Settings has no Import settings control');

// ---- 375 px layout
await page.setViewportSize({ width: 375, height: 800 });
await go('#/settings', 'h1');
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 375 px');

await finish(browser);
