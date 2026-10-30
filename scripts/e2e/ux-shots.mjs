// Dev tool, not a pass/fail suite (run.mjs leaves it out of a full `npm run e2e`): screenshots of
// the app as a new user meets it, for UX reviews (#300). It puts the app into each state and
// shoots the Welcome screen, every Settings page, the passphrase fields and the share panel at
// desktop width and at 375 px.
//
//   npm run e2e ux-shots
//   UX_SHOTS_DIR=~/yak-shots npm run e2e ux-shots     # default: <tmp>/yak-ux-shots
//
// States (one folder each): welcome, single (one device after "Start fresh"), two-devices (synced),
// keys (device keys required) and shared (a space shared with a second account). Files are named
// `<page>-desktop.png` and `<page>-phone.png`. Test data only; nothing is written inside the repo.
//
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, launch, ok, fail, watchPage, until, finish, keepAllSpaces, sleep, openJoin, startSyncing, unlockIfAsked } from './lib.mjs';

const OUT = process.env.UX_SHOTS_DIR || join(tmpdir(), 'yak-ux-shots');
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 375, height: 812 } };
const MANAGE = ['', 'backup', 'devices', 'import'];
const route = (id) => (id ? `#/settings/${id}` : '#/settings');
const PASS_A = 'ux shots passphrase for account A';
const PASS_B = 'ux shots passphrase for account B';

const browser = await launch({ fakeCamera: true });
const hook = (p, f, arg) => p.evaluate(f, arg);

async function mk(name, query = '?test') {
  const page = await (await browser.newContext({ permissions: ['camera'], viewport: VIEWPORTS.desktop })).newPage();
  watchPage(page, name);
  await page.goto(`${BASE}${query}#/time`);
  return page;
}

let taken = 0;
/** Shoots the page as it is, at both widths, then restores the desktop size. */
async function shot(page, state, name) {
  mkdirSync(join(OUT, state), { recursive: true });
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(size);
    await sleep(400);
    await page.screenshot({ path: join(OUT, state, `${name}-${vp}.png`), fullPage: true });
    taken++;
  }
  // The Settings page is also shot in the dark theme.
  if (/settings-home|settings-devices|^timer-|-space-|-account-/.test(name)) {
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const [vp, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size);
      await sleep(300);
      await page.screenshot({ path: join(OUT, state, `${name}-${vp}-dark.png`), fullPage: true });
      taken++;
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await page.setViewportSize(VIEWPORTS.desktop);
}

/** Opens a hash route and waits for the page to settle. */
async function go(page, route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  await sleep(900);
}

const shootManage = async (page, state, prefix = 'settings') => {
  for (const id of MANAGE) {
    await go(page, route(id));
    await shot(page, state, `${prefix}-${id || 'home'}`);
  }
};

const dismissBanners = async (page) => {
  for (const b of await page.getByRole('button', { name: 'Got it' }).all()) await b.click().catch(() => {});
  await sleep(300);
};

const unlock = (p, pass) => until(async () => (await hook(p, (x) => window.__app.unlock(x), pass)) === 'ok', 30000);

// 1. Welcome: a device with no space and no sync code.
const w = await mk('welcome', '?test&welcome');
await w.getByRole('heading', { name: /Welcome/ }).waitFor();
await shot(w, 'welcome', 'welcome');
await openJoin(w);
await shot(w, 'welcome', 'welcome-join-open');
await w.locator('summary', { hasText: /^Connection server$/ }).click();
await shot(w, 'welcome', 'welcome-signaling-open');
await go(w, '#/help');
await shot(w, 'welcome', 'help-before-setup');
ok('welcome shots');

