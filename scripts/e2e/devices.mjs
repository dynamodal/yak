// End-to-end: the Devices page. A paired device shows no sync code (it makes a one-time code, with a QR
// code, on request); names reach the other devices; the header chip and each row show the two levels of
// status; a third device joins through a one-time code made on another device; "Remove from account…"
// asks first, drops the device on all devices, tells it, keeps it out, and joining again with a one-time code lets it back;
// a waiting device offers "Check again"; and "Remove this device from the account…" leaves the others
// syncing and can erase a space's local copy.
//
//   npm run e2e devices
//
import { BASE, launch, sleep, ok, fail, check, watchPage, until, finish, openJoin, startSyncing, joinByInvite, PASS, openAdvanced } from './lib.mjs';

const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  return page;
};
const st = (p) => p.evaluate(() => window.__app?.state());
const peersOf = (p) => p.evaluate(() => window.__app.peers());
const connectedIds = async (p) => (await peersOf(p)).filter((x) => x.state === 'connected').map((x) => x.id).sort();
const idOf = (p) => p.evaluate(() => window.__app.deviceId());
const row = (p, id) => p.locator(`li.device-row#device-${id}`);
// The status dot's panel lists the sync state of this device (a device that never paired says nothing).
const chip = async (p) => {
  await p.getByRole('button', { name: /^Backup and sync/ }).click();
  const text = await p.locator('.status-panel').innerText();
  await p.keyboard.press('Escape');
  return text;
};

const a = await mk('A');
const b = await mk('B');
const c = await mk('C');

check((await a.getByRole('button', { name: 'Start syncing my devices' }).count()) === 1 && !/sync|signaling/i.test((await chip(a)).replace(/Devices/g, '')), 'a device outside an account offers to start syncing and shows no sync warning in the status panel');
await startSyncing(a);
await joinByInvite(a, b);
(await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000)) >= 0 ? ok('A and B paired') : fail('A and B did not pair');
// Compatible mode (#255): each updated device publishes its keys and the Devices page shows the lock state.
await openAdvanced(a);
check((await until(async () => /Has keys/.test(await a.locator('details.advanced').first().innerText()), 10000)) >= 0, 'this device shows that it has keys (under Advanced)');
check((await until(async () => (await a.locator('details.advanced .key-state[data-keys="published"]').count()) >= 2, 15000)) >= 0, 'another device of the account shows that it has keys too');
check((await a.getByRole('button', { name: 'Start syncing my devices' }).count()) === 0, 'a device in an account does not offer to start syncing');
check((await b.locator('code.secret').count()) === 0, 'a device in the account does not show a sync code');
await b.getByRole('button', { name: /Make a (new )?one-time code/ }).first().click();
check((await b.locator('[data-invite-code]').count()) === 1 && (await b.locator('.qr-pair svg').count()) === 1, 'it makes a one-time code, with a QR code of it');
check((await b.locator('input[aria-label="One-time code"]').count()) === 0 && (await b.getByRole('button', { name: 'Join', exact: true }).count()) === 0, 'it offers no way to join a different account while in one');

// Status: this device in the header and at the top of the page; each other device in its row.
check((await until(async () => (await chip(a)).includes('Syncing · 1 of 1'), 10000)) >= 0, 'the status panel counts linked devices');
check((await a.locator('.status-line').innerText()).includes('Syncing · 1 of 1'), 'the top of the page says the same about this device');

// Names: B names itself; A shows it.
await b.locator('input[aria-label="This device\'s name"]').fill('Phone');
await b.locator('input[aria-label="This device\'s name"]').press('Enter');
await b.locator('input[aria-label="This device\'s name"]').blur();
const nameInput = (page, id) => row(page, id).locator('input.peer-name');
check((await until(async () => (await nameInput(a, await idOf(b)).inputValue()) === 'Phone', 5000)) >= 0, 'a device name shows on the other device');
check((await row(a, await idOf(b)).innerText()).includes('Syncing'), "the other device's row says Syncing");

// Shared logs: B's lines show on A (filtered by B), and A's on B.
const logText = (p) => p.locator('pre[aria-label="Shared log"]').textContent();
check((await until(async () => (await logText(a)).includes('[Phone]') && (await logText(b)).includes('['), 15000)) >= 0, "the other device's log lines show on this device");
await (await openJoin(a)).locator('summary', { hasText: 'Logs from all devices' }).click();
await a.locator('select[aria-label="Filter logs by device"]').selectOption({ label: 'Phone' });
const filtered = await logText(a);
check(filtered.length > 0 && filtered.split('\n').every((l) => l.includes('[Phone]')), 'the log filters by device');

// Turning sharing off on B clears B's lines on A; turning it on again writes new ones.
await a.locator('select[aria-label="Filter logs by device"]').selectOption({ label: 'All devices' });
await (await openJoin(b)).locator('summary', { hasText: 'Logs from all devices' }).click();
await b.getByLabel('Share debug logs between my devices').uncheck();
check((await until(async () => !(await logText(a)).includes('[Phone]'), 15000)) >= 0, "turning sharing off removes this device's lines on the other device");
await sleep(1500);
check(!(await logText(a)).includes('[Phone]'), 'and nothing new is written while it is off');
await b.getByLabel('Share debug logs between my devices').check();

