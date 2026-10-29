// End-to-end: joining an account. A fresh device joins and adopts the account's spaces (no
// second "Personal"); a device that has its own data joins and keeps it as "Personal (<its name>)",
// which every device of the account then sees; all devices end with the same account id.
//
//   npm run e2e joining
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const RELAY = BASE.replace(/^http/, 'ws').replace(/\/$/, '') + '/signal';

const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const hook = (p, f) => p.evaluate(f);
const spaces = (p) => hook(p, () => window.__app?.spaces() ?? {});
const accountId = (p) => hook(p, () => window.__app?.accountId());
const spaceNames = async (p) => Object.keys(await spaces(p)).sort();
const allSpaceNames = async (p) => Object.keys(await hook(p, () => window.__app?.allSpaces() ?? {})).sort();

const a = await mk('A');
await startSyncing(a);
const accountA = await accountId(a);
// Fresh account (F-20): not "removed or missed a change", and the sync line says it waits for the first device.
check(!/missed a change/.test(await a.locator('main').innerText()), 'fresh account: the Devices page does not claim this device was removed');
await a.evaluate(() => { location.hash = '#/settings'; });
check((await until(async () => /No other device yet/.test(await a.locator('main').innerText()), 10000)) >= 0, 'fresh account: it says no other device yet');
check((await until(async () => /On · waiting for your first device/.test(await a.locator('[aria-label="Sync status"]').innerText().catch(() => '')), 10000)) >= 0, 'fresh account: Sync says On · waiting for your first device');
await a.evaluate(() => { location.hash = '#/settings/devices'; });
await a.getByRole('button', { name: /Make a (new )?one-time code/ }).first().waitFor({ timeout: 15000 });
const spacesA = await spaces(a);
JSON.stringify(Object.keys(spacesA).sort()) === '["personal","work"]' ? ok('A starts with Personal and Work') : fail(`A spaces ${JSON.stringify(spacesA)}`);
await a.evaluate(() => window.__app.append('space/personal', 't', 'from A '));

// A fresh device joins: it adopts A's account and spaces, and keeps none of its own empty ones.
const b = await mk('B');
await joinByInvite(a, b);
(await until(async () => (await accountId(b)) === accountA, 30000)) >= 0 ? ok('fresh device adopted the account') : fail(`B account ${await accountId(b)} vs ${accountA}`);
(await until(async () => JSON.stringify(await spaces(b)) === JSON.stringify(spacesA), 20000)) >= 0 ? ok('fresh device has exactly the account\'s spaces') : fail(`B spaces ${JSON.stringify(await spaces(b))}`);
(await until(async () => ((await hook(b, () => window.__app.text('space/personal', 't'))) ?? '').includes('from A'), 20000)) >= 0 ? ok('fresh device received the data') : fail('B has no data from A');

// The join request shows above the code and QR code, and the laptop has a name, not an id.
{
  const b2 = await mk('B2');
  await a.getByRole('button', { name: /Make a (new )?one-time code/ }).first().click();
  const code = (await a.locator('[data-invite-code]').innerText()).trim();
  await (await openJoin(b2)).locator('input[aria-label="One-time code"]').fill(code);
  await b2.getByRole('button', { name: 'Join', exact: true }).click();
  await a.locator('.invite-requests [data-compare]').waitFor({ timeout: 30000 });
  const [req, box] = await Promise.all([a.locator('.invite-requests').boundingBox(), a.locator('.secret-box').boundingBox()]);
  check(req && box && req.y < box.y, 'the join request is above the code');
  check((await a.locator('input[aria-label="Name of this device"]').inputValue()).trim() !== '', 'the device making the code has a saved name');
  await a.locator('.invite-requests').getByRole('button', { name: 'Decline' }).click();
  await a.getByRole('button', { name: 'Close the code' }).click();
  await b2.context().close();
}

