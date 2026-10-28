// End-to-end: a keyless account (made with test hooks; the app no longer offers one) switches to
// device keys (#311, F39). The owner sets the passphrase in the banner itself and ticks only this
// device; the other one is told it will have to join again and that nothing on it is deleted. It
// keeps working locally, stops syncing, joins again with a one-time code, and everything it wrote
// before and after the switch reaches the owner.
//
//   npm run e2e device-migration
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, keepAllSpaces, sleep, joinByInvite, PASS, fillSheet, openAdvanced } from './lib.mjs';

const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const hook = (p, f, arg) => p.evaluate(f, arg);
const keys = (p) => hook(p, () => window.__app.keys());
const text = (p) => hook(p, () => window.__app.text('space/personal', 't') ?? '');
const append = (p, s) => hook(p, (x) => window.__app.append('space/personal', 't', x), s);

const a = await mk('A');
const code = await hook(a, () => window.__app.startKeyless());
const s = await mk('S');
await Promise.all([s.waitForEvent('load', { timeout: 60000 }), hook(s, (x) => window.__app.joinKeyless(x), code)]);
await keepAllSpaces(s);
await s.waitForFunction(() => window.__app);
(await until(async () => (await keys(a)).certified && (await keys(s)).certified, 30000)) >= 0 ? ok('a keyless account with two devices') : fail('no keyless pair');
await append(s, 'before-switch ');
(await until(async () => (await text(a)).includes('before-switch'), 30000)) >= 0 ? ok('they sync as before') : fail('no sync before the switch');
const idS = await hook(s, () => window.__app.deviceId());

// The banner asks for a passphrase because none is set, refuses a short one, then switches.
await openAdvanced(a);
const review = a.locator('section[aria-label="Device keys"]');
await review.locator(`li[data-device="${idS}"]`).waitFor({ timeout: 30000 });
check((await review.locator('[data-join-again]').innerText()).includes(idS.slice(0, 8)) || (await review.locator('[data-join-again]').count()) === 1, 'before the press it lists the device that will have to join again');
await review.getByRole('button', { name: /^Switch to device keys/ }).click();
const sheet = a.locator('[data-passphrase-sheet]');
await sheet.getByRole('button', { name: 'Type my own' }).click();
await sheet.locator('input[aria-label="New passphrase"]').fill('too short');
await sheet.locator('input[aria-label="Repeat the passphrase"]').fill('too short');
await sheet.getByLabel("I've written it down").check();
check((await sheet.getByText(/at least 20/).first().isVisible()) && (await sheet.getByRole('button', { name: /^Create and / }).isDisabled()), 'a passphrase under 20 characters is refused');
await fillSheet(a, PASS);
(await until(async () => (await keys(a)).required, 30000)) >= 0 ? ok('the account requires device keys') : fail(`A keys ${JSON.stringify(await keys(a))}`);

// The left-out device keeps working and keeps everything; it hears nothing more.
await append(a, 'owner-after ');
await append(s, 'left-out-after ');
await sleep(4000);
check((await text(s)).includes('before-switch') && (await text(s)).includes('left-out-after'), 'the left-out device keeps its data and its new edits');
check(!(await text(s)).includes('owner-after') && !(await text(a)).includes('left-out-after'), 'and syncs nothing until it joins again');

// Join again: the device's own Devices page offers it; its data stays and merges.
await s.locator('details.danger-zone summary', { hasText: 'Join again' }).click();
await s.getByRole('button', { name: 'Join again with a one-time code…' }).click();
await s.getByRole('button', { name: 'Stop syncing and join again' }).click();
await joinByInvite(a, s, { keep: false });
(await until(async () => (await text(a)).includes('left-out-after') && (await text(s)).includes('owner-after'), 60000)) >= 0 ? ok('after joining again both devices hold everything: before, owner-after and left-out-after') : fail(`A: ${await text(a)} / S: ${await text(s)}`);
check((await text(a)).includes('before-switch'), 'nothing from before the switch was lost');

await finish(browser);