// Any device renames any other: A renames B, B shows it as its own name.
await nameInput(a, await idOf(b)).fill('Pocket');
await nameInput(a, await idOf(b)).press('Enter');
await nameInput(a, await idOf(b)).blur();
check((await until(async () => (await b.locator('input[aria-label="This device\'s name"]').inputValue()) === 'Pocket', 5000)) >= 0, 'a rename made on another device reaches the renamed device');

// C joins with a one-time code made on A (B's own code is still unused).
await joinByInvite(a, c);
const [ia, ib, ic] = [await idOf(a), await idOf(b), await idOf(c)];
(await until(async () => (await connectedIds(a)).length === 2 && (await connectedIds(b)).length === 2 && (await connectedIds(c)).length === 2, 20000)) >= 0
  ? ok('third device joined through a one-time code from A; all three connected') : fail('three devices not meshed');

// Remove C on A (keys required, so it needs the passphrase): asks first, with the reach in plain words; then A and B both drop it.
(await until(async () => (await a.evaluate((p) => window.__app.unlock(p), PASS)) === 'ok', 30000)) >= 0 ? ok('A unlocked the account key') : fail('A could not unlock');
await row(a, ic).getByRole('button', { name: /^Remove .* from account…$/ }).click();
check((await row(a, ic).locator('.confirm-panel', { hasText: 'your other devices no longer accept it' }).count()) === 1, 'remove explains that it reaches all devices, in place');
check((await row(a, ic).locator('.confirm-panel', { hasText: 'nothing can take that back' }).count()) === 1, 'and that the data it already has stays on it');
await row(a, ic).getByRole('button', { name: /^Remove .* from the account$/ }).click();
(await until(async () => !(await connectedIds(a)).includes(ic) && !(await connectedIds(b)).includes(ic), 10000)) >= 0
  ? ok('removed device dropped on A and, through sync, on B') : fail(`removed device still connected: A ${await connectedIds(a)} B ${await connectedIds(b)}`);
check((await until(async () => (await c.locator('p.error', { hasText: 'removed this one' }).count()) === 1, 10000)) >= 0, 'removed device is told');
await sleep(3000);
check(!(await connectedIds(a)).includes(ic), 'removed device stays out');
// There is no "Allow again" with keys required: C joins again with a new one-time code.
await joinByInvite(a, c, { keep: false });
check((await until(async () => (await connectedIds(a)).includes(ic) && (await connectedIds(b)).includes(ic), 30000)) >= 0, 'joined again with a one-time code: reconnects to A and B');

// A device that is not online shows as Waiting, with a hint and "Check again".
await a.evaluate(() => {
  const key = 'app-app-pairing';
  const pairing = JSON.parse(localStorage.getItem(key));
  pairing.peers = [...new Set([...(pairing.peers ?? []), '00000000-ghost-device'])];
  localStorage.setItem(key, JSON.stringify(pairing));
});
await a.reload();
await a.locator('li.device-row', { hasText: '00000000' }).waitFor({ timeout: 20000 });
const ghost = a.locator('li.device-row', { hasText: '00000000' });
check((await ghost.innerText()).includes('Waiting') && (await ghost.innerText()).includes('Phones pause Yak in the background'), 'a device that is not online shows as Waiting, with a hint');
await until(async () => (await row(a, ib).innerText()).includes('Syncing'), 30000);
check((await ghost.getByRole('button', { name: /^Check again/ }).count()) === 1 && (await row(a, ib).getByRole('button', { name: /^Check again/ }).count()) === 0, '"Check again" is on the Waiting row only');
await ghost.getByRole('button', { name: /^Check again/ }).click();
// (Removing a device that never published keys has no effect with keys required, so that is not checked here.)
(await until(async () => (await connectedIds(a)).length === 2, 30000)) >= 0 ? ok('A is linked to B and C again after its reload') : fail('A did not relink');

// Removing this device: it asks, offers to erase a space's copy (off by default), and the others keep syncing.
const workId = await c.evaluate(() => window.__app.spaces().work);
await c.locator('summary', { hasText: 'Join again or remove this device' }).click();
await c.getByRole('button', { name: 'Remove this device from the account…' }).click();
check((await c.getByLabel('Also erase Work on this device').isChecked()) === false, 'erasing a space is off by default');
await c.getByLabel('Also erase Work on this device').check();
await Promise.all([c.waitForEvent('load', { timeout: 30000 }), c.getByRole('button', { name: 'Remove this device', exact: true }).click()]);
await c.waitForFunction(() => window.__app);
check((await until(async () => (await st(c)) === 'stopped', 10000)) >= 0, 'the device left the account and stopped syncing');
check((await until(async () => (await row(a, ic).count()) === 0 && (await connectedIds(a)).length === 1 && (await connectedIds(b)).length === 1, 15000)) >= 0, 'the others stop listing it and keep syncing with each other');
const databases = await c.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
check(!databases.some((n) => n.includes(`space/${workId}`)), "the erased space's local copy is gone");
check(databases.some((n) => n.startsWith('app-doc-space/')), "the other spaces' local copies stay");
check((await c.getByRole('button', { name: 'Start syncing my devices' }).count()) === 1, 'it can start or join an account again');
void ia;

await finish(browser);
