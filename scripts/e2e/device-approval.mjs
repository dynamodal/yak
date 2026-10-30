// End-to-end: device keys, slice 3 (#257). Three devices sync in compatible mode; the owner sets a
// passphrase, reviews the devices and requires keys, approving two. The third (certified on first use)
// stops getting data. A new device joins by one-time invite after both screens show the same code;
// the account's old sync code alone gets nobody in. The unapproved device is approved later, the
// account key changes hands, and every device keeps syncing.
//
//   npm run e2e device-approval
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, keepAllSpaces, sleep, waitFor, openJoin, PASS, fillSheet, openAdvanced } from './lib.mjs';

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
const idOf = (p) => hook(p, () => window.__app.deviceId());
const append = (p, s) => hook(p, (x) => window.__app.append('space/personal', 't', x), s);
// A keyless account as before #311, made with test hooks: the app no longer offers one, but accounts from earlier builds are (the migration, F39).
const join = async (p, code) => {
  await Promise.all([p.waitForEvent('load', { timeout: 60000 }), hook(p, (x) => window.__app.joinKeyless(x), code)]);
  await keepAllSpaces(p);
  await p.waitForFunction(() => window.__app);
};

const a = await mk('A');
const code = await hook(a, () => window.__app.startKeyless());
const account = await accountId(a);
const b = await mk('B');
await join(b, code);
const h = await mk('H');
await join(h, code);
const [idA, idB, idH] = [await idOf(a), await idOf(b), await idOf(h)];
(await until(async () => (await accountId(b)) === account && (await accountId(h)) === account, 30000)) >= 0 ? ok('B and H joined in compatible mode') : fail('B or H did not join');
(await until(async () => (await keys(b)).certified && (await keys(h)).certified, 30000)) >= 0 ? ok('both certified on first use') : fail('no first-use certificates');

// The passphrase protects the account key; the switch needs it.
await a.goto(BASE + '?test#/settings/passphrase');
await a.locator('[data-line="passphrase"]').getByRole('button', { name: 'Create…' }).click();
await fillSheet(a, PASS);
await a.goto(BASE + '?test#/devices');
await a.waitForFunction(() => window.__app);

// The review: every device listed with its fingerprint; A approves B but not H.
await openAdvanced(a);
const review = a.locator('section[aria-label="Device keys"]');
await review.locator(`li[data-device="${idH}"]`).waitFor({ timeout: 30000 });
check((await review.locator('li[data-state="ready"]').count()) === 3, 'the review lists all three devices as ready');
const bName = (await review.locator(`li[data-device="${idB}"] input[type=checkbox]`).getAttribute('aria-label')) ?? '';
const own = review.locator(`li[data-device="${idA}"] input[type=checkbox]`);
check((await own.isChecked()) && (await own.isDisabled()), 'the device that switches is always approved: its box is ticked and cannot be unticked');
await review.getByLabel(bName).check();
const hName = (await review.locator(`li[data-device="${idH}"]`).locator('code.hint').first().innerText()).trim();
const effects = await review.locator('[data-switch-effects]').innerText();
check(/cannot be undone/i.test(effects) && /rolled back/i.test(effects) && /No data is lost/.test(effects), 'the banner names the risk before the press: one way, rollback stops sync, no data lost');
const again = await review.locator('[data-join-again]').innerText();
check(again.includes(hName) && /join again with a one-time code/i.test(again) && /Nothing on them is deleted/.test(again), 'it says before the press which device will need to join again, and that nothing on it is deleted');
check((await hook(a, (p) => window.__app.unlock(p), 'not the passphrase')) === 'wrong', 'a wrong passphrase is refused');
// The passphrase was just typed in Security: it stays unlocked for a few minutes, so the page does not ask again.
check(!(await a.locator('[data-passphrase-sheet="enter"]').count()), 'the passphrase is not asked again while unlocked');
await review.getByRole('button', { name: 'Switch to device keys for these 2 devices' }).click();
await fillSheet(a, PASS);
(await until(async () => (await keys(a)).required && (await keys(b)).required, 30000)) >= 0 ? ok('A and B require keys') : fail(`required A ${JSON.stringify(await keys(a))} B ${JSON.stringify(await keys(b))}`);
const meta = await hook(a, (id) => window.__app.json(`account/${id}`, 'meta'), account);
check(meta?.schema_version === 2, `the account document is version 2, so older builds say to update (${JSON.stringify(meta)})`);
check(!(await keys(a)).certs.includes(idH), 'H, certified only on first use, no longer counts');

await append(a, 'after-switch ');
(await until(async () => (await text(b)).includes('after-switch'), 30000)) >= 0 ? ok('A and B keep syncing') : fail('A and B stopped syncing');
await sleep(waitFor(4000));
check(!(await text(h)).includes('after-switch'), 'the unapproved device gets nothing new');

