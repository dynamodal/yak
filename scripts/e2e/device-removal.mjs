// End-to-end: removing a device in a keys-required account (#258, simplified in #295). Four devices join with one-time codes; D is
// off. The owner removes C with the passphrase: nothing rotates, A and B stop accepting C, C gets nothing
// new. D comes back and syncs as before. C, once it sees its removal, stops syncing and joins again with
// a one-time code; D uses "Join again" on Devices and is approved again.
//
//   npm run e2e device-removal
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, sleep, openJoin, startSyncing, joinByInvite, PASS, openAdvanced } from './lib.mjs';

const browser = await launch({ fakeCamera: true });
const open = async (context, n) => {
  const page = await context.newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const mk = async (n) => open(await browser.newContext({ permissions: ['camera'] }), n);
const hook = (p, f, arg) => p.evaluate(f, arg);
const keys = (p) => hook(p, () => window.__app.keys());
const secret = (p) => hook(p, () => window.__app.secret());
const accountId = (p) => hook(p, () => window.__app.accountId());
const text = (p) => hook(p, () => window.__app.text('space/personal', 't') ?? '');
const idOf = (p) => hook(p, () => window.__app.deviceId());
const append = (p, s) => hook(p, (x) => window.__app.append('space/personal', 't', x), s);
const connected = (p) => hook(p, () => window.__app.peers().filter((x) => x.state === 'connected').map((x) => x.id));
const unlock = async () => (await until(async () => (await hook(a, (p) => window.__app.unlock(p), PASS)) === 'ok', 30000)) >= 0;
/** A makes a one-time code, `p` enters it, both confirm, A approves: `p` reloads into the account. */
const invite = async (p, name) => {
  await unlock();
  await a.getByRole('button', { name: /^Make a (new )?one-time code$/ }).click();
  const code = (await a.locator('[data-invite-code]').innerText()).trim();
  await (await openJoin(p)).locator('input[aria-label="One-time code"]').fill(code);
  const loaded = p.waitForEvent('load', { timeout: 60000 });
  await p.getByRole('button', { name: 'Join' }).click();
  await p.locator('[data-join="compare"]').getByRole('button', { name: 'The codes match' }).click({ timeout: 30000 });
  await a.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click({ timeout: 30000 });
  await loaded;
  // Back in the same account: its spaces are decided already, so no question about keeping them.
  await p.waitForFunction(() => window.__app);
  (await until(async () => (await keys(p)).certified && (await accountId(p)) === account, 40000)) >= 0 ? ok(`${name} is approved again with new keys`) : fail(`${name} keys ${JSON.stringify(await keys(p))}`);
};

const a = await mk('A');
await startSyncing(a);
const account = await accountId(a);
const b = await mk('B');
await joinByInvite(a, b);
const c = await mk('C');
await joinByInvite(a, c);
const dContext = await browser.newContext({ permissions: ['camera'] });
let d = await open(dContext, 'D');
await joinByInvite(a, d);
const [idA, idB, idC, idD] = [await idOf(a), await idOf(b), await idOf(c), await idOf(d)];
const all = [a, b, c, d];
(await until(async () => (await Promise.all(all.map(accountId))).every((x) => x === account), 30000)) >= 0 ? ok('B, C and D joined') : fail('a device did not join');

// Starting with a passphrase requires keys from the first device on; every joined device was approved.
(await unlock()) ? ok('A unlocked the account key') : fail('A could not unlock');
(await until(async () => (await Promise.all(all.map(keys))).every((k) => k.required && k.certified), 40000)) >= 0 ? ok('keys required, all four approved') : fail('not every device is approved');
check(!(await a.getByRole('button', { name: 'Change sync code…' }).count()), 'with keys required Devices offers no "Change sync code" (the others would ignore it)');
await append(a, 'before ');
(await until(async () => (await Promise.all([b, c, d].map(text))).every((t) => t.includes('before')), 30000)) >= 0 ? ok('all four sync') : fail('not all synced');
const accountSecret = await secret(a);

// D goes off.
await d.close();

// A removes C from Devices: the dialog states the limit; the passphrase is unlocked already.
const row = a.locator(`li.device-row#device-${idC}`);
await row.getByRole('button', { name: /^Remove .* from account…$/ }).click();
const dialog = await row.locator('.confirm-panel').innerText();
check(/keeps the data it already synced/.test(dialog) && /one-time code/.test(dialog), `the dialog says C keeps what it has and needs a one-time code to come back (${dialog.slice(0, 80)}…)`);
await row.locator('.confirm-panel').getByRole('button', { name: /^Remove .* from the account$/ }).click();

(await until(async () => !(await keys(a)).certs.includes(idC) && !(await keys(b)).certs.includes(idC), 30000)) >= 0 ? ok('C no longer counts as approved on A and B') : fail('C still approved');
check((await secret(a)) === accountSecret && (await secret(b)) === accountSecret, 'nothing rotates: A and B keep the sync secret');

await append(a, 'after-removal ');
(await until(async () => (await text(b)).includes('after-removal'), 40000)) >= 0 ? ok('A and B keep syncing') : fail('A and B stopped syncing');
await hook(c, () => window.__app.dropLink());
await sleep(8000);
check(!(await text(c)).includes('after-removal'), 'the removed device gets nothing new');
check((await connected(c)).length === 0, `the removed device has no link (${JSON.stringify(await connected(c))})`);
check((await text(c)).includes('before'), 'and keeps what it already had');

// D comes back: same secret, nothing to catch up.
d = await open(dContext, 'D again');
(await until(async () => (await text(d)).includes('after-removal'), 60000)) >= 0 ? ok('D, off during the removal, syncs again on return') : fail('D got nothing after coming back');
(await until(async () => !(await keys(d)).certs.includes(idC), 20000)) >= 0 ? ok('D also stops counting C') : fail('D still counts C');
await sleep(4000);
check(!(await text(c)).includes('after-removal') && (await connected(c)).length === 0, 'C still gets nothing after D came back');

// C gets the account document with its removal (here handed over directly): it cuts itself off and says how to come back.
const update = await hook(a, (id) => window.__app.encodeDoc(`account/${id}`), account);
await hook(c, ([id, u]) => window.__app.applyUpdate(`account/${id}`, u), [account, update]);
(await until(async () => (await secret(c)) === undefined, 20000)) >= 0 ? ok('C, seeing its own removal, stops syncing') : fail(`C still paired: ${await secret(c)}`);
await c.goto(BASE + '?test#/devices');
await c.waitForFunction(() => window.__app);
check(await c.locator('[data-removed-self]').isVisible({ timeout: 10000 }).catch(() => false), 'C shows it was removed and how to come back');

// Re-pairing: C joins again with a one-time code and its data merges back.
await append(c, 'offline-on-c ');
await invite(c, 'C');
(await until(async () => (await text(c)).includes('after-removal'), 40000)) >= 0 ? ok('C receives what it missed') : fail('C got nothing after rejoining');
(await until(async () => (await text(a)).includes('offline-on-c'), 40000)) >= 0 ? ok('and what C wrote meanwhile reaches A') : fail('C\'s edit did not reach A');

// "Join again" on a device still paired (for example one that stopped finding the others): new keys, a one-time code, approval.
await d.locator('summary', { hasText: 'Join again or remove this device' }).click();
await d.getByRole('button', { name: 'Join again with a one-time code…' }).click();
await d.getByRole('button', { name: 'Stop syncing and join again' }).click();
(await until(async () => (await secret(d)) === undefined, 20000)) >= 0 ? ok('Join again stops syncing on D') : fail('D still paired');
await invite(d, 'D');
await append(a, 'after-rejoin ');
(await until(async () => (await text(d)).includes('after-rejoin'), 40000)) >= 0 ? ok('D syncs again') : fail('D got nothing after Join again');
check(idB !== idD, 'distinct devices');

await finish(browser);
