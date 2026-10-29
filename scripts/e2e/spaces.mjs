// End-to-end: which spaces each device keeps. Over the site relay: a device that has just joined keeps
// nothing, and nothing of any space reaches it until it chooses; choosing only Work gets it Work and no
// Personal. Another device can untick a space for a device (and the device sees it), what is not kept
// stays off in both directions while the other space keeps syncing, the choice survives a reload, and
// keeping a space again catches up. A device can also stop keeping a space itself. Also checks that
// time entries live in the space's private document.
//
//   SITE_RELAY=1 node scripts/serve-dist.mjs 4190 &   # or: npm run e2e spaces
//   node scripts/e2e/spaces.mjs
//
import { BASE, launch, sleep, ok, fail, check, watchPage, until, finish, keepAllSpaces, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  return page;
};
const st = (p) => p.evaluate(() => window.__app?.state());
const text = (p, id) => p.evaluate((d) => window.__app.text(d, 't') ?? '', id);
const spaceDocsOf = async (p) => (await p.evaluate(() => window.__app.docs())).filter((d) => d.startsWith('space/'));
const setName = async (p, name) => {
  await p.evaluate(() => { location.hash = '#/settings/devices-sync/this'; });
  const input = p.locator('input[aria-label="This device\'s name"]');
  await input.fill(name);
  await input.press('Enter');
  await input.blur();
};
// The keep chips live in the rows of Settings (F-33): this opens the row of the device before acting on its chip.
const ensureRow = async (p, who) => {
  if (!(await p.locator('.st-home').count())) await p.evaluate(() => { location.hash = '#/settings'; });
  const row = who === 'This device' ? p.locator('[data-device-row="this"]') : p.locator('[data-device-row]', { has: p.locator('.st-row-title', { hasText: who }) });
  if (!(await row.count())) return false;
  const head = row.first().locator('.st-row-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  return true;
};
const keepsBox = (p, who, space, exact = false) => {
  const loc = () => p.getByLabel(`${who} keeps ${space}`, { exact });
  const on = (fn, none) => async () => ((await ensureRow(p, who)) ? fn(loc()) : none);
  return { isChecked: on((l) => l.isChecked(), false), check: on((l) => l.check()), uncheck: on((l) => l.uncheck()), count: on((l) => l.count(), 0), indeterminate: on((l) => l.evaluate((el) => el.indeterminate), false) };
};

const a = await mk('A');
const b = await mk('B');
await startSyncing(a);
await joinByInvite(a, b);
(await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000)) >= 0 ? ok('paired') : fail('did not pair');
const docs = await a.evaluate(() => window.__app.docs());
docs.includes('space/work/time') && docs.includes('space/personal/time') ? ok('private documents are open') : fail(`documents: ${docs}`);
await setName(a, 'Laptop');
await setName(b, 'Bee');
const toSettings = (p) => p.evaluate(() => { location.hash = '#/settings'; });
await a.evaluate(() => window.__app.append('space/work', 't', 'work seed '));

// A device approved by a one-time code keeps the account's spaces by itself and opens on the Timer (F-20);
// it can still stop keeping one afterwards.
const c = await mk('C');
await joinByInvite(a, c);
await setName(c, 'Cee');
await toSettings(c);
await c.locator('.st-row').first().waitFor();
check((await until(async () => (await keepsBox(c, 'This device', 'Work').isChecked()) && (await keepsBox(c, 'This device', 'Personal').isChecked()), 15000)) >= 0, 'its spaces are ticked without pressing Keep');
check((await until(async () => (await text(c, 'space/work')).includes('work seed'), 15000)) >= 0, 'and Work reached it');
await keepsBox(c, 'This device', 'Personal').uncheck();
check((await until(async () => !(await keepsBox(c, 'This device', 'Personal').isChecked()), 5000)) >= 0, 'it can stop keeping Personal');
await keepsBox(c, 'This device', 'Personal').check();
await c.close();

await toSettings(a);
await toSettings(b);
// A unticks Work for Bee: Work stays on A in both directions while Personal keeps syncing.
check((await until(async () => (await keepsBox(a, 'Bee', 'Work').count()) === 1, 15000)) >= 0, "Bee's name and spaces show on A");
await keepsBox(a, 'Bee', 'Work').uncheck();
check((await until(async () => (await keepsBox(b, 'This device', 'Work').isChecked()) === false, 10000)) >= 0, 'Bee sees on its own row that it no longer keeps Work');
check((await until(async () => !Object.keys(await b.evaluate(() => window.__app.spaces())).includes('work'), 10000)) >= 0, 'Work leaves Bee\'s space list');
await a.evaluate(() => {
  window.__app.append('space/work', 't', 'work main ');
  window.__app.append('space/work/time', 't', 'work private ');
  window.__app.append('space/personal', 't', 'personal ');
});
check((await until(async () => (await text(b, 'space/personal')).includes('personal'), 8000)) >= 0, 'Personal still syncs');
await sleep(1500);
check(!(await text(b, 'space/work')).includes('work main') && !(await text(b, 'space/work/time')).includes('work private'), 'Work (shared and private parts) stayed on A');
await b.evaluate(() => window.__app.append('space/work', 't', 'from b '));
await sleep(1500);
check(!(await text(a, 'space/work')).includes('from b'), 'Bee cannot push Work to A');

// The choice survives a reload.
await a.reload();
(await until(async () => (await st(a)) === 'connected', 20000)) >= 0 ? ok('reconnected after reload') : fail('no reconnect after reload');
check((await until(async () => (await keepsBox(a, 'Bee', 'Work').count()) === 1 && !(await keepsBox(a, 'Bee', 'Work').isChecked()), 10000)) >= 0, 'the choice is kept after a reload');