// A one-time invite: the new device asks, both screens show the same code, the owner approves.
await a.evaluate(() => { location.hash = '#/settings/devices/add'; });
await a.getByRole('button', { name: 'Make a one-time code' }).click();
const invite = (await a.locator('[data-invite-code]').innerText()).trim();
check(invite.replace(/-/g, '') !== code.replace(/-/g, ''), 'the invite is a new code');
const n = await mk('N');
await (await openJoin(n)).locator('input[aria-label="One-time code"]').fill(invite);
const loaded = n.waitForEvent('load', { timeout: 60000 });
await n.getByRole('button', { name: 'Join' }).click();
const nCompare = await n.locator('[data-join="compare"] code.compare-code').innerText({ timeout: 30000 });
const aCompare = await a.locator('[data-compare]').first().innerText({ timeout: 30000 });
check(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/.test(nCompare) && nCompare === aCompare, `both screens show the same 64-bit code (${nCompare} / ${aCompare})`);
// Needs you (F-33): while the request waits, Settings lists it first and the Settings tab carries a dot.
check((await a.locator('.main-tabs a', { hasText: /^Settings/ }).locator('.tab-badge').count()) === 1, 'the Settings tab shows a dot while a device asks to join');
await a.evaluate(() => { location.hash = '#/settings'; });
await a.locator('[data-need^="join:"]').waitFor({ timeout: 10000 });
check((await a.locator('section.st-section > h2').first().innerText()).trim() === 'Needs you' && /asks to join/.test(await a.locator('[data-need^="join:"]').innerText()) && /min left/.test(await a.locator('[data-need^="join:"]').innerText()), 'Settings lists the request first, under Needs you, with the minutes left');
await a.locator('[data-need^="join:"] a').click();
await a.locator('.invite-requests').waitFor();
// Approved before the new device confirmed: it waits for its person to say the codes match.
await a.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await sleep(waitFor(3000));
check((await accountId(n)) !== account, 'the new device does not follow an approval before its person confirmed the codes');
await n.getByRole('button', { name: 'The codes match' }).click();
await loaded;
await keepAllSpaces(n);
await n.waitForFunction(() => window.__app);
(await until(async () => (await accountId(n)) === account, 30000)) >= 0 ? ok('N joined the account') : fail('N did not join');
(await until(async () => (await keys(n)).certified && (await keys(n)).required, 30000)) >= 0 ? ok('N is approved and knows keys are required') : fail(`N keys ${JSON.stringify(await keys(n))}`);
(await until(async () => (await text(n)).includes('after-switch'), 30000)) >= 0 ? ok('N receives the data') : fail('no data on N');

check(await until(async () => (await a.locator('[data-invite-code]').count()) === 0 && (await a.locator('section[aria-label="Add a device"] .qr-pair').count()) === 0, 15000) >= 0, 'once the device joined, the approving device folds away the used code and its QR code');

// A leaked code alone gets nobody in: the account's old sync code, and the spent invite (which says so).
for (const [label, c] of [['old sync code', code], ['spent invite', invite]]) {
  const l = await mk(`L-${label}`);
  await (await openJoin(l)).locator('input[aria-label="One-time code"]').fill(c);
  await l.getByRole('button', { name: 'Join' }).click();
  if (c === invite) {
    check(await l.locator('[data-join="declined"]', { hasText: 'already used' }).waitFor({ timeout: 20000 }).then(() => true, () => false), 'the spent invite says it was already used');
    // A decline does not unpair by itself (#291): the person chooses another code.
    await l.locator('[data-join="declined"]').getByRole('button', { name: 'Use another code' }).click();
    check(await l.locator('input[aria-label="One-time code"]').waitFor({ timeout: 10000 }).then(() => true, () => false), 'after "Use another code" the code box is back');
  } else await sleep(waitFor(12000));
  check((await accountId(l)) !== account && !(await text(l)).includes('after-switch'), `the ${label} alone gets no account and no data`);
  await l.context().close();
}

// H approved later from Devices (passphrase still unlocked on A).
await openAdvanced(a);
await a.locator(`section[aria-label="Device keys"] li[data-device="${idH}"]`).waitFor({ timeout: 60000 });
await a.locator(`section[aria-label="Device keys"] li[data-device="${idH}"]`).getByRole('button', { name: /^Approve/ }).click();
(await until(async () => (await keys(h)).certified, 30000)) >= 0 ? ok('H approved later') : fail('H not approved');
await hook(h, () => window.__app.dropLink());
(await until(async () => (await text(h)).includes('after-switch'), 40000)) >= 0 ? ok('and syncs again') : fail('H still gets nothing');

// A device that still had the old account id (S-76r) folds it in once and forgets it (#295).
await hook(b, () => localStorage.setItem('app-account-legacy', 'f'.repeat(24)));
await b.reload();
await b.waitForFunction(() => window.__app);
check((await hook(b, () => localStorage.getItem('app-account-legacy'))) === '' && (await accountId(b)) === account, 'a device forgets the old account id on start');
await append(b, 'after-drop ');
(await until(async () => (await text(a)).includes('after-drop'), 30000)) >= 0 ? ok('and keeps syncing') : fail('B stopped syncing after dropping the old id');
check(idA !== idB, 'distinct devices');

await finish(browser);