// 2. One device after "Start fresh": the first Timer with its banners, then every page.
await go(w, '#/time');
await w.getByRole('button', { name: 'Time, notes and tasks' }).click();
await w.getByRole('link', { name: 'Settings' }).waitFor();
await sleep(800);
await shot(w, 'single', 'timer-first-run');
await dismissBanners(w);
await shot(w, 'single', 'timer');
// Timer List, Week and Reports (R-335) with a few entries, in light and dark; then the rest.
await go(w, '#/time/reports');
await w.waitForFunction(() => window.__reports);
await hook(w, () => {
  const at = (h, m, days) => new Date(Date.now() - days * 86_400_000 + (h - 12) * 3_600_000 + m * 60_000).toISOString();
  window.__reports.seed('Personal', {
    clients: [{ ref: 'acme', name: 'Acme' }],
    projects: [{ ref: 'web', name: 'Website', client: 'acme', rate: 100, currency: 'USD', color: '#2f6fde' }, { ref: 'audit', name: 'Audit', color: '#1a7f37' }],
    entries: [
      { start: at(9, 0, 0), stop: at(10, 30, 0), description: 'Design review', project: 'web', billable: true, tags: ['ui'] },
      { start: at(11, 0, 1), stop: at(12, 30, 1), description: 'Audit work', project: 'audit' },
      { start: at(9, 0, 2), stop: at(13, 0, 2), description: 'Planning', project: 'web' },
      { start: at(9, 0, 9), stop: at(11, 0, 9), description: 'Earlier week', project: 'audit' },
    ],
  });
});
for (const route of ['time/list', 'time/week', 'time/reports']) {
  await go(w, `#/${route}`);
  await shot(w, 'single', route.replace('/', '-'));
}
// The way back from another range: Previous, then the shot shows the highlighted label.
await go(w, '#/time/reports');
await w.getByRole('button', { name: 'Previous period' }).click();
await sleep(300);
await shot(w, 'single', 'timer-reports-previous');
await w.getByRole('button', { name: 'Back to this week' }).click();
for (const route of ['notes', 'tasks', 'help']) {
  await go(w, `#/${route}`);
  await shot(w, 'single', route);
}
await shootManage(w, 'single');
await go(w, '#/settings/backups/open');
await w.getByRole('button', { name: 'Create a passphrase…' }).click();
await w.getByRole('button', { name: 'Type my own' }).click();
await w.getByLabel('New passphrase').fill('abc');
await w.getByLabel('Repeat the passphrase').fill('abc');
await sleep(500);
await shot(w, 'single', 'passphrase-too-short');
ok('single-device shots');

// 3. Two synced devices (A and B), then device keys required, in two accounts.
const a1 = await mk('A1');
await go(a1, '#/settings/devices');
await startSyncing(a1, PASS_A);
await dismissBanners(a1);
await shot(a1, 'syncing-one', 'settings-devices');
const a2 = await mk('A2');
await go(a2, '#/settings/devices');
await a1.getByRole('button', { name: 'Make a one-time code' }).click();
const code = (await a1.locator('[data-invite-code]').innerText()).trim();
await shot(a1, 'syncing-one', 'one-time-code');
await (await openJoin(a2)).locator('input[aria-label="One-time code"]').fill(code);
await shot(a2, 'two-devices', 'join-form-filled');
const loaded = a2.waitForEvent('load', { timeout: 60000 });
await a2.getByRole('button', { name: 'Join', exact: true }).click();
await a2.locator('[data-join="compare"] code.compare-code').waitFor({ timeout: 30000 });
await shot(a2, 'two-devices', 'join-compare-code');
await shot(a1, 'two-devices', 'approve-request');
await a1.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await unlockIfAsked(a1, PASS_A);
await a2.getByRole('button', { name: 'The codes match' }).click();
await loaded;
await keepAllSpaces(a2);
await a2.waitForFunction(() => window.__app);
const accountA = await hook(a1, () => window.__app.accountId());
(await until(async () => (await hook(a2, () => window.__app.accountId())) === accountA, 30000)) >= 0 ? ok('A2 joined') : fail('A2 did not join');
await until(async () => (await a1.locator('li.device-row').count()) > 0, 20000);
await dismissBanners(a2);
for (const [p, tag] of [[a1, 'A1'], [a2, 'A2']]) {
  for (const id of ['', 'devices', 'backup']) {
    await go(p, route(id));
    await shot(p, 'two-devices', `${tag}-settings-${id || 'home'}`);
  }
}