// Keeping Work again catches up both ways.
await keepsBox(a, 'Bee', 'Work').check();
check((await until(async () => (await text(b, 'space/work/time')).includes('work private') && (await text(a, 'space/work')).includes('from b'), 15000)) >= 0, 'Work caught up both ways after it was kept again');

// A device can stop keeping a space itself.
await keepsBox(b, 'This device', 'Personal').uncheck();
await sleep(500);
await a.evaluate(() => window.__app.append('space/personal', 't', 'late personal '));
await sleep(1500);
check(!(await text(b, 'space/personal')).includes('late personal'), 'a space a device stopped keeping no longer reaches it');
await keepsBox(b, 'This device', 'Personal').check();
check((await until(async () => (await text(b, 'space/personal')).includes('late personal'), 15000)) >= 0, 'keeping it again brings what it missed');

// A timer started in the UI writes to the space's private document, not the space document.
await a.goto(BASE + '?test#/time');
await a.waitForFunction(() => window.__app);
await a.getByRole('button', { name: 'Start timer' }).click();
const inPrivate = () => a.evaluate(() => ['space/personal/time', 'space/work/time'].reduce((n, id) => n + Object.keys(window.__app.json(id, 'time_entries')).length, 0));
(await until(async () => (await inPrivate()) > 0, 5000)) >= 0 ? ok('timer entry is in a private document') : fail('no entry in the private documents');
const legacy = await a.evaluate(() => Object.keys(window.__app.json('space/personal', 'time_entries')).length + Object.keys(window.__app.json('space/work', 'time_entries')).length);
legacy === 0 ? ok('nothing written to the shared documents') : fail(`${legacy} entries in the shared documents`);

// Settings: create, archive, unarchive and remove spaces; both devices agree.
await a.goto(BASE + '?test#/settings');
await a.waitForFunction(() => window.__app);
await b.goto(BASE + '?test#/settings');
await b.waitForFunction(() => window.__app);
(await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000)) >= 0 ? ok('reconnected for Settings') : fail('no reconnect for Settings');
const spaceRow = (p, name) => p.locator('[data-space] .st-row-title', { hasText: new RegExp(`^\\s*${name}\\s*$`) });
await a.getByRole('button', { name: '+ New space' }).click();
await a.getByLabel('New space name').fill('Work');
await a.getByRole('button', { name: 'Create space' }).click();
check((await a.locator('.error', { hasText: 'There is already a space called Work' }).count()) === 1, 'a taken name is refused');
await a.getByLabel('New space name').fill('Side');
await a.getByRole('button', { name: 'Create space' }).click();
check((await until(async () => (await spaceRow(a, 'Side').count()) === 1, 5000)) >= 0, 'a new space is a row of the table');
check((await until(async () => (await spaceRow(b, 'Side').count()) === 1, 15000)) >= 0, 'the other device lists it');
check((await b.evaluate(() => Object.keys(window.__app.spaces()))).includes('side') === false, 'and it is not in its space list');

await spaceRow(a, 'Side').click();
await spaceRow(b, 'Side').click();
await a.getByRole('button', { name: 'Archive Side' }).click();
check((await until(async () => (await b.getByRole('button', { name: 'Unarchive Side' }).count()) === 1, 15000)) >= 0, 'archiving reaches the other device');
check(!Object.keys(await a.evaluate(() => window.__app.spaces())).includes('side'), 'an archived space is out of the space list');
await a.getByRole('button', { name: 'Unarchive Side' }).click();
check((await until(async () => (await b.getByRole('button', { name: 'Archive Side' }).count()) === 1, 15000)) >= 0, 'unarchiving reaches the other device');

await a.getByRole('button', { name: 'Remove Side', exact: true }).click();
await a.getByRole('status').filter({ hasText: 'holds 0 notes and 0 time entries' }).waitFor();
await a.getByRole('button', { name: 'Remove Side from the account' }).click();
await a.locator('.st-row').first().waitFor();
check((await a.evaluate(() => location.hash)) === '#/settings/spaces', 'removing a space returns to the Spaces section of Settings');
check((await until(async () => (await spaceRow(a, 'Side').count()) === 0 && (await spaceRow(b, 'Side').count()) === 0, 15000)) >= 0, 'removing reaches both devices');
await toSettings(b);
await a.getByRole('button', { name: '+ New space' }).click();
await a.getByLabel('New space name').fill('Side');
await a.getByRole('button', { name: 'Create space' }).click();
check((await until(async () => (await spaceRow(a, 'Side').count()) === 1, 5000)) >= 0, 'a removed space frees its name');

// "Not on this device": B has not decided on the new Side; saying no ends the notice and survives a reload.
await b.goto(BASE + '?test#/settings');
await b.waitForFunction(() => window.__app);
const notice = b.locator('.notice', { hasText: 'Side' });
check((await until(async () => (await notice.count()) === 1, 15000)) >= 0, 'the undecided space is offered in the notice');
check((await keepsBox(b, 'This device', 'Side', true).indeterminate()) === true, 'an undecided space shows as indeterminate in the list');
await b.getByRole('button', { name: 'Not on this device: Side' }).click();
check((await notice.count()) === 0, 'saying no ends the notice');
check((await keepsBox(b, 'This device', 'Side', true).indeterminate()) === false, 'a "no" no longer looks undecided');
await b.reload();
await b.waitForFunction(() => window.__app);
await sleep(1500);
check((await b.locator('.notice', { hasText: 'Side' }).count()) === 0 && !(await keepsBox(b, 'This device', 'Side', true).isChecked()), 'the no stays after a reload');

await finish(browser);
