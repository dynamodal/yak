// End-to-end: Tasks work with Notes off (F-33n, issue #33). Notes off hides the Notes tab, its routes, note search and
// the notes commands; Tasks keep their views and open a task on its own page, `#/tasks/<id>`, in the same editor.
// A `[[link]]` to a plain note is inert there. Notes on again restores everything; Notes on with Tasks off keeps Notes.
//
//   npm run e2e tasks-no-notes
//
import { createRequire } from 'node:module';
import { BASE, launch, check, watchPage, until, finish, newNote } from './lib.mjs';

const SPACE = 'space/personal';
const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
watchPage(p, 'A', { consoleErrors: true });
await p.goto(BASE + '?test&welcome');
await p.getByRole('button', { name: 'Time, notes and tasks' }).click();
await p.locator('.tabs').waitFor();

const tabs = async () => (await p.locator('.tabs > *').allInnerTexts()).map((t) => t.trim()).join();
const hash = () => p.evaluate(() => location.hash);
const go = (h) => p.evaluate((x) => (location.hash = x), h);
const goes = async (from, to, m) => {
  await go(from);
  await p.waitForFunction((t) => location.hash === t, to, { timeout: 5000 }).catch(() => {});
  check((await hash()) === to, `${m} (${await hash()})`);
};
const notes = () => p.evaluate((id) => window.__app.json(id, 'notes'), SPACE);
const byPath = async (path) => Object.entries(await notes()).find(([, n]) => n.path === path && !n.deleted);
const hide = (list) => p.evaluate((l) => localStorage.setItem('hidden_modules', JSON.stringify(l)), list);
const reload = async () => {
  await p.reload();
  await p.locator('.tabs').waitFor();
};

// ---- Data: a plain note, two tasks, and a task body linking to both
await go('#/notes');
await newNote(p);
await p.locator('input[aria-label="Note title"]').waitFor();
await p.keyboard.type('Zebra plan');
await p.keyboard.press('Enter');
await until(async () => (await byPath('Zebra plan.md')) !== undefined);
await go('#/tasks');
for (const t of ['Ship it', 'Second job']) {
  await p.locator('input[aria-label="New task"]').fill(t);
  await p.getByRole('button', { name: 'Add task' }).click();
  await until(async () => Object.values(await notes()).some((n) => n.path.endsWith(`${t}.md`) && !n.deleted));
}
const task = await p.evaluate((id) => Object.entries(window.__app.json(id, 'notes')).find(([, n]) => n.path.endsWith('Ship it.md')), SPACE);
const second = await p.evaluate((id) => Object.entries(window.__app.json(id, 'notes')).find(([, n]) => n.path.endsWith('Second job.md')), SPACE);
const [taskId] = task;
const [secondId] = second;

// Both on: a task opens in Notes, as always.
await p.getByRole('link', { name: 'Ship it' }).click();
await p.waitForFunction((id) => location.hash === `#/notes/${id}`, taskId);
check(true, 'Notes on: a task opens at #/notes/<id>');
await p.locator('.cm-content').click();
await p.keyboard.press('Control+End');
await p.keyboard.type('See [[Zebra plan]] and [[Second job');
await until(async () => ((await byPath(task[1].path))?.[1].text ?? '').includes('[[Zebra plan]]'));
const typed = (await byPath(task[1].path))[1].text;
// Auto-closed brackets may have added the closing pair; make the body exact.
if (!typed.includes('[[Second job]]')) await p.keyboard.type(']]');
await until(async () => ((await byPath(task[1].path))?.[1].text ?? '').includes('[[Second job]]'));
const beforeText = (await byPath(task[1].path))[1].text;
check(/\[\[Zebra plan\]\]/.test(beforeText) && /\[\[Second job\]\]/.test(beforeText), `the task body links a plain note and a task (${JSON.stringify(beforeText.slice(-50))})`);
await go('#/tasks');
await p.getByRole('link', { name: 'Ship it' }).waitFor();
check((await p.getByRole('link', { name: 'Ship it' }).getAttribute('href')) === `#/notes/${taskId}`, 'Notes on: task links go to Notes');
await goes(`#/tasks/${taskId}`, `#/notes/${taskId}`, 'Both on: #/tasks/<id> goes to the note');

// ---- Notes off, Tasks on
await hide(['notes']);
await reload();
check((await tabs()) === 'Home,Time,Tasks,Settings', `Notes off: no Notes tab, Tasks stays (${await tabs()})`);
await goes('#/notes', '#/home', '#/notes lands on the first tab');
await goes(`#/notes/${taskId}`, `#/tasks/${taskId}`, '#/notes/<task> opens the task under Tasks');
await p.locator('.cm-content').waitFor();
check(await p.locator('input[aria-label="Task title"]').isVisible(), 'the task page has its title and editor');
await goes(`#/notes/${(await byPath('Zebra plan.md'))[0]}`, '#/home', '#/notes/<plain note> lands on the first tab');

// The palette and search.
await p.keyboard.press('Alt+P');
await p.locator('dialog.palette').waitFor();
const palette = await p.locator('dialog.palette').innerText();
check(!/Find a note|Open today's note|Insert today's date|Go to Notes/.test(palette), 'no notes commands in the palette');
check(/Go to Tasks/.test(palette), 'Go to Tasks is there');
await p.locator('dialog.palette').getByRole('button', { name: 'Close' }).click();
await p.keyboard.press('Control+Shift+F');
await p.getByLabel('Search query').fill('zebra');
await p.waitForTimeout(500);
// The task body mentions "Zebra plan", so the task matches; the plain note itself must not.
await p.locator('dialog.search-dialog .search-group', { hasText: 'Tasks' }).waitFor();
check((await p.locator('dialog.search-dialog .search-group', { hasText: 'Notes' }).count()) === 0, 'search does not find the plain note');
await p.getByLabel('Search query').fill('ship it');
await p.locator('dialog.search-dialog', { hasText: 'Ship it' }).waitFor();
check(true, 'search finds the task');
await p.keyboard.press('Enter');
await p.waitForFunction((id) => location.hash === `#/tasks/${id}`, taskId, { timeout: 5000 }).catch(() => {});
check((await hash()) === `#/tasks/${taskId}`, `a search hit opens the task at its own route (${await hash()})`);