await until(async () => { const k = await hook(a2, () => window.__app.keys()); return k.required && k.certified; }, 40000);
for (const id of ['', 'devices', 'backup']) {
  await go(a1, route(id));
  await shot(a1, 'keys', `A1-settings-${id || 'home'}`);
}
await go(a1, '#/settings');
await a1.getByRole('button', { name: '+ Share with an account' }).click();
await shot(a1, 'keys', 'A1-share-form-locked');
await unlock(a1, PASS_A);
await a1.keyboard.press('Escape');
await go(a1, '#/settings');
const open = a1.getByRole('button', { name: '+ Share with an account' });
if (await open.count()) await open.click();
await shot(a1, 'keys', 'A1-share-form-unlocked');
ok('keys-required shots');

// 4. A second account, and a space shared with it.
const b1 = await mk('B1');
await dismissBanners(b1);
await go(b1, '#/settings/devices');
await startSyncing(b1, PASS_B);
const spaceA = await hook(a1, () => window.__app.spaces().personal);
await unlock(a1, PASS_A);
const link = await hook(a1, () => window.__app.shareOpen('personal', 'Alice'));
await go(a1, '#/settings');
await a1.keyboard.press('Escape');
await a1.getByRole('button', { name: '+ Share with an account' }).click();
await shot(a1, 'shared', 'A1-link-open');
await a1.keyboard.press('Escape');
await hook(b1, ([c, n]) => window.__app.shareAsk(c, n), [link, 'Bob']);
await until(async () => (await hook(b1, () => window.__app.shareJoin()))?.phase === 'compare' && ((await hook(a1, () => window.__app.shareHost()))?.requests.length ?? 0) > 0, 40000);
for (const [p, tag] of [[a1, 'A1'], [b1, 'B1']]) {
  await go(p, '#/settings');
  await p.getByRole('button', { name: '+ Share with an account' }).click().catch(() => {});
  await shot(p, 'shared', `${tag}-compare-code`);
  await p.keyboard.press('Escape');
}
const req = (await hook(a1, () => window.__app.shareHost())).requests[0];
await hook(b1, () => window.__app.shareConfirm());
await hook(a1, (id) => window.__app.shareApprove(id), req.id);
(await until(async () => (await hook(b1, () => window.__app.shareJoin()))?.phase === 'done', 40000)) >= 0 ? ok('B joined the share') : fail('B did not join the share');
await until(async () => (await hook(b1, (s) => window.__app.shareView(s), spaceA))?.active, 30000);
for (const [p, tag] of [[a1, 'A1'], [b1, 'B1']]) {
  for (const id of ['', 'devices']) {
    await go(p, route(id));
    await shot(p, 'shared', `${tag}-settings-${id || 'home'}`);
  }
  await go(p, '#/time');
  await shot(p, 'shared', `${tag}-timer`);
}
// The space page (Kept on, Shared with) and the account page, for both sides.
const fps = { A1: await hook(a1, () => window.__app.accountFp()), B1: await hook(b1, () => window.__app.accountFp()) };
for (const [p, tag, other] of [[a1, 'A1', fps.B1], [b1, 'B1', fps.A1]]) {
  await go(p, `#/settings/space/${spaceA}`);
  await shot(p, 'shared', `${tag}-space-personal`);
  await go(p, `#/settings/account/${other}`);
  await shot(p, 'shared', `${tag}-account-other`);
}
ok('shared shots');

console.log(`${taken} screenshots in ${OUT}`);
await finish(browser);
