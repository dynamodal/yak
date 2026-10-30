// End-to-end: unused files in Manage (#166 slice 5). Sync is off.
//
//   npm run e2e unused-files
//
// A note links one of two files, so the other is unused. Manage lists it with its size,
// nothing was deleted by itself, Delete asks first, and a delete removes the file from the index; its bytes
// stay for Recently deleted until it is deleted for good there.
import { BASE, launch, check, watchPage, until, finish, newNote } from './lib.mjs';

const SPACE = 'space/personal';
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  watchPage(page, 'A');
  await page.goto(BASE + '?test#/notes');
  await newNote(page);
  await page.locator('input[aria-label="Note title"]').waitFor();
  await page.keyboard.type('Files');
  await page.keyboard.press('Enter');
  await page.locator('.note-editor').click();
  await page.getByLabel('Add files to this note').setInputFiles([{ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('keep me') }]);
  // A file in the space that no note links to (added through the app's test hook).
  await page.evaluate(([id]) => window.__app.addFile(id, 'drop.txt', 'drop me, a longer file'), [SPACE]);
  const index = () => page.evaluate(([id]) => window.__app.json(id, 'attachments'), [SPACE]);
  check((await until(async () => Object.keys((await index()) ?? {}).length === 2)) >= 0, 'two files are in the index');
  const bytes = () => page.evaluate(([id]) => window.__app.fileBytes(id), [SPACE]);
  const total = 'keep me'.length + 'drop me, a longer file'.length;
  check((await bytes()) === total, 'both files are stored; nothing deletes the unlinked one by itself');
  await page.waitForTimeout(500);

  await page.goto(BASE + '?test#/settings/notes');
  const unused = page.locator('.unused-files li');
  check((await until(async () => (await unused.count()) === 1)) >= 0, 'Manage lists one unused file');
  check(/drop\.txt/.test(await unused.first().innerText()) && /22 B/.test(await unused.first().innerText()), 'it shows the name and size');
  await page.getByRole('button', { name: 'Delete drop.txt' }).click();
  check((await bytes()) === total, 'Delete asks first: nothing is removed yet');
  await page.getByRole('button', { name: 'Delete for everyone' }).click();
  check((await until(async () => (await unused.count()) === 0)) >= 0, 'the file leaves the list');
  const left = Object.values(await index()).filter((a) => a.deleted !== true).map((a) => a.name);
  check(left.join() === 'keep.txt', `the index keeps only keep.txt (${left.join()})`);
  await page.waitForTimeout(800);
  check((await bytes()) === total, 'Recently deleted keeps its bytes for 45 days (B-107)');
  await page.goto(BASE + '?test#/settings/recently-deleted');
  await page.getByRole('button', { name: 'Delete drop.txt for good', exact: true }).click();
  await page.locator('.rd-confirm').getByRole('button', { name: 'Delete for good' }).click();
  check((await until(async () => (await bytes()) === 'keep me'.length)) >= 0, 'deleted for good: its bytes are gone, the other file stays');
} finally {
  await finish(browser);
}
