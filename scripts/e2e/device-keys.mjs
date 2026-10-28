// End-to-end: device keys, slice 2 (#256), on a keyless account (test hooks make one: the app no longer offers it, #311). Two devices pair; the one holding the account key
// certifies the other, and their links are proven by signed handshakes. Then the account requires
// keys (a test hook stands in for slice 3's switch): a third device with the sync code but no
// certificate gets no document, while the first two keep syncing.
//
//   npm run e2e device-keys
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, keepAllSpaces, sleep, waitFor } from './lib.mjs';

const browser = await launch({ fakeCamera: true, fastTimers: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const hook = (p, f, arg) => p.evaluate(f, arg);
const keys = (p) => hook(p, () => window.__app.keys());
const accountId = (p) => hook(p, () => window.__app.accountId());
const text = (p) => hook(p, () => window.__app.text('space/personal', 't') ?? '');
const peerIdOf = (p) => hook(p, () => window.__app.deviceId());

const a = await mk('A');
// A keyless account as before #311 (the account's own sync code), made with a test hook: the app no longer offers it.
const code = await hook(a, () => window.__app.startKeyless());
const joinKeyless = async (p, c, { reloads = true } = {}) => {
  await Promise.all([...(reloads ? [p.waitForEvent('load', { timeout: 30000 })] : []), hook(p, (x) => window.__app.joinKeyless(x), c)]);
  if (reloads) {
    await keepAllSpaces(p);
    await p.waitForFunction(() => window.__app);
  }
};
const accountA = await accountId(a);

const b = await mk('B');
await joinKeyless(b, code);
(await until(async () => (await accountId(b)) === accountA, 30000)) >= 0 ? ok('B joined the account') : fail('B did not join');
const idA = await peerIdOf(a);
const idB = await peerIdOf(b);

// A made the account key and still holds it (no passphrase yet): it certifies B, trust on first use.
(await until(async () => (await keys(a)).certified && (await keys(b)).certified, 30000)) >= 0 ? ok('both devices hold a certificate') : fail(`certs A ${JSON.stringify(await keys(a))} B ${JSON.stringify(await keys(b))}`);
// The first link came up before the certificates; a new one is signed.
await hook(a, () => window.__app.dropLink());
(await until(async () => (await keys(a)).verified.includes(idB) && (await keys(b)).verified.includes(idA), 30000)) >= 0
  ? ok('the link is proven by signed handshakes both ways')
  : fail(`verified A ${JSON.stringify(await keys(a))} B ${JSON.stringify(await keys(b))}`);
await hook(a, () => window.__app.append('space/personal', 't', 'signed '));
(await until(async () => (await text(b)).includes('signed'), 20000)) >= 0 ? ok('data syncs over the proven link') : fail('no data on B');
// Files use the same direct channel (#166): a file reaches B over the proven link.
const fileBytes = (p) => hook(p, () => window.__app.fileBytes('space/personal'));
await hook(a, () => window.__app.addFile('space/personal', 'one.txt', 'file over a proven link'));
(await until(async () => (await fileBytes(b)) === 'file over a proven link'.length, 30000)) >= 0 ? ok('a file reaches B over the proven link') : fail('no file on B');

// Mixed versions: a device syncing as the slice 1 build did (no signatures, no pair keys) keeps syncing with them.
const mkOld = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test&slice1#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const old = await mkOld('Old');
await joinKeyless(old, code);
(await until(async () => (await text(old)).includes('signed'), 30000)) >= 0 ? ok('a slice 1 device receives data from certified ones') : fail('no data on the slice 1 device');
await hook(old, () => window.__app.append('space/personal', 't', 'old '));
(await until(async () => (await text(a)).includes('old') && (await text(b)).includes('old'), 30000)) >= 0 ? ok('and its changes reach them') : fail('slice 1 changes did not arrive');
const idOld = await peerIdOf(old);
check(!(await keys(a)).verified.includes(idOld), 'its link is not counted as proven');

// Keys required (slice 3 adds the button; a test hook signs it here).
check(await hook(a, () => window.__app.requireKeys()), 'A signs "keys required" with the account key');
(await until(async () => (await keys(b)).required, 20000)) >= 0 ? ok('B sees that keys are required') : fail('B does not see keys required');

// C has the sync code but no certificate: it gets no document.
const c = await mk('C');
await joinKeyless(c, code, { reloads: false });
await sleep(waitFor(15000));
check((await accountId(c)) !== accountA, 'a device without a certificate never receives the account');
check(!(await text(c)).includes('signed'), 'nor any space');
const peersA = await hook(a, () => window.__app.peers());
const idC = await peerIdOf(c);
check(!peersA.some((p) => p.id === idC && p.state === 'connected'), 'A has no link with it');

await hook(a, () => window.__app.addFile('space/personal', 'two.txt', 'file with keys required'));
(await until(async () => (await fileBytes(b)) === 'file over a proven link'.length + 'file with keys required'.length, 30000)) >= 0 ? ok('a file reaches B with keys required') : fail('no file on B with keys required');
check((await fileBytes(c)) === 0, 'the device without a certificate gets no file');
await hook(b, () => window.__app.append('space/personal', 't', 'still '));
(await until(async () => (await text(a)).includes('still'), 20000)) >= 0 ? ok('the certified devices keep syncing') : fail('A and B stopped syncing');

await finish(browser);
