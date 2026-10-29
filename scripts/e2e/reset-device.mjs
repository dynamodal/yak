// End-to-end: reset this device's data (Devices page). Two profiles pair; B resets one space and it
// refills from A; the reset is refused while no other device keeps the space; B resets everything and
// rejoins with a one-time code.
//
//   npm run e2e reset-device
//
import { BASE, launch, startMock, ok, fail, check, watchPage, until, finish, keepAllSpaces, openJoin, startSyncing, joinByInvite, openAdvanced } from './lib.mjs';

const mock = await startMock();
const browser = await launch();
const mk = async (n) => {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
  await page.locator('input[aria-label="Connection server"]').fill(mock.url);
  return page;
};
const a = await mk('A');
const b = await mk('B');
const st = (p) => p.evaluate(() => window.__app?.state());
const text = (p) => p.evaluate(() => window.__app.text('space/work', 't'));

await startSyncing(a);
await joinByInvite(a, b);
const linked = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
check(linked >= 0, 'paired and connected');

await a.evaluate(() => window.__app.append('space/work', 't', 'from A '));
check((await until(async () => (await text(b)).includes('from A'), 8000)) >= 0, 'B has the text from A');

const openReset = async (p) => {
  await openAdvanced(p);
  const section = p.locator('details', { hasText: "Re-sync this device" }).last();
  if (!(await section.evaluate((d) => d.open))) await section.locator('summary').click();
  return section;
};

// Which devices keep Work is ticked in the Settings table; B reads it from the account document.
const peerKeepsWork = (p) => p.evaluate(() => {
  const keeps = window.__app.json(`account/${window.__app.accountId()}`, 'keeps');
  const work = window.__app.spaces().work;
  const me = window.__app.deviceId();
  return Object.entries(keeps).some(([key, on]) => key.endsWith(`:${work}`) && !key.startsWith(`${me}:`) && on === true);
});
await a.evaluate(() => { location.hash = '#/settings/devices-sync/this'; });

// 1. Nothing else keeps Work: the reset is refused.
await a.locator('input[aria-label="This device keeps Work"]').uncheck();
check((await until(async () => !(await peerKeepsWork(b)), 10000)) >= 0, 'B sees that A no longer keeps Work');
let section = await openReset(b);
await section.locator('select[aria-label="What to reset"]').selectOption({ label: 'Work only' });
const [download] = await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'Save a safety backup first' }).click()]);
check(/before-reset/.test(download.suggestedFilename()), `safety backup downloaded (${download.suggestedFilename()})`);
check(await b.getByRole('button', { name: 'Reset and reload' }).isDisabled(), 'reset refused while no other device keeps the space');
await a.locator('input[aria-label="This device keeps Work"]').check();

// 2. One space: erased here, refilled from A.
check((await until(() => peerKeepsWork(b), 10000)) >= 0, 'B sees that A keeps Work again');
check(await b.getByRole('button', { name: 'Reset and reload' }).isEnabled(), 'reset offered once another device keeps the space');
await Promise.all([b.waitForEvent('load', { timeout: 30000 }), b.getByRole('button', { name: 'Reset and reload' }).click()]);
await b.waitForFunction(() => window.__app);
check((await until(async () => (await text(b)).includes('from A'), 20000)) >= 0, 'Work refilled from A after a one-space reset');
check((await b.evaluate(() => localStorage.getItem('app-reset-device'))) === 'null', 'the reset record is consumed');

// 3. Everything: empty and unpaired after the reset, back after rejoining with a new one-time code.
await b.goto(BASE + '?test#/devices');
section = await openReset(b);
await section.locator('select[aria-label="What to reset"]').selectOption({ label: 'Everything on this device' });
await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'Save a safety backup first' }).click()]);
await Promise.all([b.waitForEvent('load', { timeout: 30000 }), b.getByRole('button', { name: 'Reset and reload' }).click()]);
await b.waitForFunction(() => window.__app);
check((await text(b)) === '', 'everything was erased on B');
await b.evaluate(() => { location.hash = '#/settings/devices/add'; });
await b.getByRole('button', { name: 'Start syncing my devices' }).waitFor();
check((await b.getByRole('button', { name: 'Start syncing my devices' }).count()) === 1, 'B is not in the account any more');
await (await openJoin(b)).locator('summary', { hasText: /^Connection server$/ }).click();
await b.locator('input[aria-label="Connection server"]').fill(mock.url);
// The account already records that this device keeps both spaces, so nothing is left to choose.
await a.evaluate(() => { location.hash = '#/devices'; });
await joinByInvite(a, b, { keep: false });
check((await until(async () => (await text(b)).includes('from A'), 30000)) >= 0, 'rejoined with a one-time code and refilled from A');

// 4. Erase everything on this device: every store goes, the app starts as on a first visit.
await b.goto(BASE + '?test#/devices');
const oldId = await b.evaluate(() => window.__app.deviceId());
await b.evaluate(async () => {
  localStorage.setItem('app-e2e-marker', '1');
  await new Promise((res, rej) => { const r = indexedDB.open('app-e2e-marker-db', 1); r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => rej(r.error); });
  if (window.caches) await caches.open('e2e-cache');
});
await openAdvanced(b);
const erase = b.locator('details[data-adv="erase"]');
const eraseBtn = erase.getByRole('button', { name: 'Erase everything…' });
await erase.locator('summary').click();
await eraseBtn.click();
check(await erase.getByRole('button', { name: 'Erase everything and reload' }).isDisabled(), 'erase waits for a safety backup');
const [zip] = await Promise.all([
  b.waitForEvent('download', { timeout: 60000 }).catch(async (e) => {
    throw new Error(`no safety zip; panel says: ${await erase.innerText().catch(() => '(gone)')}`, { cause: e });
  }),
  erase.getByRole('button', { name: /Save a safety backup/ }).click(),
]);
check(/\.zip$/.test(zip.suggestedFilename()), `safety backup is a zip (${zip.suggestedFilename()})`);
await erase.getByRole('button', { name: 'Erase everything and reload' }).waitFor();
await Promise.all([b.waitForEvent('load', { timeout: 30000 }), erase.getByRole('button', { name: 'Erase everything and reload' }).click()]);
await b.waitForFunction(() => window.__app);
await b.waitForFunction(() => !localStorage.getItem('app-erase-everything'));
await b.waitForTimeout(1500);
const after = await b.evaluate(async () => ({
  id: window.__app.deviceId(),
  marker: localStorage.getItem('app-e2e-marker'),
  dbs: (await indexedDB.databases()).map((d) => d.name),
  caches: window.caches ? await caches.keys() : [],
  text: window.__app.text('space/work', 't'),
}));
check(after.id !== oldId, 'the device has a new id');
check(after.marker === null && !after.dbs.includes('app-e2e-marker-db') && !after.caches.includes('e2e-cache'), 'marker key, database and cache are gone');
check(after.text === '', 'no data left');
check((await b.evaluate(() => localStorage.getItem('app-erase-report'))) === null, 'nothing was left over');

await finish(browser, mock);
