// End-to-end: a backup by another device counts as cover (#83).
// A (Chromium, folder in the Origin Private File System) and B (no folder picker, as Firefox or a phone) sync.
// 1. B has data and no backup: the Backup line says "none yet".
// 2. A backs up after B's changes reached it: B shows "Backed up by <A>" and no warning.
// 3. B edits while A is closed: still no warning at first, because A's backup is recent.
// 4. A day passes (the page clock on B): B warns and names A.
//
//   npm run e2e backup-cover
//
import { BASE, launch, check, watchPage, poll, finish, startSyncing, joinByInvite } from './lib.mjs';

const browser = await launch({ fakeCamera: true });
const mk = async (name, { picker, clock, bar }) => {
  const context = await browser.newContext({ permissions: ['camera'] });
  if (clock) await context.clock.install({ time: new Date() });
  await context.addInitScript((withPicker) => {
    if (withPicker) window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('picked-backups', { create: true });
    else delete window.showDirectoryPicker;
  }, picker);
  const page = await context.newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}?test${bar ? '&backupbar' : ''}#/devices`);
  await page.waitForFunction(() => window.__app);
  return page;
};

const a = await mk('A', { picker: true });
await startSyncing(a);
const b = await mk('B', { picker: false, clock: true, bar: true });
await joinByInvite(a, b);
await b.evaluate(() => { location.hash = '#/settings'; });
for (const p of [a, b]) {
  await p.waitForFunction(() => window.__backup !== undefined, null, { timeout: 15000 });
  await p.evaluate(() => window.__backup.ready());
}
await a.evaluate(() => { location.hash = '#/settings'; });
// Name the devices so the line can show A's name.
const line = (p) => p.locator('[data-line="backup"]').innerText().then((t) => t.replace(/\s+/g, ' '));
const entries = (p, text) => p.evaluate((t) => JSON.stringify(window.__backup.dump()).includes(t), text);
// The backup bar above the pages (shown in a test build only with `backupbar` in the URL) is what warns.
const warned = (p) => p.locator('.backup-banner.warn').count().then((n) => n > 0);

// 1. B holds data, nothing is backed up anywhere.
await b.evaluate(() => window.__backup.addEntry('personal', 'cover-b-first'));
check(await poll(() => entries(a, 'cover-b-first'), 30000), 'B\'s entry reached A');
check(await poll(async () => /none yet/.test(await line(b)), 15000), `B with data and no backup says "none yet" (${await line(b)})`);
// The bar re-reads whether there is data once a minute.
await b.clock.fastForward('01:05');
check(await poll(() => warned(b), 10000), 'and the backup bar warns');

// 2. A backs up with B's change; B is covered.
await a.evaluate((n) => window.__backup.useOpfs(n), 'a-folder');
check((await a.evaluate(() => window.__backup.run())) === 'written', 'A wrote a folder backup');
// The Backup line re-reads the other devices' records once a minute (the page clock on B is moved on, so the test need not wait).
await poll(async () => { await b.clock.fastForward('01:05'); return /Backed up by /.test(await line(b)); }, 40000, 1500);
check(await poll(async () => /Backed up by .+, (just now|\d+ minutes? ago)/.test(await line(b)), 30000), `B shows "Backed up by <device>" (${await line(b)})`);
check(await poll(async () => { await b.clock.fastForward('01:05'); return !(await warned(b)); }, 20000, 1500), 'and B shows no warning');
check((await b.evaluate(() => window.__backup.state())).lastBackupAt === undefined, 'B itself never backed up');

// 3. A closes; B edits. A's backup is recent, so B waits without a warning.
await a.context().close();
await b.evaluate(() => window.__backup.addEntry('personal', 'cover-b-second'));
await b.clock.fastForward('02:00:00');
await new Promise((r) => setTimeout(r, 1500));
check(!(await warned(b)), `B with a change not yet in A's backup does not warn at once (${await line(b)})`);

// 4. A day later A's backup is older than the threshold: B warns and names A.
await b.clock.fastForward('23:00:00');
check(await poll(async () => /none yet/.test(await line(b)) && (await warned(b)), 30000), `B warns once the backup is older than the threshold (${await line(b)})`);
await b.evaluate(() => { location.hash = '#/settings/backup'; });
check(await poll(async () => /Open .+ so it backs up .*download a backup/.test(await b.locator('.backup-health').innerText().catch(() => '')), 15000), 'and Backup & restore names the device that backs up and the fix');

await finish();
