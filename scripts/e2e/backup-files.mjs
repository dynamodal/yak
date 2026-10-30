// End-to-end: files in notes inside backups (#166 slice 4), in real Chrome against dist/.
//
//   npm run e2e backup-files
//
// Profile A: add two files, back up to a folder (Origin Private File System, as in the backup
// suite): each file is copied once by hash and has a readable copy; download the zip and the JSON.
// Profile B (a wiped browser): restore the zip. Profile C (another): restore to a time from a copy
// of the account folder. Both must end with the file bytes in the file store.
//
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, launch, check, watchPage, poll, finish } from './lib.mjs';

const browser = await launch();
const downloads = mkdtempSync(join(tmpdir(), 'backup-files-e2e-'));

async function profile(name) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}?test#/settings/backups/open`);
  await ready(page);
  return page;
}
async function ready(page) {
  await page.waitForFunction(() => window.__backup !== undefined, null, { timeout: 10000 });
  await page.evaluate(() => window.__backup.ready());
}
const E = (page, fn, arg) => page.evaluate(fn, arg);

/** Text of the file `hash`... held in the file store of `unit`, or null. */
const heldText = (page, unit) =>
  page.evaluate(async (u) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(`app-blobs-${u}`);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains('files')) return [];
    const all = await new Promise((res) => {
      const r = db.transaction('files').objectStore('files').getAll();
      r.onsuccess = () => res(r.result);
    });
    db.close();
    return Promise.all(all.map((rec) => rec.blob.text()));
  }, unit);

const later = () => new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// ---------- Profile A ----------
const a = await profile('A');
await E(a, () => window.__backup.seed('personal', 'Personal'));
await E(a, () => window.__app.addFile('space/personal', 'one.txt', 'file one bytes'));
await E(a, () => window.__app.addFile('space/personal', 'two.txt', 'file two bytes'));
const unit = await E(a, () => window.__app.spaces().personal);
await E(a, () => window.__backup.useOpfs('e2e-backup-files'));
await a.goto(`${BASE}?test#/settings/backups/open`);
await ready(a);
await a.getByText('Backing up to').waitFor();
check(/Your notes hold 2 files/.test(await a.getByTestId('backup-files').innerText()), 'A: Backups says how many files the notes hold');
check(/JSON download is text only and leaves them out/.test(await a.getByTestId('backup-files').innerText()), 'A: it says the JSON download leaves files out');
await a.getByRole('button', { name: 'Back up now' }).click();
await a.getByText(/^Backed up to /).waitFor();
const accountFiles = await E(a, () => window.__backup.exportAccount());
const paths = Object.keys(accountFiles);
check(paths.filter((p) => /\/blobs\/[0-9a-f]{64}$/.test(p)).length === 2, 'A: each file is in the folder once, by hash');
check(paths.some((p) => p.endsWith(`/current/docs/space~${unit}/attachments/one.txt`)), 'A: a readable copy sits beside the notes');
check(!paths.some((p) => p.includes('/restore-points/') && p.includes('attachments')), 'A: the restore point holds no copy of the bytes');

const [zipDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Download backup (zip, with files)' }).click()]);
const zipFile = join(downloads, zipDownload.suggestedFilename());
await zipDownload.saveAs(zipFile);
check(/^backup-.*\.zip$/.test(zipDownload.suggestedFilename()), `A: downloaded ${zipDownload.suggestedFilename()}`);
await a.getByText(/^Downloaded backup-.*\.zip, with 2 files/).waitFor();
await a.getByRole('button', { name: 'Download backup (JSON, without files)' }).click();
await a.getByText(/It leaves out the 2 files in your notes/).waitFor();
check(true, 'A: the JSON download says it leaves the files out');
await a.close();

// ---------- Profile B: restore the zip ----------
const b = await profile('B');
await b.getByLabel('Backup file').setInputFiles(zipFile);
await b.locator('.restore-panel').waitFor();
check(/All \d+ files match their checksums/.test(await b.locator('.restore-panel .verify').innerText()), 'B: the zip verifies');
check(/Files in notes: 2/.test(await b.locator('.backup-files').innerText()), 'B: the panel shows the files it carries');
await Promise.all([b.waitForEvent('load', { timeout: 30000 }), b.getByRole('button', { name: 'Merge into this device' }).click()]);
await ready(b);
const heldB = await poll(async () => (await heldText(b, unit)).length === 2, 10000);
check(heldB && (await heldText(b, unit)).sort().join('|') === 'file one bytes|file two bytes', 'B: the files are in the file store after the restore');

// ---------- Profile C: restore to a time from the account folder ----------
const c = await profile('C');
await E(c, () => window.__backup.useOpfs('e2e-backup-files-c'));
await E(c, (f) => window.__backup.importAccount(f), accountFiles);
await c.goto(`${BASE}?test#/devices`);
await c.goto(`${BASE}?test#/settings/backups/open`);
await ready(c);
await c.getByRole('button', { name: 'Restore to a time…' }).click();
await c.getByLabel('Restore as of').fill(later());
await c.getByRole('button', { name: 'Show that time' }).click();
await c.locator('.restore-panel').waitFor();
check(/Files in notes: 2/.test(await c.locator('.backup-files').innerText()), 'C: the rebuilt state lists the files');
await Promise.all([c.waitForEvent('load', { timeout: 30000 }), c.getByRole('button', { name: 'Merge into this device' }).click()]);
await ready(c);
const heldC = await poll(async () => (await heldText(c, unit)).length === 2, 10000);
check(heldC, 'C: the files came back from the folder');

await finish(browser);
