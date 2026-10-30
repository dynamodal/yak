// End-to-end: the browser folder mirror in real Chrome against dist/ served with the real headers,
// so any CSP violation or page error fails the run. The native folder picker cannot be automated,
// so the mirrored folder is a folder in the Origin Private File System, which goes through the same
// File System Access code (directory handle stored in IndexedDB, createWritable, directory walk).
// The test hook writes files in that folder to play the part of another editor.
//
//   npm run e2e mirror
//
// A note made in the app becomes a file; a file written outside becomes a note; an outside edit
// reaches the note; an app edit reaches the file; both changed gives a conflict copy shown on the
// Mirror screen; an outside delete removes the note; the setting and state survive a reload.
//
import { BASE, launch, check, watchPage, until, finish } from './lib.mjs';

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
watchPage(page, 'A', { consoleErrors: true });

const M = (fn, arg) => page.evaluate(fn, arg);
const pass = () => M(async () => (await window.__mirror.run(), window.__mirror.idle()));
const file = (path) => M((p) => window.__mirror.readFile(p), path);
const notes = () => M(() => window.__mirror.notes('personal'));

try {
  await page.goto(`${BASE}?test#/settings/mirror`);
  await page.waitForFunction(() => window.__mirror !== undefined && window.__app?.spaces().personal, null, { timeout: 15000 });
  await M(() => window.__mirror.useOpfs('mirror-e2e'));
  check((await page.getByText('Mirroring.').count()) === 1, 'the screen says it is mirroring');

  // App to file.
  await M(() => window.__mirror.addNote('personal', 'Ideas/Plan.md', 'first'));
  await pass();
  check((await file('Personal/Ideas/Plan.md')) === 'first', 'a note made in the app becomes a file');
  await M(() => window.__mirror.appendToNote('personal', 'Ideas/Plan.md', ' more'));
  await pass();
  check((await file('Personal/Ideas/Plan.md')) === 'first more', 'an edit in the app reaches the file');

  // File to app.
  await M(() => window.__mirror.writeFile('Personal/Inbox.md', 'from outside'));
  await pass();
  check((await notes())['Inbox.md'] === 'from outside', 'a file written outside becomes a note');
  await M(() => window.__mirror.writeFile('Personal/Inbox.md', 'edited outside'));
  await pass();
  check((await notes())['Inbox.md'] === 'edited outside', 'an edit made outside reaches the note');
  await M(() => window.__mirror.writeFile('Personal/.hidden/Skip.md', 'ignored'));
  await pass();
  check(!('.hidden/Skip.md' in (await notes())), 'hidden folders are ignored');

  // Outside delete.
  await M(() => window.__mirror.removeFile('Personal/Inbox.md'));
  await pass();
  check(!('Inbox.md' in (await notes())), 'a file deleted outside removes the note');

  // Conflict.
  await M(() => window.__mirror.appendToNote('personal', 'Ideas/Plan.md', ' app'));
  await M(() => window.__mirror.writeFile('Personal/Ideas/Plan.md', 'first more file'));
  await pass();
  const conflictPath = 'Personal/Ideas/Plan (conflict).md';
  check((await file(conflictPath)) === 'first more file', 'the file version is kept as a conflict copy');
  check((await file('Personal/Ideas/Plan.md')) === 'first more app', 'the app version keeps the name');
  check((await notes())['Ideas/Plan (conflict).md'] === 'first more file', 'the conflict copy is also a note');
  check((await until(() => page.locator('[data-conflicts] li').count().then((n) => n === 1))) >= 0, 'the Mirror screen lists the conflict');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  check((await until(() => page.locator('[data-conflicts]').count().then((n) => n === 0))) >= 0, 'dismissing clears the list');

  // Files (#166 slice 3): a file dropped in attachments/ enters the store, a delete goes both ways.
  const names = () => M(() => window.__mirror.attachments('personal'));
  await M(() => window.__mirror.writeBytes('Personal/attachments/data.bin', [1, 2, 3, 250]));
  await pass();
  check(JSON.stringify(await names()) === '["data.bin"]', 'a file added to attachments/ enters the index');
  await M(() => window.__mirror.writeBytes('Personal/attachments/data.bin', [9, 9]));
  await pass();
  check(JSON.stringify(await names()) === '["data.bin"]', 'a file replaced outside keeps its name');
  check(JSON.stringify(await M(() => window.__mirror.readBytes('Personal/attachments/data.bin'))) === '[9,9]', 'the replaced bytes stay in the folder');
  await M(() => window.__mirror.removeFile('Personal/attachments/data.bin'));
  await pass();
  check((await names()).length === 0, 'a file deleted in the folder is deleted from the index');
  check((await M(() => window.__mirror.readBytes('Personal/attachments/data.bin'))) === undefined, 'and does not come back');

  // Survives a reload: no duplicates, no deletes.
  const before = await notes();
  await page.reload();
  await page.waitForFunction(() => window.__mirror !== undefined && window.__app?.spaces().personal, null, { timeout: 15000 });
  await pass();
  check(JSON.stringify(await notes()) === JSON.stringify(before), 'the notes are unchanged after a reload');
  check((await M(() => window.__mirror.state().folder.state)) === 'granted', 'the folder is still granted after a reload');

  // Leaving a space out.
  await M(() => window.__mirror.addNote('work', 'W.md', 'work note'));
  await pass();
  check((await file('Work/W.md')) === 'work note', 'a second space gets its own folder');
  await page.getByRole('checkbox', { name: /Work/ }).uncheck();
  await until(() => M(() => window.__mirror.state().excluded.length === 1));
  await M(() => window.__mirror.addNote('work', 'W2.md', 'not mirrored'));
  await pass();
  check((await file('Work/W2.md')) === undefined, 'a space that is left out is not written');
} finally {
  await finish(browser);
}
