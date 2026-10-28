// Cross-module check on the whole app: a task starts a real timer through the bus, the timer
// stops from the Timer view, reports show the entry, and the status dot is amber.
// Runs against dist/ served with the real headers.
//
//   npm run e2e integration
//
import { BASE, launch, sleep, ok, fail, check, watchPage, poll, finish } from './lib.mjs';

const until = (fn, ms = 8000) => poll(fn, ms);

const browser = await launch();
const page = await (await browser.newContext()).newPage();
watchPage(page, 'integration', { consoleErrors: true });

const entries = () => page.evaluate(() => window.__app.json('space/personal/time', 'time_entries'));

await page.goto(`${BASE}?test#/tasks`);
await page.locator('input[aria-label="New task"]').fill('Write report @work');
await page.locator('input[aria-label="New task"]').press('Enter');
(await until(() => page.getByRole('button', { name: 'Start timer for Write report' }).isVisible())) ? ok('task created') : fail('task not created');

await page.getByRole('button', { name: 'Start timer for Write report' }).click();
const running = async () => Object.values(await entries()).filter((e) => e.stop === null && !e.deleted);
(await until(async () => (await running()).length === 1)) ? ok('Start timer on a task started a time entry') : fail('no running entry after Start timer');
const [entry] = await running();
entry && entry.description.includes('Write report') ? ok(`entry described "${entry.description}"`) : fail(`unexpected description: ${entry?.description}`);
entry && entry.task_id ? ok('entry is linked to the task (task_id set)') : fail('entry has no task_id');

await page.goto(`${BASE}?test#/time`);
await sleep(1200);
await page.getByRole('button', { name: 'Stop', exact: true }).first().click();
(await until(async () => (await running()).length === 0)) ? ok('stopped from the Timer view') : fail('timer did not stop');

await page.goto(`${BASE}?test#/time/reports/detailed`);
(await until(() => page.locator('main').innerText().then((t) => t.includes('Write report')))) ? ok('Detailed report lists the entry') : fail('entry missing from the Detailed report');

(await page.locator('.tab-dot.warn').count()) > 0 ? ok('Settings dot is amber (no backup made yet)') : fail('Settings dot is not amber');

for (const route of ['time', 'entries', 'projects', 'reports', 'notes', 'tasks', 'backups', 'devices']) {
  await page.goto(`${BASE}?test#/${route}`);
  await sleep(300);
  const text = await page.locator('main').innerText();
  text.trim().length > 0 ? ok(`#/${route} renders`) : fail(`#/${route} is empty`);
}

await finish(browser);
