// End-to-end: quick-add a task from anywhere (#138). Alt+Q opens the modal on Home, Time and Notes;
// tokens fill the chips, chips can be picked and cleared; Enter saves and stays put with a notice,
// Shift+Enter saves and opens, Esc cancels; the Tasks page has a button and the palette an entry.
//
//   npm run e2e quick-add
//
import { BASE, launch, check, watchPage, until, finish } from './lib.mjs';

const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
watchPage(p, 'A', { consoleErrors: true });
await p.goto(BASE + '?test#/home');
await p.waitForFunction(() => window.__app);

const notes = () => p.evaluate(() => Object.entries(window.__app.json('space/personal', 'notes')).filter(([, n]) => !n.deleted).map(([id, n]) => ({ id, path: n.path, text: String(n.text) })));
const byPath = async (path) => (await notes()).find((n) => n.path === path);
const dialog = p.getByRole('dialog', { name: 'New task' });
const line = p.getByRole('textbox', { name: 'Task title' });
const ymd = (offset) => p.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, offset);

// Home: tokens fill the chips, Enter saves, closes, stays on the page and offers Open.
await p.getByRole('link', { name: /^Home$/ }).focus();
await p.keyboard.press('Alt+Q');
await dialog.waitFor();
check(await line.evaluate((el) => el === document.activeElement), 'Alt+Q opens the modal with the cursor in the title line');
for (const name of ['Due', 'Scheduled', 'Project', 'Tags', 'Contexts']) check((await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).count()) === 1, `an empty ${name} chip is shown`);
check((await dialog.getByLabel('Priority', { exact: true }).count()) === 1, 'a Priority chip is shown');
await line.fill('Call Bob tomorrow +Acme @phone #client !high');
const tomorrow = await ymd(1);
check((await dialog.getByRole('button', { name: /^Due/ }).innerText()).includes(tomorrow), 'the word "tomorrow" fills the Due chip');
check((await dialog.getByRole('button', { name: /^Project/ }).innerText()).includes('Acme'), '+Acme fills the Project chip');
check((await dialog.getByRole('button', { name: /^Tags/ }).innerText()).includes('#client'), '#client fills the Tags chip');
check((await dialog.getByRole('button', { name: /^Contexts/ }).innerText()).includes('@phone'), '@phone fills the Contexts chip');
check((await dialog.getByLabel('Priority', { exact: true }).inputValue()) === 'high', '!high fills the Priority chip');
await line.press('Enter');
await dialog.waitFor({ state: 'hidden' });
check(p.url().endsWith('#/home'), 'Enter keeps you on the page you were on');
check(await p.getByRole('link', { name: /^Home$/ }).evaluate((el) => el === document.activeElement), 'focus returns to where it was');
const toastText = p.locator('.toast', { hasText: 'Task added' });
await toastText.waitFor();
const task = await until(async () => (await byPath('Tasks/Call Bob.md')) !== undefined);
check(task >= 0, 'the task note is Tasks/<title>.md');
const text = (await byPath('Tasks/Call Bob.md')).text;
for (const want of ['title: Call Bob', 'status: open', 'priority: high', `due: ${tomorrow}`, '[[Acme]]', 'phone', 'task', 'client']) check(text.includes(want), `front matter has ${want}`);
const id = (await byPath('Tasks/Call Bob.md')).id;
await toastText.getByRole('button', { name: 'Open' }).click();
check((await until(async () => p.url().includes(`#/notes/${id}`))) >= 0, 'the Open link in the notice opens the task');

// Time: Shift+Enter saves and opens; plain text is just the title with default fields.
await p.evaluate(() => { location.hash = '#/time'; });
await p.keyboard.press('Alt+Q');
await dialog.waitFor();
await line.fill('Plain title only');
await line.press('Shift+Enter');
const plain = await until(async () => (await byPath('Tasks/Plain title only.md')) !== undefined);
check(plain >= 0, 'a line with no tokens makes a task titled by it');
const plainNote = await byPath('Tasks/Plain title only.md');
check(!/due:|projects:|contexts:/.test(plainNote.text) && plainNote.text.includes('priority: normal'), 'no tokens, no fields beyond the defaults');
check((await until(async () => p.url().includes(`#/notes/${plainNote.id}`))) >= 0, 'Shift+Enter opens the new task');

