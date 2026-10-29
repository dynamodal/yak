// End-to-end: universal search. Ctrl+Shift+F opens it on every page; one word finds a note and a
// time entry, each result opens the right place; it works at 375 px.
//
//   npm run e2e search
//
import { BASE, launch, check, watchPage, until, finish, newNote } from './lib.mjs';

const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
watchPage(p, 'A');
await p.goto(BASE + '?test#/notes');
await p.waitForFunction(() => window.__app);

// A note and a time entry that share a word.
await newNote(p);
await p.locator('input[aria-label="Note title"]').waitFor();
await p.keyboard.type('Zebra plan');
await p.keyboard.press('Enter');
await until(async () => (await p.evaluate(() => Object.values(window.__app.json('space/personal', 'notes')).filter((n) => n.path === 'Zebra plan.md').length)) === 1);
await p.evaluate(() => { location.hash = '#/time'; });
await p.locator('.tp-label').click();
await p.getByRole('dialog', { name: 'Timer details' }).getByLabel('Description', { exact: true }).fill('Feeding the zebra');
await p.getByRole('dialog', { name: 'Timer details' }).getByRole('button', { name: 'Start', exact: true }).click();
await until(async () => (await p.getByRole('button', { name: 'Stop timer' }).count()) === 1);
await p.getByRole('button', { name: 'Stop timer' }).click();

for (const hash of ['#/time', '#/time/reports', '#/notes', '#/organize']) {
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.keyboard.press('Control+Shift+F');
  check((await p.locator('dialog.search-dialog').count()) === 1, `Ctrl+Shift+F opens the search on ${hash}`);
  await p.locator('dialog.search-dialog').getByRole('button', { name: 'Close' }).click();
}

const open = async () => {
  await p.keyboard.press('Control+Shift+F');
  await p.getByLabel('Search query').fill('zebra');
};
await p.evaluate(() => { location.hash = '#/time'; });
await open();
check((await p.locator('.search-group', { hasText: 'Notes' }).count()) === 1 && (await p.locator('.search-group', { hasText: 'Time entries' }).count()) === 1, 'one word finds the note and the entry, in their groups');
await p.getByRole('option', { name: /Feeding the zebra/ }).click();
check((await until(async () => p.url().endsWith('#/time/week'))) >= 0, 'an entry opens in the Week view');
check((await until(async () => (await p.locator('li.entry.search-hit-flash').count()) === 1)) >= 0, 'and its row is highlighted');
await open();
await p.getByRole('button', { name: 'Time entries', exact: true }).click();
check((await p.locator('.search-group', { hasText: 'Notes' }).count()) === 0, 'a kind chip narrows the results');
await p.getByRole('button', { name: 'Time entries', exact: true }).click();
await p.getByRole('option', { name: /Zebra plan/ }).click();
check((await until(async () => p.url().includes('#/notes/'))) >= 0, 'a note opens in Notes');

// A phone width: the dialog fits and can be closed without a keyboard.
await p.setViewportSize({ width: 375, height: 700 });
await open();
const box = await p.locator('dialog.search-dialog').boundingBox();
check(box && box.x >= 0 && box.x + box.width <= 375, 'the search fits at 375 px');
await p.locator('dialog.search-dialog').getByRole('button', { name: 'Close' }).click();
check((await p.locator('dialog.search-dialog').count()) === 0, 'and has a Close button');

await finish(browser);
