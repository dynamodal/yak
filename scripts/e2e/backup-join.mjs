// End-to-end: "Back up now" on a device that just joined an account with a passphrase (#77).
// Device A starts syncing (creates the passphrase); B joins, enters the passphrase, turns on
// encrypted backups and presses Back up now: first with no folder chosen, then with one. Every
// press must say what happened. The native folder picker is replaced by one that returns a folder
// in the Origin Private File System (the same File System Access code runs).
//
//   npm run e2e backup-join
//
import { BASE, launch, check, watchPage, poll, finish, startSyncing, joinByInvite, fillSheet, PASS } from './lib.mjs';

const browser = await launch({ fakeCamera: true });
const mk = async (name) => {
  const context = await browser.newContext({ permissions: ['camera'] });
  await context.addInitScript(() => {
    // A test flips window.__cancelPick to act as a user who closes the picker.
    window.showDirectoryPicker = async () => {
      if (window.__cancelPick) throw new DOMException('cancelled', 'AbortError');
      return (await navigator.storage.getDirectory()).getDirectoryHandle('picked-backups', { create: true });
    };
  });
  const page = await context.newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}?test#/devices`);
  await page.waitForFunction(() => window.__app);
  return page;
};

const a = await mk('A');
await startSyncing(a);
const b = await mk('B');
await joinByInvite(a, b);
await b.evaluate(() => { location.hash = '#/settings/backups/open'; });
await b.waitForFunction(() => window.__backup !== undefined, null, { timeout: 15000 });
await b.evaluate(() => window.__backup.ready());

const button = b.getByRole('button', { name: 'Back up now' });
const text = async () => (await b.locator('main').innerText()).replace(/\s+/g, ' ');
const said = (re, ms = 30000) => b.locator('main').getByText(re).first().waitFor({ timeout: ms }).then(() => true, () => false);
const note = () => b.locator('[data-backup-now-note]').innerText().catch(() => '');

// Unlock with the passphrase and turn on encrypted backups.
await b.getByRole('button', { name: 'Enter passphrase…' }).click();
await fillSheet(b, PASS);
await b.getByLabel('Write only encrypted backups from this device').check();

// No folder: the page says what the button does; with the picker closed it says no folder was chosen.
check(await poll(async () => /No backup folder yet/.test(await note()), 10000), 'no folder: the page says next to the button that it will ask for one');
check(await button.isEnabled(), 'no folder: Back up now is a way to choose one');
await b.evaluate(() => { window.__cancelPick = true; });
await button.click();
check(await said(/No folder was chosen/), 'no folder, picker closed: the page says so');
check((await b.evaluate(() => window.__backup.state())).lastBackupAt === undefined, 'nothing was written without a folder');

// Choose a folder through the button: the backup is written encrypted and says so.
await b.evaluate(() => { window.__cancelPick = false; });
await button.click();
check(await said(/^Backed up to /), `no folder, then chosen: Back up now wrote a backup (${(await text()).slice(0, 500)})`);
check(await poll(async () => (await b.evaluate(() => window.__backup.encryptedState())).header === 'PDENC1', 15000), 'the backup in the new folder is encrypted');
const enc = await b.evaluate(() => window.__backup.encryptedState());
check(enc.readable === 0, 'no readable export in the folder');
const first = (await b.evaluate(() => window.__backup.state())).lastBackupAt;
check(!!first && /Backed up (just now|\d+ minutes? ago)/.test(await b.locator('.backup-health').innerText()), 'Last backup is updated and the health line agrees');

// With a folder: written again, a newer time.
await new Promise((r) => setTimeout(r, 1100));
await button.click();
check(await poll(async () => (await b.evaluate(() => window.__backup.state())).lastBackupAt !== first, 30000), 'Back up now with a folder writes a newer backup');
check(await said(/^Backed up to /), 'and says so');

// Another tab holds the backup lock: the button waits (says it is backing up), then reports the result.
const other = await b.context().newPage();
await other.goto(`${BASE}?test#/settings/backups/open`);
await other.evaluate(() => new Promise((res) => { navigator.locks.request('app-backup', () => new Promise((release) => { window.__release = release; })); setTimeout(res, 200); }));
const before = (await b.evaluate(() => window.__backup.state())).lastBackupAt;
await button.click();
check(await b.getByText('Backing up…').waitFor({ timeout: 10000 }).then(() => true, () => false), 'a backup waiting for another tab says it is backing up');
await other.evaluate(() => window.__release());
check(await said(/^Backed up to /), 'after the other tab finishes the result is reported');
check((await b.evaluate(() => window.__backup.state())).lastBackupAt !== before, 'and the backup was written');
await other.close();

// The device forgets the passphrase while encrypted backups stay on: disabled, with the reason, and nothing is written.
await b.evaluate(() => { location.hash = '#/settings/passphrase/manage'; });
await b.getByRole('button', { name: 'Forget the passphrase on this device' }).click();
await b.evaluate(() => { location.hash = '#/settings/backups'; });
check(await poll(async () => /does not have the passphrase/.test(await note()), 10000), 'without the passphrase the page says why next to the button');
check(await button.isDisabled(), 'and Back up now is disabled, so no unencrypted backup can be written');

await finish();