// Task views and links.
await go('#/tasks/table');
check((await p.getByLabel('Rows', { exact: true }).count()) === 0, 'the table lists tasks only (no "All notes" source)');
check((await p.getByRole('link', { name: 'Ship it' }).getAttribute('href')) === `#/tasks/${taskId}`, 'task links go to the task route');
await p.getByRole('link', { name: 'Ship it' }).click();
await p.waitForFunction((id) => location.hash === `#/tasks/${id}`, taskId);
await p.locator('.cm-content').waitFor();
const inert = p.locator('.cm-wikilink-inert');
await inert.first().waitFor();
check((await inert.count()) === 1 && (await inert.first().getAttribute('title')) === 'Turn on Notes to open this note', 'a link to a plain note is inert and says why');
await inert.first().click();
check((await hash()) === `#/tasks/${taskId}`, 'clicking it opens nothing');
await p.locator('.cm-wikilink:not(.cm-wikilink-inert)').first().click({ modifiers: ['Control'] });
await p.waitForFunction((id) => location.hash === `#/tasks/${id}`, secondId, { timeout: 5000 }).catch(() => {});
check((await hash()) === `#/tasks/${secondId}`, 'a link to another task opens it under Tasks');
await go(`#/tasks/${taskId}`);
await p.locator('.cm-content').waitFor();

// Edit the text and a front matter field; reload; it persists.
await p.locator('.cm-content').click();
await p.keyboard.press('Control+End');
await p.keyboard.type(' Done soon.');
await p.locator('select[aria-label="Property status"]').selectOption('in-progress');
await until(async () => {
  const t = (await byPath(task[1].path))?.[1].text ?? '';
  return t.includes('Done soon.') && /status: in-progress/.test(t);
});
await reload();
await p.locator('.cm-content').waitFor();
const afterText = (await byPath(task[1].path))[1].text;
check(afterText.includes('Done soon.') && /status: in-progress/.test(afterText) && (await hash()) === `#/tasks/${taskId}`, 'text and status persist after a reload');
check(afterText.startsWith('---\n') && /tags:[\s\S]*task/.test(afterText), 'the file keeps its front matter and the task tag');

// ---- Notes back on: the same task opens in Notes
await hide([]);
await reload();
check((await tabs()) === 'Home,Time,Notes,Tasks,Settings', 'Notes on again: all tabs');
await goes(`#/tasks/${taskId}`, `#/notes/${taskId}`, 'the task opens in Notes again');
await p.locator('.cm-content').waitFor();
check((await byPath(task[1].path))[1].text === afterText, 'the task file is the same in both modes');

// ---- Notes on, Tasks off
await hide(['tasks']);
await reload();
check((await tabs()) === 'Home,Time,Notes,Settings', `Tasks off: Notes stays (${await tabs()})`);
await go(`#/notes/${taskId}`);
await p.locator('.cm-content').waitFor();
check(await p.locator('.props').count() > 0 && (await p.locator('select[aria-label="Property status"]').inputValue()) === 'in-progress', 'a task still opens in Notes with its properties');
await goes('#/tasks', '#/home', '#/tasks lands on the first tab');
await p.keyboard.press('Alt+P');
await p.locator('dialog.palette').waitFor();
const pal2 = await p.locator('dialog.palette').innerText();
check(/Find a note/.test(pal2) && !/Go to Tasks/.test(pal2), 'Notes commands stay, Go to Tasks goes');
await p.locator('dialog.palette').getByRole('button', { name: 'Close' }).click();

// ---- axe on the task page with Notes off, in both themes and two widths
const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 375], ['dark', 375]]) {
  const q = await (await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true })).newPage();
  watchPage(q, `axe ${scheme} ${width}`, { consoleErrors: true });
  await q.goto(BASE + '?test&welcome');
  await q.getByRole('button', { name: 'Time, notes and tasks' }).click();
  await q.locator('.tabs').waitFor();
  await q.evaluate(() => (location.hash = '#/tasks'));
  await q.locator('input[aria-label="New task"]').fill('Axe check @home');
  await q.getByRole('button', { name: 'Add task' }).click();
  await q.getByRole('link', { name: 'Axe check' }).waitFor();
  await q.evaluate(() => localStorage.setItem('hidden_modules', '["notes"]'));
  await q.reload();
  await q.getByRole('link', { name: 'Axe check' }).click();
  await q.locator('.cm-content').waitFor();
  await q.waitForTimeout(400);
  await q.addScriptTag({ path: axeSource });
  // The header's own buttons (timer pill label, palette button) are the header suite's to check, as in a11y.mjs.
  const violations = (await q.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }))).violations
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !(v.id === 'label-content-name-mismatch' && /palette-btn|tp-label/.test(n.html))) }))
    .filter((v) => v.nodes.length);
  for (const v of violations) check(false, `${scheme} ${width}: ${v.id} ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 200)).join(' | ')}`);
  check(violations.length === 0, `task page with Notes off, ${scheme} ${width}px: no axe violations`);
  await q.context().close();
}

await finish(browser);