// A device with its own data joins: its Personal is kept, named after the device.
const c = await mk('C');
await c.evaluate(() => { location.hash = '#/settings/devices-sync/this'; });
await c.locator('input[aria-label="This device\'s name"]').fill('Phone');
await c.locator('input[aria-label="This device\'s name"]').blur();
await c.evaluate(() => window.__app.append('space/personal', 't', 'from C '));
await joinByInvite(a, c);
(await until(async () => (await accountId(c)) === accountA, 30000)) >= 0 ? ok('device with data adopted the account') : fail(`C account ${await accountId(c)}`);
const expected = '["personal","personal (phone)","work"]';
(await until(async () => JSON.stringify(await spaceNames(c)) === expected, 25000)) >= 0 ? ok('its own Personal is kept as "Personal (Phone)"') : fail(`C spaces ${JSON.stringify(await spaceNames(c))}`);
(await until(async () => JSON.stringify(await allSpaceNames(a)) === expected, 25000)) >= 0 ? ok('the other devices see the space in the account') : fail(`A account spaces ${JSON.stringify(await allSpaceNames(a))}`);
// The space is new to A: A has not decided on it, so nothing of it reaches A until A keeps it.
await a.evaluate(() => { location.hash = '#/settings'; });
await a.locator('.notice', { hasText: 'Personal (Phone)' }).waitFor({ timeout: 25000 });
const kept = (await spaces(c))['personal (phone)'];
check(JSON.stringify(await spaceNames(a)) === '["personal","work"]', 'A does not keep the new space until it decides');
await a.getByRole('button', { name: 'Keep all spaces' }).click();
(await until(async () => ((await a.evaluate((id) => window.__app.text(`space/${id}`, "t"), kept)) ?? '').includes('from C'), 25000)) >= 0
  ? ok('the kept data reached A once A kept the space') : fail('kept data not on A');
await c.evaluate(() => { location.hash = '#/settings/devices-sync/this'; });
check((await c.locator('input[aria-label="This device\'s name"]').inputValue()) === 'Phone', 'the device kept its name');

// First start: the welcome creates nothing until a choice is made.
const mkWelcome = async (n) => {
  const page = await (await browser.newContext()).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test&welcome#/');
  await page.waitForFunction(() => window.__app);
  return page;
};
const w = await mkWelcome('W');
await openJoin(w);
check((await w.getByRole('heading', { name: /^Welcome to/ }).count()) === 1, 'a fresh profile shows the welcome');
check(Object.keys(await hook(w, () => window.__app.allSpaces())).length === 0, 'and has created no space');
check((await w.getByRole('button', { name: 'Time, notes and tasks' }).count()) === 1 && (await w.getByRole('button', { name: /^Restore from a backup/ }).count()) === 1, 'it offers start fresh and restore');
await w.getByRole('button', { name: /^Restore from a backup/ }).click();
await w.getByRole('button', { name: /Back to the welcome/ }).waitFor({ timeout: 10000 }).catch(() => undefined);
check((await w.getByRole('button', { name: /Back to the welcome/ }).count()) === 1, 'restore opens Backups from the welcome');
await w.getByRole('button', { name: /Back to the welcome/ }).click();
await joinByInvite(a, w);
(await until(async () => JSON.stringify(await spaceNames(w)) === expected, 25000)) >= 0 ? ok('joining from the welcome gives exactly the account\'s spaces') : fail(`W spaces ${JSON.stringify(await spaceNames(w))}`);
check((await w.getByRole('heading', { name: /^Welcome to/ }).count()) === 0, 'the welcome is gone once joined');

const f = await mkWelcome('F');
await f.locator('input[aria-label="Name of the first space"]').fill('Home');
await f.getByRole('button', { name: 'Time, notes and tasks' }).click();
(await until(async () => JSON.stringify(await spaceNames(f)) === '["home"]', 10000)) >= 0 ? ok('start fresh gives one space named as chosen') : fail(`F spaces ${JSON.stringify(await spaceNames(f))}`);
check((await f.getByRole('heading', { name: /^Welcome to/ }).count()) === 0, 'and leaves the welcome');
await f.reload();
await f.waitForFunction(() => window.__app);
check(JSON.stringify(await spaceNames(f)) === '["home"]' && (await f.getByRole('heading', { name: /^Welcome to/ }).count()) === 0, 'it stays that way after a reload');

await finish(browser);
