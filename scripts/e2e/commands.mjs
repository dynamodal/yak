// End-to-end: commands and shortcuts. Alt+S starts and stops the timer, Alt+T goes to the Time page,
// Alt+P opens the command palette, Ctrl+Shift+D inserts the date into the note being edited, and
// "Today" makes today's note from a template. Shortcuts are rebindable in Settings and the change
// is used at once, with conflicts refused.
//
//   npm run e2e commands
//
import { BASE, launch, check, watchPage, until, finish, notesMenu } from './lib.mjs';

const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
watchPage(p, 'A');
await p.goto(BASE + '?test#/entries');
await p.waitForFunction(() => window.__app);

const running = () => p.evaluate(() => Object.values(window.__app.json('space/personal/time', 'time_entries')).filter((e) => e.stop === null && !e.deleted).length);
const notes = () => p.evaluate(() => Object.values(window.__app.json('space/personal', 'notes')).filter((n) => !n.deleted));
const pad = (n) => String(n).padStart(2, '0');
const today = await p.evaluate(() => {
  const d = new Date();
  return { ymd: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, dd: String(d.getDate()).padStart(2, '0') };
});

// Timer and navigation.
await p.keyboard.press('Alt+S');
check((await until(async () => (await running()) === 1)) >= 0, 'Alt+S starts a timer from any page');
await p.keyboard.press('Alt+S');
check((await until(async () => (await running()) === 0)) >= 0, 'Alt+S stops it again');
await p.keyboard.press('Alt+T');
check((await until(async () => p.url().endsWith('#/time'))) >= 0, 'Alt+T goes to the Time page');

// The palette.
await p.keyboard.press('Alt+P');
await p.locator('dialog.palette').waitFor();
check((await p.locator('.palette-list li').count()) >= 5, 'Alt+P opens the palette with the commands');
check((await p.locator('.palette-list li', { hasText: 'Start or stop the timer' }).innerText()).includes('Alt S'), 'each command shows its shortcut');
await p.locator('dialog.palette').getByRole('button', { name: 'Close' }).click();
check((await p.locator('dialog.palette').count()) === 0, 'the palette has a Close button, since a phone has no Escape key');
await p.keyboard.press('Alt+P');
await p.locator('dialog.palette').waitFor();
await p.getByLabel('Find a command').fill('go settings');
await p.keyboard.press('Enter');
check((await until(async () => p.url().endsWith('#/settings'))) >= 0, 'choosing "Go to Settings" in the palette opens it');

await p.evaluate(() => { location.hash = '#/help/shortcuts'; });
// Rebinding: a conflicting key is refused, a free one works at once and replaces the old one.
await p.getByRole('button', { name: 'Change shortcut of Start or stop the timer' }).click();
await p.getByText('Press the keys').waitFor();
await p.keyboard.press('Alt+T');
check((await p.locator('.st-group p.error').first().innerText()).includes('Go to Time'), 'a shortcut another command uses is refused, naming it');
await p.keyboard.press('s');
check((await p.locator('.st-group p.error').first().innerText()).includes('Ctrl or Alt'), 'a plain key is refused');
await p.keyboard.press('Alt+J');
check((await p.locator('tr.st-shortcut', { hasText: 'Start or stop the timer' }).innerText()).includes('Alt J'), 'the new shortcut is shown');
await p.keyboard.press('Alt+S');
await p.waitForTimeout(400);
check((await running()) === 0, 'the old shortcut no longer works');
await p.keyboard.press('Alt+J');
check((await until(async () => (await running()) === 1)) >= 0, 'the new one does');
await p.keyboard.press('Alt+J');
await until(async () => (await running()) === 0);
await p.getByRole('button', { name: 'Reset shortcut of Start or stop the timer' }).click();
await p.keyboard.press('Alt+S');
check((await until(async () => (await running()) === 1)) >= 0, 'Reset brings the default back');
await p.keyboard.press('Alt+S');
await until(async () => (await running()) === 0);

