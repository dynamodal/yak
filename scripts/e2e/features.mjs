// End-to-end for Features and Security (F-309): Welcome's presets set this device's hidden list, a hidden
// page's route goes to the first visible tab, the Features page turns pages back on, and passphrase fields have a Show switch
// and a live hint.
//
//   npm run e2e features
//
import { BASE, launch, check, watchPage, finish, pill, startRound, stopRound, poll } from './lib.mjs';

const browser = await launch();

async function open(name, hash) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}${hash}`);
  return page;
}
const tabs = async (p) => (await p.locator('.tabs > *').allInnerTexts()).map((t) => t.trim());
const hidden = (p) => p.evaluate(() => localStorage.getItem('hidden_modules'));
const hash = (p) => p.evaluate(() => location.hash);

// ---- Welcome: Time tracker hides Home, Notes and Tasks on this device
{
  const p = await open('tracker', '?test&welcome');
  await p.getByRole('button', { name: 'Time tracker' }).click();
  await p.locator('.tabs').waitFor();
  check((await tabs(p)).join() === 'Time,Settings', `Time tracker: only Timer, Settings (${(await tabs(p)).join()})`);
  check((await hidden(p)) === '["home","notes","tasks"]', `the preset is stored on this device (${await hidden(p)})`);

  // A hidden page's route goes to the timer.
  for (const route of ['#/notes', '#/tasks']) {
    await p.evaluate((r) => (location.hash = r), route);
    await p.waitForFunction(() => location.hash === '#/time', null, { timeout: 5000 }).catch(() => {});
    check((await hash(p)) === '#/time', `${route} goes to the timer when hidden`);
  }
  // The command palette has no "Go to Notes".
  check(!(await p.evaluate(() => document.body.innerText)).includes('Go to Notes'), 'no Go to Notes while hidden');

  // Features page: Notes back on shows Notes only; Tasks stays hidden until ticked.
  await p.evaluate(() => (location.hash = '#/settings'));
  await p.getByRole('checkbox', { name: 'Notes', exact: true }).check();
  check((await tabs(p)).join() === 'Time,Notes,Settings', `Notes on: Notes tab only (${(await tabs(p)).join()})`);
  await p.getByLabel('Tasks', { exact: true }).check();
  check((await tabs(p)).join() === 'Time,Notes,Tasks,Settings', 'Tasks on: Tasks tab');
  // Reports is a segment of the Time page (R-335): hiding it removes the segment and sends its routes to the timer.
  const seg = (name) => p.getByRole('navigation', { name: 'Time views' }).getByRole('link', { name });
  await p.evaluate(() => (location.hash = '#/time/list'));
  await seg('List').waitFor();
  check((await seg('Reports').count()) === 1, 'Reports is a segment of the Time page');
  check((await p.getByLabel('Reports', { exact: true }).count()) === 0, 'there is no separate Reports switch: Reports follows Time');
  // An old stored `reports` entry (the switch is gone) hides nothing.
  await p.evaluate(() => localStorage.setItem('hidden_modules', '["reports"]'));
  await p.evaluate(() => (location.hash = '#/time/reports'));
  await p.locator('.rp-nav').waitFor();
  check((await hash(p)) === '#/time/reports', 'a stale `reports` entry in hidden_modules leaves Reports shown');
  await p.evaluate(() => localStorage.setItem('hidden_modules', '[]'));
  await p.evaluate(() => (location.hash = '#/settings'));
  // Notes and Tasks are separate switches (F-33n): Notes off keeps Tasks, and the Tasks switch stays usable.
  await p.getByRole('checkbox', { name: 'Notes', exact: true }).uncheck();
  check((await tabs(p)).join() === 'Home,Time,Tasks,Settings', `Notes off keeps Tasks (${(await tabs(p)).join()})`);
  check(!(await p.getByLabel('Tasks', { exact: true }).isDisabled()), 'the Tasks switch is not locked while Notes is hidden');
  // A hidden Settings page goes to Settings (a visible page), not the timer.
  await p.getByLabel('Import', { exact: true }).uncheck();
  await p.evaluate(() => (location.hash = '#/settings/import'));
  await p.waitForFunction(() => location.hash === '#/settings', null, { timeout: 5000 }).catch(() => {});
  check((await hash(p)) === '#/settings', `a hidden Settings page lands on Settings (${await hash(p)})`);
  // Backup & restore cannot be hidden: no switch for it, and the page still opens.
  await p.evaluate(() => (location.hash = '#/settings/backup'));
  await p.getByRole('heading', { name: 'Backup & restore' }).waitFor();
  check(true, 'Backup & restore still opens with Notes hidden');
  await p.context().close();
}

// ---- Welcome: Time, notes and tasks hides nothing
{
  const p = await open('everything', '?test&welcome');
  await p.getByRole('button', { name: 'Time, notes and tasks' }).click();
  await p.locator('.tabs').waitFor();
  check((await tabs(p)).join() === 'Home,Time,Notes,Tasks,Settings', 'Time, notes and tasks: all tabs');
  check((await hidden(p)) === '[]', 'the preset stores an empty list');

  // ---- Security: Show switch and live hint
  await p.evaluate(() => (location.hash = '#/settings/backup'));
  await p.getByRole('heading', { name: 'What your passphrase protects' }).waitFor();
  await p.getByRole('button', { name: 'Create a passphrase…' }).click();
  const sheet = p.locator('[data-passphrase-sheet]');
  await sheet.getByRole('button', { name: 'Type my own' }).click();
  const field = sheet.getByLabel('New passphrase');
  await field.fill('short one');
  check((await field.getAttribute('type')) === 'password', 'the field hides what is typed');
  check(await p.getByText(/Use at least 20 characters/).first().isVisible(), 'live hint: refused under 20');
  await sheet.getByLabel('Repeat the passphrase').fill('short one');
  await sheet.getByLabel("I've written it down").check();
  check(await p.getByText(/Use at least 20 characters/).first().isVisible() && (await sheet.getByRole('button', { name: /^Create and / }).isDisabled()), 'a short passphrase is refused');
  await sheet.getByLabel('Show').first().check();
  check((await field.getAttribute('type')) === 'text', 'Show reveals it');
  await field.fill('a passphrase of 25 chars!');
  check(await p.getByText('This works, but four or more random words is best.').isVisible(), 'live hint: warned under 28');
  await field.fill('correct horse battery staple');
  check(await p.getByText('Long enough.').isVisible(), 'live hint: long enough');
  // Backup & restore shows the same passphrase state.
  await p.evaluate(() => (location.hash = '#/settings/backup'));
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  check(await p.getByRole('button', { name: 'Create a passphrase…' }).waitFor({ timeout: 5000 }).then(() => true, () => false), 'Backup & restore offers to create a passphrase');
  await p.context().close();
}

// ---- Time switch (F-33l): hides the tab, Reports, the pill, Alt+S and the cue; never with a timer running
{
  const p = await open('time-off', '?test&welcome');
  await p.getByRole('button', { name: 'Time, notes and tasks' }).click();
  await p.locator('.tabs').waitFor();
  const running = () => p.evaluate(() => ['space/personal', 'space/work'].reduce((n, id) => n + Object.values(window.__app.json(id + '/time', 'time_entries') ?? {}).filter((e) => e.stop === null && !e.deleted).length, 0));
  const count = () => p.evaluate(() => ['space/personal', 'space/work'].reduce((n, id) => n + Object.keys(window.__app.json(id + '/time', 'time_entries') ?? {}).length, 0));
  await startRound(p).click();
  await poll(async () => (await running()) === 1);
  await p.evaluate(() => (location.hash = '#/settings'));
  check(await p.getByLabel('Time', { exact: true }).isDisabled(), 'the Time switch is locked while a timer runs');
  check(await p.getByText('A timer is running. Stop it before hiding Time.').isVisible(), 'and says why');
  await stopRound(p).click();
  await poll(async () => (await running()) === 0);
  check(await poll(async () => !(await p.getByLabel('Time', { exact: true }).isDisabled())), 'the Time switch unlocks once the timer is stopped');
  await p.getByLabel('Time', { exact: true }).uncheck();
  check((await tabs(p)).join() === 'Home,Notes,Tasks,Settings', `Time off: no Time tab (${(await tabs(p)).join()})`);
  check((await pill(p).count()) === 0, 'Time off: no timer pill in the header');
  check((await hidden(p)) === '["time"]', `the choice is stored on this device (${await hidden(p)})`);
  for (const route of ['#/time', '#/time/week', '#/time/reports', '#/reports', '#/entries']) {
    await p.evaluate((r) => (location.hash = r), route);
    await p.waitForFunction(() => location.hash === '#/home', null, { timeout: 5000 }).catch(() => {});
    check((await hash(p)) === '#/home', `${route} lands on the first visible tab, Home (${await hash(p)})`);
  }
  const before = await count();
  await p.keyboard.press('Alt+s');
  await p.waitForTimeout(300);
  check((await count()) === before, 'Alt+S does nothing while Time is hidden');
  check(!(await p.evaluate(() => document.body.innerText)).includes('Start or stop the timer') && !(await p.evaluate(() => document.body.innerText)).includes('Go to Time'), 'no timer commands while Time is hidden');
  check((await p.title()) === 'Yak' || !(await p.title()).includes('Not tracking'), `the title cue is off (${await p.title()})`);
  // Every other feature off too: Settings, which is never hidden.
  await p.evaluate(() => (location.hash = '#/settings'));
  await p.getByLabel('Home', { exact: true }).uncheck();
  await p.getByRole('checkbox', { name: 'Notes', exact: true }).uncheck();
  await p.getByLabel('Tasks', { exact: true }).uncheck();
  check((await tabs(p)).join() === 'Settings', `all features off: only Settings (${(await tabs(p)).join()})`);
  await p.evaluate(() => (location.hash = '#/time'));
  await p.waitForFunction(() => location.hash === '#/settings', null, { timeout: 5000 }).catch(() => {});
  check((await hash(p)) === '#/settings', 'with every other feature off the app lands on Settings');
  // Back on: data was kept, the pill returns.
  await p.getByLabel('Time', { exact: true }).check();
  check((await tabs(p)).join() === 'Time,Settings', 'Time on again: the tab returns');
  check(await poll(async () => (await pill(p).count()) === 1), 'Time on again: the pill returns');
  await p.context().close();
}

await finish(browser);