// Notes: Esc cancels; an empty title is refused; a name already taken gets a number.
await p.evaluate(() => { location.hash = '#/notes'; });
await p.keyboard.press('Alt+Q');
await dialog.waitFor();
await line.fill('Never saved');
await p.keyboard.press('Escape');
await dialog.waitFor({ state: 'hidden' });
await p.waitForTimeout(300);
check((await byPath('Tasks/Never saved.md')) === undefined, 'Esc cancels without a task');
await p.keyboard.press('Alt+Q');
await dialog.waitFor();
await line.fill('@home');
await line.press('Enter');
check((await dialog.getByRole('alert').innerText()).includes('title'), 'a line with no title is refused with a message');
await line.fill('Call Bob');
await line.press('Enter');
check((await until(async () => (await byPath('Tasks/Call Bob 1.md')) !== undefined)) >= 0, 'a title already used gets a number');

// Chips: pick a date, clear a token-filled chip, add a project and a tag by hand.
await p.keyboard.press('Alt+Q');
await dialog.waitFor();
await line.fill('Chips test #one');
await dialog.getByRole('button', { name: /^Due/ }).click();
await p.getByRole('dialog', { name: 'Pick due' }).getByRole('button', { name: 'Tomorrow' }).click();
check((await dialog.getByRole('button', { name: /^Due/ }).innerText()).includes(tomorrow), 'the Due picker sets the chip');
await dialog.getByRole('button', { name: 'Clear due' }).click();
check((await dialog.getByRole('button', { name: /^Due/ }).innerText()).trim() === 'Due', 'a chip can be cleared');
await dialog.getByRole('button', { name: 'Clear tags' }).click();
check((await line.inputValue()) === 'Chips test', 'clearing a chip also takes its token out of the line');
await dialog.getByRole('button', { name: /^Project/ }).click();
await p.getByLabel('Add project').fill('Big Job');
await p.keyboard.press('Enter');
await p.keyboard.press('Escape');
check((await dialog.getByRole('button', { name: /^Project/ }).innerText()).includes('Big Job'), 'a project picked by hand shows in its chip');
check(await dialog.isVisible(), 'Esc closes a picker first and leaves the modal open');
await dialog.getByLabel('Priority', { exact: true }).selectOption('low');
await dialog.getByRole('button', { name: 'Add task' }).click();
await until(async () => (await byPath('Tasks/Chips test.md')) !== undefined);
const chips = (await byPath('Tasks/Chips test.md')).text;
check(chips.includes('[[Big Job]]') && chips.includes('priority: low') && !chips.includes('due:'), 'chip choices are written, cleared ones are not');

// Touch: the Tasks page has a button, the palette has "New task".
await p.evaluate(() => { location.hash = '#/tasks'; });
await p.getByRole('button', { name: 'New task' }).first().waitFor();
await p.getByRole('button', { name: 'New task', exact: true }).click();
await dialog.waitFor();
check(true, 'the Tasks page has a New task button');
await p.keyboard.press('Escape');
await dialog.waitFor({ state: 'hidden' });
await p.keyboard.press('Alt+P');
await p.getByLabel('Find a command').fill('new task');
check((await p.locator('.palette-list li', { hasText: 'New task' }).innerText()).includes('Alt'), 'the palette lists New task with its shortcut');
await p.keyboard.press('Enter');
await dialog.waitFor();
check(true, 'choosing New task in the palette opens the modal');
await p.keyboard.press('Escape');

// A small screen: the modal fits.
await p.setViewportSize({ width: 375, height: 700 });
await p.keyboard.press('Alt+Q');
await dialog.waitFor();
const box = await dialog.boundingBox();
check(box.x >= 0 && box.x + box.width <= 375, 'the modal fits a 375 px screen');
await p.keyboard.press('Escape');

// QA_SHOTS_DIR=<dir>: screenshots of the modal with placeholder data, for the PR.
if (process.env.QA_SHOTS_DIR) {
  for (const [name, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 375, height: 700 }]]) {
    await p.setViewportSize(size);
    await p.evaluate(() => { location.hash = '#/home'; document.querySelectorAll('.toast button[aria-label=Dismiss]').forEach((b) => b.click()); });
    await p.keyboard.press('Alt+Q');
    await dialog.waitFor();
    await line.fill('Call Bob tomorrow +Acme @phone #client !high');
    await p.screenshot({ path: `${process.env.QA_SHOTS_DIR}/quick-add-${name}.png` });
    await p.keyboard.press('Escape');
  }
}

await finish(browser);