// Daily note settings, a template, and Today.
await p.locator('.tabs a', { hasText: /^Notes$/ }).click();
await notesMenu(p, 'New…', "Today's note");
check((await until(async () => (await notes()).some((n) => n.path === `Daily/${today.ymd}.md`))) >= 0, 'Today makes Daily/<date>.md');
check((await notes()).find((n) => n.path === `Daily/${today.ymd}.md`).text.includes('dateCreated'), 'without a template it starts with a creation date');
await notesMenu(p, 'New…', "Today's note");
await p.waitForTimeout(400);
check((await notes()).filter((n) => n.path === `Daily/${today.ymd}.md`).length === 1, 'pressing Today again opens the same note');

// Ctrl+Shift+D puts the date into the note being edited.
const mentions = async () => ((await notes()).find((n) => n.path === `Daily/${today.ymd}.md`).text.split(today.ymd).length - 1);
const before = await mentions();
await p.locator('.cm-content').click();
await p.keyboard.press('Control+Shift+D');
check((await until(async () => (await mentions()) === before + 1)) >= 0, 'Ctrl+Shift+D inserts the date at the cursor');

// A template note is used for the next day's note: use another folder so a new note is made.
await p.keyboard.press('Control+O');
await p.getByLabel('Find a note').fill('Templates/Plan');
await p.keyboard.press('Shift+Enter');
check((await until(async () => (await notes()).some((n) => n.path === 'Templates/Plan.md'))) >= 0, 'a template note is made in Templates');
await p.locator('.cm-content').click();
await p.keyboard.insertText('# {{title}} on {{date:DD}}');
await until(async () => (await notes()).find((n) => n.path === 'Templates/Plan.md').text.includes('{{title}}'));
await p.evaluate(() => { location.hash = '#/note-settings'; });
await p.getByLabel('Daily notes folder', { exact: true }).fill('Journal');
await p.getByLabel('Daily notes folder', { exact: true }).blur();
await p.getByLabel('Daily template note', { exact: true }).fill('Templates/Plan');
await p.getByLabel('Daily template note', { exact: true }).blur();
await p.locator('.tabs a', { hasText: /^Notes$/ }).click();
await notesMenu(p, 'New…', "Today's note");
check((await until(async () => (await notes()).some((n) => n.path === `Journal/${today.ymd}.md`))) >= 0, 'the folder setting is used');
check((await notes()).find((n) => n.path === `Journal/${today.ymd}.md`).text.includes(`# ${today.ymd} on ${today.dd}`), 'the template note is filled in: title and date variables');

void pad;
// On a phone the header button is the only way to open the palette; it hides only below 20 rem (F34, F-33h).
{
  const phone = await (await browser.newContext({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true })).newPage();
  watchPage(phone, 'phone');
  await phone.goto(BASE + '?test#/time');
  await phone.waitForFunction(() => window.__app);
  const btn = phone.locator('.palette-btn');
  check(await btn.isVisible(), 'the palette button is shown at 375 px');
  const box = await btn.boundingBox();
  check(!!box && box.width >= 40 && box.height >= 40, `the palette button is a tap target at 375 px (${Math.round(box?.width)}x${Math.round(box?.height)})`);
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 375 px');
  await btn.tap();
  await phone.locator('dialog.palette').waitFor();
  const dlg = await phone.locator('dialog.palette').boundingBox();
  const close = await phone.locator('dialog.palette').getByRole('button', { name: 'Close' }).boundingBox();
  check(!!dlg && dlg.x >= 0 && dlg.x + dlg.width <= 375 && !!close && close.x + close.width <= 375, 'the palette dialog and its Close button fit at 375 px');
  check(await phone.getByLabel('Find a command').isVisible() && (await phone.locator('.palette-list li').count()) >= 5, 'the palette shows the input and the commands at 375 px');
  await phone.locator('dialog.palette').getByRole('button', { name: 'Close' }).tap();
  await phone.setViewportSize({ width: 180, height: 700 });
  check(!(await btn.isVisible()), 'the palette button is hidden at 180 px');
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 180 px');
  await phone.context().close();
}

await finish(browser);
