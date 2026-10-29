// End-to-end: notes and tasks against dist/ served with the real headers (so CSP violations fail
// the run). Two isolated profiles pair over a local mock mailbox and edit the same note at once.
//
//   npm run e2e notes
//
import { BASE, launch, startMock, fail, check, watchPage, until, finish, keepAllSpaces, startSelecting, openFilters, newNote, notesMenu, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const SPACE = 'space/personal';

const mock = await startMock();
const browser = await launch();
const mk = async (n) => {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/notes');
  return page;
};
const notes = (p) => p.evaluate(([id]) => window.__app.json(id, 'notes'), [SPACE]);
const byPath = async (p, path) => Object.entries(await notes(p)).find(([, n]) => n.path === path && !n.deleted);
const textOf = async (p, path) => (await byPath(p, path))?.[1].text ?? null;
/** A note's text without its leading front matter. */
const bodyOf = (text) => (text ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
const CREATED = /^---\ndateCreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n/;

try {
  const a = await mk('A');
  const b = await mk('B');

  // Create and edit a note.
  await newNote(a);
  const titleInput = a.locator('input[aria-label="Note title"]');
  await titleInput.waitFor();
  await a.keyboard.type('Acme');
  await a.keyboard.press('Enter');
  check((await until(async () => (await byPath(a, 'Acme.md')) !== undefined)) >= 0, 'new note titled Acme');
  check(CREATED.test(await textOf(a, 'Acme.md')), 'a new note starts with a dateCreated property');
  check((await a.locator('button[aria-label^="Property dateCreated"]').count()) === 1 && !/T\d\d:\d\d:\d\d/.test(await a.locator('button[aria-label^="Property dateCreated"]').innerText()), 'Properties shows the created date formatted, not as raw ISO');
  // "Move to…" from the note's menu, into a new folder.
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: 'Move to…' }).click();
  await a.locator('dialog input[aria-label="Folder"]').fill('Projects');
  await a.keyboard.press('Enter');
  check((await until(async () => (await byPath(a, 'Projects/Acme.md')) !== undefined)) >= 0, 'Move to… put it in a new folder Projects');
  check((await a.locator('.note-crumbs').innerText()).includes('Projects'), 'breadcrumbs show the folder');
  // The editor sits on the page without a form-style border; clicking it still focuses the text.
  // Focus may still be leaving the editor (the title's Enter put it there, then the dialog took it),
  // and box-shadow and background fade over 0.12 s: wait for the resting style, not a mid-fade value (#30).
  const restingSurface = () =>
    a.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.note-editor'));
      return s.borderTopWidth === '0px' && s.boxShadow === 'none';
    });
  check((await until(restingSurface)) >= 0, 'the note editor has no border');
  const lit = () => a.evaluate(() => getComputedStyle(document.querySelector('.note-editor')).boxShadow);
  await a.locator('.cm-content').click();
  check((await lit()) !== 'none', 'the note editor shows an accent line while it has focus');
  await a.locator('.note-title').click();
  check((await until(async () => (await lit()) === 'none')) >= 0, 'the focus line goes away when the editor loses focus');
  await a.locator('.cm-content').click();
  await a.keyboard.type('Kickoff with [[Beta]] about #invoices.');
  check((await until(async () => bodyOf(await textOf(a, 'Projects/Acme.md')) === 'Kickoff with [[Beta]] about #invoices.')) >= 0, 'typed text is stored in the Y.Text');
  check(
    await a.evaluate(() => {
      const root = document.querySelector('.note-editor')?.shadowRoot;
      return !!root && root.adoptedStyleSheets.length > 0 && getComputedStyle(root.querySelector('.cm-editor')).display === 'flex' && document.querySelectorAll('style').length === 0;
    }),
    'CodeMirror styles applied through constructed style sheets in a shadow root',
  );
  check((await a.locator('.cm-wikilink').count()) === 1 && (await a.locator('.cm-hashtag').count()) === 1, 'wikilink and tag are decorated');

  // Properties table writes front matter; the YAML itself stays hidden in the editor.
  await a.getByRole('button', { name: 'Add property' }).click();
  await a.locator('input[aria-label="New property name"]').fill('status');
  await a.keyboard.press('Enter');
  const statusSelect = a.locator('select[aria-label="Property status"]');
  check((await statusSelect.locator('option').allInnerTexts()).join() === 'Not set,open,in-progress,done', 'status offers the usual values');
  await statusSelect.selectOption('in-progress');
  check((await until(async () => /^---\ndateCreated: [^\n]+\nstatus: in-progress\n---\nKickoff/.test((await textOf(a, 'Projects/Acme.md')) ?? ''))) >= 0, 'property added as front matter');
  // Dates and times use native pickers and keep TaskNotes formats.
  await a.getByRole('button', { name: 'Add property' }).click();
  await a.locator('input[aria-label="New property name"]').fill('due');
  await a.keyboard.press('Enter');
  const dueInput = a.locator('input[aria-label="Property due"]');
  check((await dueInput.getAttribute('type')) === 'date', 'an empty due property gets a date picker');
  await dueInput.fill('2026-10-20');
  check((await until(async () => (await textOf(a, 'Projects/Acme.md')).includes('due: 2026-10-20\n'))) >= 0, 'a picked date is written as YYYY-MM-DD');
  await a.locator('input[aria-label="Time of due"]').fill('14:30');
  check((await until(async () => /due: '?2026-10-20T14:30'?\n/.test(await textOf(a, 'Projects/Acme.md')))) >= 0, 'a picked time makes it YYYY-MM-DDTHH:mm');
  await a.getByRole('button', { name: 'Add property' }).click();
  await a.locator('input[aria-label="New property name"]').fill('priority');
  await a.keyboard.press('Enter');
  await a.locator('select[aria-label="Property priority"]').selectOption('high');
  check((await until(async () => (await textOf(a, 'Projects/Acme.md')).includes('priority: high\n'))) >= 0, 'priority is chosen from the usual values');
  await a.locator('.prop-row', { has: a.getByLabel('Property due', { exact: true }) }).hover();
  await a.getByLabel('Remove property due').click();
  await a.locator('.prop-row', { has: a.getByLabel('Property priority', { exact: true }) }).hover();
  await a.getByLabel('Remove property priority').click();
  check((await until(async () => !/due:|priority:/.test(await textOf(a, 'Projects/Acme.md')))) >= 0, 'the extra properties are removed again');
  check((await until(async () => !(await a.locator('.cm-content').innerText()).includes('status:'))) >= 0, 'live mode: the YAML is not shown in the text (Properties shows it)');
  // The tag selector is always there; the tags line reaches the text only once a tag is picked.
  const tagInput = a.locator('input[aria-label="Add to tags"]');
  check((await tagInput.count()) === 1, 'the tag selector is shown on a note without tags');
  check(!(await textOf(a, 'Projects/Acme.md')).includes('tags:'), 'no tags line is written until a tag is picked');
  check((await a.locator('datalist#tags-options option[value="invoices"]').count()) === 1, 'the tag selector offers tags already used in the space');
  await a.locator('select[aria-label="Choose tags"]').selectOption({ label: '#invoices' });
  check((await until(async () => (await a.locator('.prop-chip', { hasText: '#invoices' }).count()) === 1)) >= 0, 'a known tag can be chosen from a list');
  await a.getByRole('button', { name: 'Remove #invoices from tags' }).click();
  await tagInput.fill('client');
  await tagInput.press('Enter');
  check((await until(async () => (await a.locator('.prop-chip', { hasText: '#client' }).count()) === 1)) >= 0, 'a picked tag shows as a chip');
  check((await until(async () => /\ntags:[\s\S]*\bclient\b[\s\S]*\n---\n/.test((await textOf(a, 'Projects/Acme.md')) ?? ''))) >= 0, 'the first tag writes a tags list');
  await a.getByRole('button', { name: 'Remove #client from tags' }).click();
  check((await until(async () => !(await textOf(a, 'Projects/Acme.md')).includes('tags:'))) >= 0, 'removing the last tag removes the tags line again');

  // Tags from the Projects page: hidden tags leave the note's tag picker, rename rewrites notes, remove has one Undo.
  await tagInput.fill('wrangle');
  await tagInput.press('Enter');
  await a.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.type(' #wrangle');
  await until(async () => (await textOf(a, 'Projects/Acme.md')).includes(' #wrangle'));
  const noteHash = await a.evaluate(() => location.hash);
  await a.evaluate(() => { location.hash = '#/organize'; });
  const tagRow = (n) => a.locator('.tag-row', { has: a.locator('.tag-name', { hasText: new RegExp(`^${n}$`) }) });
  const tagAct = async (pg, name, item) => {
    await pg.getByRole('button', { name: `More actions for tag ${name}` }).click();
    await pg.getByRole('menuitem', { name: item, exact: true }).click();
  };
  await tagRow('wrangle').waitFor();
  check((await tagRow('wrangle').innerText()).includes('1 note'), 'the tag list counts notes that use a tag');
  await tagAct(a, 'wrangle', 'Hide from pickers');
  await a.evaluate((h) => { location.hash = h; }, noteHash);
  await a.locator('input[aria-label="Add to tags"]').waitFor();
  check((await a.locator('datalist#tags-options option[value="wrangle"]').count()) === 0, 'a hidden tag is not offered by the note tag picker');
  check((await a.locator('.prop-chip', { hasText: '#wrangle' }).count()) === 1, 'but it still shows on the note');
  await a.evaluate(() => { location.hash = '#/organize'; });
  await tagAct(a, 'wrangle', 'Rename or merge');
  await a.getByLabel('New name for wrangle').fill('sorted');
  await a.getByLabel('New name for wrangle').press('Enter');
  check((await until(async () => { const t = await textOf(a, 'Projects/Acme.md'); return t.includes(' #sorted') && /tags:[\s\S]*sorted/.test(t) && !t.includes('wrangle'); })) >= 0, 'rename rewrites the front matter and the inline tag');
  await tagAct(a, 'sorted', 'Remove from all items');
  await a.getByRole('button', { name: 'Remove from all items', exact: true }).last().click();
  check((await until(async () => !(await textOf(a, 'Projects/Acme.md')).includes('sorted'))) >= 0, 'remove takes the tag out of the note');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await textOf(a, 'Projects/Acme.md')).includes(' #sorted'))) >= 0, 'one Undo puts it back');
  await a.evaluate((h) => { location.hash = h; }, noteHash);
  await a.locator('.cm-content').waitFor();
  await a.getByRole('button', { name: 'Remove #sorted from tags' }).click();

  // Live preview: headings and task boxes render; a click on the box toggles the text.
  await a.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.type('\n\n## Plan\n- [ ] call **Dana**');
  await a.keyboard.press('Control+Home');
  check((await until(async () => (await a.locator('.cm-h2').count()) === 1 && (await a.locator('.cm-task').count()) === 1)) >= 0, 'live mode renders the heading and a task box');
  check((await until(async () => !(await a.locator('.cm-content').innerText()).includes('**'))) >= 0, 'live mode hides ** away from the cursor');
  await a.locator('.cm-task').click();
  check((await until(async () => (await textOf(a, 'Projects/Acme.md'))?.includes('- [x] call **Dana**'))) >= 0, 'clicking the task box ticks it in the text');
  // Source mode shows everything as stored.
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: /^Source mode/ }).click();
  check((await until(async () => (await a.locator('.cm-content').innerText()).includes('status: in-progress') && (await a.locator('.props').count()) === 0)) >= 0, 'Source mode shows the YAML and no Properties table');
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: /^Source mode/ }).click();
  check((await until(async () => (await a.locator('.props').count()) === 1)) >= 0, 'back to live mode with Properties');

  // Keyboard shortcuts: bold, cycle the line, tick, several cursors, link, heading.
  const acmeText = () => textOf(a, 'Projects/Acme.md');
  await a.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  // Enter continues the task list above: a new task line. Ctrl+L cycles it to done, then to plain text.
  await a.keyboard.press('Enter');
  await a.keyboard.type('milk and eggs');
  await a.keyboard.press('Control+l');
  await a.keyboard.press('Control+l');
  check((await until(async () => (await acmeText())?.endsWith('- [x] call **Dana**\nmilk and eggs'))) >= 0, 'Ctrl+L cycles a task to done, then to plain text');
  await a.keyboard.press('Shift+Home');
  await a.keyboard.press('Control+b');
  check((await until(async () => (await acmeText())?.endsWith('\n**milk and eggs**'))) >= 0, 'Ctrl+B bolds the selection');
  await a.keyboard.press('Control+l');
  await a.keyboard.press('Control+.');
  check((await until(async () => (await acmeText())?.endsWith('\n- [ ] **milk and eggs**'))) >= 0, 'Ctrl+L then Ctrl+. turn the line into a bullet, then a task');
  await a.keyboard.press('Control+Enter');
  check((await until(async () => (await acmeText())?.endsWith('\n- [x] **milk and eggs**'))) >= 0, 'Ctrl+Enter ticks the task');
  await a.keyboard.press('End');
  await a.keyboard.press('Enter');
  await a.keyboard.press('Enter');
  await a.keyboard.type('tea tea');
  await a.keyboard.press('Home');
  await a.keyboard.press('Shift+Control+ArrowRight');
  await a.keyboard.press('Control+d');
  await a.keyboard.type('cake');
  check((await until(async () => (await acmeText())?.endsWith('\ncake cake'))) >= 0, 'Ctrl+D adds the next occurrence; typing changes both');
  await a.keyboard.press('Escape');
  await a.keyboard.press('End');
  await a.keyboard.press('Shift+Home');
  await a.keyboard.press('Control+k');
  await a.keyboard.press('Control+Alt+2');
  check((await until(async () => (await acmeText())?.endsWith('\n## [[cake cake]]'))) >= 0, 'Ctrl+K makes a link and Ctrl+Alt+2 a heading');
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  check((await until(() => a.locator('dialog.shortcuts-dialog kbd', { hasText: 'Ctrl+B' }).isVisible())) >= 0, 'the shortcuts list opens from the note menu');
  await a.locator('dialog.shortcuts-dialog').getByRole('button', { name: 'Close' }).click();
  await a.keyboard.press('Control+O');
  await a.locator('dialog.switcher').waitFor();
  await a.locator('dialog.switcher').getByRole('button', { name: 'Close' }).click();
  check((await a.locator('dialog.switcher').count()) === 0, 'the note switcher closes with its Close button');

  // Follow the wikilink: creates Beta, which shows Acme as a linked mention.
  await a.locator('.note-links summary', { hasText: 'Outgoing links' }).click();
  await a.getByRole('button', { name: 'Beta' }).click();
  check((await until(async () => (await byPath(a, 'Beta.md')) !== undefined)) >= 0, 'unresolved wikilink created Beta.md');
  check((await until(async () => (await a.locator('.note-links details', { hasText: 'Linked mentions' }).locator('a', { hasText: 'Acme' }).count()) === 1)) >= 0, 'Beta lists Acme as a linked mention');

  // Collapse all becomes Expand all once every folder is collapsed.
  const tb = a.getByRole('toolbar', { name: 'Notes' });
  await tb.getByRole('button', { name: 'Collapse all folders' }).click();
  check(await tb.getByRole('button', { name: 'Expand all folders' }).isVisible(), 'Collapse all turns into Expand all when every folder is collapsed');
  await tb.getByRole('button', { name: 'Expand all folders' }).click();
  check(await tb.getByRole('button', { name: 'Collapse all folders' }).isVisible(), 'and back after expanding');
  check((await a.locator('.notes-page > .page-header').count()) === 0, 'the Notes page has no header row');
  check((await a.getByRole('button', { name: 'Notes menu' }).count()) === 0 && (await a.getByRole('button', { name: 'Page actions' }).count()) === 0, 'no "…" menu in the sidebar or the page');
  check((await tb.getByRole('button', { name: 'Select', exact: true }).count()) === 1, 'Select is a button in the sidebar toolbar');
  check(((await tb.boundingBox())?.height ?? 99) < 100, 'search, then space, New…, collapse and Select take two rows');

  const rows = await a.evaluate(() => {
    const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    return { title: y('.note-title'), more: y('.note-more'), inRow: !!document.querySelector('.note-title-row .note-more') };
  });
  check(rows.inRow && Math.abs(rows.title - rows.more) < 40, 'the note menu sits on the title row, not above it');
  check((await a.getByRole('button', { name: 'Version history', exact: true }).isVisible()) && (await a.getByRole('button', { name: 'Move to…', exact: true }).isVisible()), 'Version history and Move are icon buttons on a wide screen');

  // Drag Beta onto the Projects folder, then back to the top level with the row menu.
  await a.locator('a.tree-note', { hasText: 'Beta' }).dragTo(a.locator('button.tree-folder', { hasText: 'Projects' }));
  check((await until(async () => (await byPath(a, 'Projects/Beta.md')) !== undefined)) >= 0, 'drag and drop moved Beta into Projects');
  await a.locator('.note-row', { hasText: 'Beta' }).hover();
  await a.getByRole('button', { name: 'More actions for Beta' }).click();
  await a.getByRole('menuitem', { name: 'Move to…' }).click();
  await a.locator('dialog li', { hasText: 'Top level' }).click();
  check((await until(async () => (await byPath(a, 'Beta.md')) !== undefined)) >= 0, 'Move to… Top level moved it back');

  // New folder: it asks for the folder's name, makes an empty folder (no note), and keeps it.
  // The toolbar button, not a folder that happens to be called "New folder".
  const newFolderButton = { click: () => notesMenu(a, 'New…', 'New folder') };
  const liveNotes = async (p) => Object.values(await notes(p)).filter((n) => !n.deleted);
  const notesBefore = (await liveNotes(a)).length;
  await newFolderButton.click();
  const folderName = a.locator('input[aria-label="New folder name"]');
  await folderName.waitFor();
  check((await folderName.inputValue()) === 'New folder' && (await folderName.evaluate((el) => document.activeElement === el)), 'New folder opens a focused name box suggesting "New folder"');
  await a.keyboard.type('Ideas');
  await a.keyboard.press('Enter');
  check((await until(async () => (await a.locator('button.tree-folder', { hasText: 'Ideas' }).count()) === 1)) >= 0, 'the named folder appears in the tree');
  check((await liveNotes(a)).length === notesBefore && !(await liveNotes(a)).some((n) => n.path.startsWith('Ideas/')), 'no note was created in it');
  check((await a.locator('input[aria-label="New folder name"]').count()) === 0, 'the name box closed');
  // Escape cancels; a second box suggests a free name; accepting the suggestion keeps it.
  await newFolderButton.click();
  await a.locator('input[aria-label="New folder name"]').waitFor();
  await a.keyboard.press('Escape');
  check((await until(async () => (await a.locator('input[aria-label="New folder name"]').count()) === 0)) >= 0 && (await a.locator('button.tree-folder').count()) === 2, 'Escape cancels without making a folder');
  await newFolderButton.click();
  await a.locator('input[aria-label="New folder name"]').waitFor();
  await a.keyboard.press('Enter');
  check((await until(async () => (await a.locator('button.tree-folder', { hasText: 'New folder' }).count()) === 1)) >= 0, 'Enter accepts the suggested name');
  // A new folder inside a folder, from its menu; a duplicate name is refused.
  await a.locator('.folder-row', { hasText: 'Ideas' }).hover();
  await a.getByRole('button', { name: 'More actions for folder Ideas' }).click();
  await a.getByRole('menuitem', { name: 'New folder here' }).click();
  await a.locator('input[aria-label="New folder name"]').waitFor();
  await a.keyboard.type('Later');
  await a.keyboard.press('Enter');
  check((await until(async () => (await a.locator('button.tree-folder[title="Ideas/Later"]').count()) === 1)) >= 0, 'New folder here makes a subfolder');
  await newFolderButton.click();
  await a.locator('input[aria-label="New folder name"]').waitFor();
  await a.keyboard.press('Control+a');
  await a.keyboard.type('ideas');
  await a.keyboard.press('Enter');
  check((await until(async () => (await a.locator('button.tree-folder', { hasText: /^ideas$/i }).count()) === 1)) >= 0, 'a name already used (any case) is refused');
  // The folders survive a reload and are targets for moves.
  await a.reload();
  await a.locator('button.tree-folder', { hasText: 'Ideas' }).waitFor();
  check((await a.locator('button.tree-folder[title="Ideas/Later"]').count()) === 1, 'empty folders survive a reload');
  await a.locator('a.tree-note', { hasText: 'Beta' }).dragTo(a.locator('button.tree-folder[title="Ideas/Later"]'));
  check((await until(async () => (await byPath(a, 'Ideas/Later/Beta.md')) !== undefined)) >= 0, 'a note can be dropped into an empty folder');
  // Renaming moves an empty folder with the folders under it.
  await a.locator('.folder-row', { hasText: 'New folder' }).hover();
  await a.getByRole('button', { name: 'More actions for folder New folder' }).click();
  await a.getByRole('menuitem', { name: 'Delete folder' }).click();
  check((await until(async () => (await a.locator('button.tree-folder', { hasText: 'New folder' }).count()) === 0)) >= 0, 'an empty folder can be deleted');
  await a.getByRole('button', { name: 'Undo' }).click();
  check((await until(async () => (await a.locator('button.tree-folder', { hasText: 'New folder' }).count()) === 1)) >= 0, 'Undo brings the deleted folder back');
  check(
    (await a.locator('.folder-row', { hasText: 'Ideas' }).first().evaluate((row) => !row.querySelector('button[aria-label="More actions for folder Ideas"]'))) === false,
    'a folder with notes in it is shown with its menu',
  );
  await a.locator('.folder-row', { hasText: 'Ideas' }).first().hover();
  await a.getByRole('button', { name: 'More actions for folder Ideas', exact: true }).click();
  await a.getByRole('menuitem', { name: 'New note here' }).waitFor();
  check((await a.getByRole('menuitem', { name: 'Delete folder' }).count()) === 0, 'a folder with something in it cannot be deleted');
  await a.waitForTimeout(150); // the menu's Escape listener is registered a frame after it opens
  await a.keyboard.press('Escape');
  check((await until(async () => (await a.getByRole('menuitem').count()) === 0)) >= 0, 'Escape closes the folder menu');
  // Put Beta back at the top level for the steps below.
  await a.locator('.note-row', { hasText: 'Beta' }).hover();
  await a.getByRole('button', { name: 'More actions for Beta' }).click();
  await a.getByRole('menuitem', { name: 'Move to…' }).click();
  await a.locator('dialog li', { hasText: 'Top level' }).click();
  check((await until(async () => (await byPath(a, 'Beta.md')) !== undefined)) >= 0, 'Beta is back at the top level');
  // Renaming a note fixes the links that point at it, with an Undo.
  await a.locator('.note-row', { hasText: 'Beta' }).click();
  const title = a.locator('input[aria-label="Note title"]');
  await title.fill('Beta Co');
  await title.press('Enter');
  check((await until(async () => ((await acmeText()) ?? '').includes('[[Beta Co]]'))) >= 0, 'renaming a note rewrites the links to it');
  check((await a.locator('.toast', { hasText: 'Updated 1 link in 1 note' }).count()) === 1, 'and says how many links it updated');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => ((await acmeText()) ?? '').includes('[[Beta]]') && (await byPath(a, 'Beta.md')) !== undefined)) >= 0, 'Undo puts the name and the links back');
  // Delete with undo.
  await a.locator('.note-row', { hasText: 'Beta' }).hover();
  await a.getByRole('button', { name: 'More actions for Beta' }).click();
  await a.getByRole('menuitem', { name: 'Delete' }).click();
  check((await until(async () => (await byPath(a, 'Beta.md')) === undefined)) >= 0, 'Delete removes the note');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await byPath(a, 'Beta.md')) !== undefined)) >= 0, 'Undo brings it back');

  const betaId = (await byPath(a, 'Beta.md'))[0];
  await a.goto(BASE + `?test#/notes/${(await byPath(a, 'Projects/Acme.md'))[0]}`);
  await a.locator('.cm-wikilink', { hasText: 'Beta' }).click({ modifiers: ['Control'] });
  check((await until(async () => (await a.evaluate(() => location.hash)).includes(betaId))) >= 0, 'Ctrl-click on a wikilink in the editor opens it');

  // Search and quick switcher.
  await a.locator('input[aria-label="Search notes"]').fill('kickoff');
  check((await a.locator('.search-hits a', { hasText: 'Acme' }).count()) === 1, 'full-text search finds Acme');
  await a.locator('input[aria-label="Search notes"]').fill('');
  await a.keyboard.press('Control+o');
  await a.locator('input[aria-label="Find a note"]').fill('acme');
  await a.keyboard.press('Enter');
  let acmeId = (await byPath(a, 'Projects/Acme.md'))[0];
  check((await until(async () => (await a.evaluate(() => location.hash)).includes(acmeId))) >= 0, 'Ctrl+O quick switcher opens Acme');

  // The search field also finds notes by name: name matches first, Enter opens the first.
  const searchBox = a.locator('input[aria-label="Search notes"]');
  await searchBox.fill('acme');
  check((await a.locator('.search-hits a').first().locator('.hit-title').innerText()) === 'Acme', 'typing a note\'s name lists it first');
  await searchBox.fill('beta');
  await searchBox.press('Enter');
  check((await until(async () => (await a.evaluate(() => location.hash)).includes(betaId))) >= 0, 'Enter in the search field opens the first match');
  await searchBox.fill('');
  await a.goto(BASE + '?test#/notes/' + acmeId);

  // Pair the two profiles.
  for (const p of [a, b]) {
    await p.goto(BASE + '?test#/devices');
    await (await openJoin(p)).locator('summary', { hasText: /^Connection server$/ }).click();
    await p.locator('input[aria-label="Connection server"]').fill(mock.url);
  }
  await startSyncing(a);
  await joinByInvite(a, b);
  const st = (p) => p.evaluate(() => window.__app.state());
  check((await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000)) >= 0, 'profiles paired and connected');

  // Both open the note and edit it at the same time: A types in the body, B types and changes a property.
  await a.goto(BASE + `?test#/notes/${acmeId}`);
  await b.goto(BASE + '?test#/notes');
  check((await until(async () => (await b.locator('a.tree-note', { hasText: 'Acme' }).count()) === 1, 10000)) >= 0, 'B sees the note from A in its tree');
  await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
  await b.locator('a.tree-note', { hasText: 'Acme' }).click();
  await a.locator('.cm-content').click();
  await b.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  await b.keyboard.press('Control+End');
  await Promise.all([
    a.keyboard.type(' Typed on A.', { delay: 15 }),
    (async () => {
      await b.keyboard.type(' Typed on B.', { delay: 15 });
      await b.locator('select[aria-label="Property status"]').selectOption('done');
    })(),
  ]);
  const converged = await until(async () => {
    const [x, y] = await Promise.all([textOf(a, 'Projects/Acme.md'), textOf(b, 'Projects/Acme.md')]);
    return x === y && x.includes('Typed on A.') && x.includes('Typed on B.') && /^---\ndateCreated: [^\n]+\nstatus: done\n---\n/.test(x);
  }, 10000);
  check(converged >= 0, `concurrent edits converged in ${converged} ms`);
  check(
    (await until(async () => (await a.locator('.cm-content').innerText()).includes('Typed on B.') && (await a.locator('select[aria-label="Property status"]').inputValue()) === 'done')) >= 0,
    'A shows the merged text and the property from B',
  );

  // Tasks: quick add, list, kanban drag and drop and keyboard move, table inline edit, start timer.
  await a.goto(BASE + '?test#/tasks');
  await a.locator('input[aria-label="New task"]').fill('Write report @office due:2026-10-20');
  await a.getByRole('button', { name: 'Add task' }).click();
  check((await until(async () => (await byPath(a, 'Tasks/Write report.md')) !== undefined)) >= 0, 'quick add created Tasks/Write report.md');
  check((await a.locator('.task-list li', { hasText: 'Write report' }).count()) === 1, 'task shows in the list');
  await a.getByRole('button', { name: 'Start timer for Write report' }).click();
  check((await a.locator('.sr-status').innerText()).includes('timer'), 'start timer emits a request');

  // One Filters control with a count of the active filters; Agenda and Projects are groupings of the list.
  await a.goto(BASE + '?test#/tasks');
  check((await a.getByRole('navigation', { name: 'Task views' }).getByRole('link').allInnerTexts()).join() === 'List,Board,Table', 'the view switch is List, Board, Table');
  check((await a.getByRole('combobox', { name: 'Status' }).count()) === 0, 'no filter selects sit above the list');
  await openFilters(a);
  await a.getByRole('combobox', { name: 'Due' }).selectOption('today');
  await a.keyboard.press('Escape');
  check((await a.getByRole('button', { name: 'Filters, 1 active' }).count()) === 1, 'the Filters button counts one active filter');
  await openFilters(a);
  await a.getByRole('button', { name: 'Clear filters' }).click();
  await a.keyboard.press('Escape');
  check((await a.getByRole('button', { name: 'Filters', exact: true }).count()) === 1, 'Clear filters empties the count');
  await openFilters(a);
  await a.getByRole('combobox', { name: 'Group' }).selectOption('agenda');
  await a.waitForFunction(() => location.hash === '#/tasks/agenda');
  check((await a.getByRole('navigation', { name: 'Task views' }).getByRole('link', { name: 'List' }).getAttribute('aria-current')) === 'page', 'the agenda is a grouping of the list: List stays the active view');
  await a.keyboard.press('Escape');
  await a.goto(BASE + '?test#/tasks/board');
  const card = a.locator('.task-card', { hasText: 'Write report' });
  await card.waitFor();
  await card.dragTo(a.locator('.board-col[data-status="in-progress"]'));
  check((await until(async () => /\nstatus: in-progress\n/.test(await textOf(a, 'Tasks/Write report.md')))) >= 0, 'drag and drop moved the task to in-progress');
  check((await a.locator('.board-col[data-status="in-progress"] .task-card', { hasText: 'Write report' }).count()) === 1, 'card shows in the in-progress column');
  await a.getByRole('button', { name: 'More actions for Write report' }).click();
  await a.getByRole('menuitem', { name: 'Move to Done' }).click();
  check((await until(async () => /\nstatus: done\n[\s\S]*completedDate: /.test(await textOf(a, 'Tasks/Write report.md')))) >= 0, 'the card menu moving to done sets status and completedDate');

  await a.goto(BASE + '?test#/tasks/table');
  const headers = await a.locator('.bases-table th').allInnerTexts();
  check(['Task', 'Status', 'Due', 'Project'].every((h, i) => (headers[i] ?? '').trim().startsWith(h)), `the table opens with Task, Status, Due, Project (${headers.map((h) => h.trim()).join(' | ')})`);
  check(headers.some((h) => h.trim().startsWith('Tracked')), 'with Time on the table has a Tracked column');
  check((await until(async () => /[<\d]/.test(await a.locator('tr', { has: a.getByRole('link', { name: 'Write report', exact: true }) }).locator('td.tracked').innerText()))) >= 0, 'a task whose timer was started shows its tracked time');
  check((await a.getByRole('button', { name: 'Edit priority of Write report' }).count()) === 0, 'other properties are not columns until asked for');
  await openFilters(a);
  await a.getByRole('dialog', { name: 'Filters' }).getByLabel('priority').check();
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'Edit priority of Write report' }).click();
  const cellInput = a.locator('input[aria-label="priority of Write report"]');
  await cellInput.fill('high');
  await cellInput.press('Enter');
  check((await until(async () => /\npriority: high\n/.test(await textOf(a, 'Tasks/Write report.md')))) >= 0, 'table inline edit wrote priority: high');
  check((await until(async () => /\npriority: high\n/.test((await textOf(b, 'Tasks/Write report.md')) ?? ''), 10000)) >= 0, 'task edits reached B');

  // Checklists and projects: progress on the card, a checkbox line made a task, tasks grouped by project.
  await a.goto(BASE + '?test#/tasks');
  await a.locator('input[aria-label="New task"]').fill('Pack bag');
  await a.getByRole('button', { name: 'Add task' }).click();
  await a.locator('.task-list li', { hasText: 'Pack bag' }).getByRole('link', { name: 'Pack bag' }).click();
  await a.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.type('\n- [x] socks\nshoes\nring Sam'); // Enter continues the list
  await a.keyboard.press('Control+Shift+t');
  check((await until(async () => (await textOf(a, 'Tasks/Pack bag.md'))?.endsWith('- [ ] [[ring Sam]]'))) >= 0, 'Ctrl+Shift+T links the checkbox line to a new task');
  const ring = (await textOf(a, 'Tasks/ring Sam.md')) ?? '';
  check(/projects:[\s\S]*\[\[Pack bag\]\]/.test(ring) && /tags:[\s\S]*task/.test(ring), 'the new task belongs to the note it came from');
  await a.goto(BASE + '?test#/tasks');
  check((await until(async () => (await a.locator('.task-list li', { hasText: 'Pack bag' }).locator('.checklist').innerText().catch(() => '')) === '1 of 3')) >= 0, 'the task card shows checklist progress');
  await a.goto(BASE + '?test#/tasks/table');
  await openFilters(a);
  await a.getByRole('dialog', { name: 'Filters' }).getByLabel('Checklist').check();
  await a.keyboard.press('Escape');
  check((await until(async () => (await a.locator('tr', { has: a.getByRole('link', { name: 'Pack bag', exact: true }) }).locator('td.checklist').innerText().catch(() => '')) === '1 of 3')) >= 0, 'the table shows checklist progress');
  await a.goto(BASE + '?test#/tasks/projects');
  const group = a.locator('.project-group[data-project="Pack bag"]');
  await group.waitFor();
  check((await group.locator('h2 .count').innerText()) === '0 of 1', 'a project group shows how many of its tasks are done');
  await group.getByLabel('Add a task to Pack bag').fill('Zip bag');
  await group.getByRole('button', { name: 'Add', exact: true }).click();
  check((await until(async () => /\[\[Pack bag\]\]/.test((await textOf(a, 'Tasks/Zip bag.md')) ?? ''))) >= 0, 'a task added in a group joins that project');
  check((await until(async () => (await group.locator('h2 .count').innerText()) === '0 of 2')) >= 0, 'and the group counts it');

  // Agenda and recurrence: a daily task shows today and later days; finishing it moves it to tomorrow.
  const ymd = (offset) => a.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, offset);
  const [today, tomorrow] = [await ymd(0), await ymd(1)];
  await a.goto(BASE + '?test#/tasks');
  await a.locator('input[aria-label="New task"]').fill('Water plants repeat:daily');
  await a.getByRole('button', { name: 'Add task' }).click();
  check((await until(async () => /recurrence: DTSTART:\d{8};FREQ=DAILY/.test((await textOf(a, 'Tasks/Water plants.md')) ?? ''))) >= 0, 'repeat:daily writes a TaskNotes recurrence');
  await a.goto(BASE + '?test#/tasks/agenda');
  const todayBox = a.locator(`.agenda section[data-day="${today}"]`);
  await todayBox.waitFor();
  check((await todayBox.locator('li', { hasText: 'Water plants' }).count()) === 1, 'the agenda lists the task today');
  check((await a.locator(`.agenda section[data-day="${tomorrow}"] li.future`, { hasText: 'Water plants' }).count()) === 1, 'and its next occurrence tomorrow');
  await todayBox.getByLabel('Done: Water plants').click();
  check((await until(async () => { const t = (await textOf(a, 'Tasks/Water plants.md')) ?? ''; return t.includes(`- '${today}'`) || t.includes(`- ${today}`); })) >= 0, 'finishing a repeating task records the day in complete_instances');
  check((await until(async () => new RegExp(`scheduled: '?${tomorrow}`).test((await textOf(a, 'Tasks/Water plants.md')) ?? '') && /status: open/.test((await textOf(a, 'Tasks/Water plants.md')) ?? ''))) >= 0, 'scheduled moves to tomorrow and the task stays open');

  // Task extras: archive and restore, a board per project, and the completed-date rule switch.
  await a.goto(BASE + '?test#/tasks');
  await a.getByRole('button', { name: 'More actions for Zip bag' }).click();
  await a.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  check((await until(async () => /archived/.test((await textOf(a, 'Tasks/Zip bag.md')) ?? ''))) >= 0, 'Archive adds the archived tag');
  check((await a.locator('.task-list li', { hasText: 'Zip bag' }).count()) === 0, 'an archived task leaves the list');
  await a.getByLabel(/Show archived/).click();
  await a.getByRole('button', { name: 'More actions for Zip bag' }).click();
  await a.getByRole('menuitem', { name: 'Restore', exact: true }).click();
  check((await until(async () => !/archived/.test((await textOf(a, 'Tasks/Zip bag.md')) ?? ''))) >= 0, 'Restore removes the tag');
  await a.getByLabel(/Show archived/).click();
  await a.goto(BASE + '?test#/tasks/board');
  await openFilters(a);
  await a.getByLabel('Board project').selectOption({ label: 'Pack bag (0 of 2)' });
  await a.keyboard.press('Escape');
  check((await a.locator('.task-card', { hasText: 'Zip bag' }).count()) === 1 && (await a.locator('.task-card', { hasText: 'Write report' }).count()) === 0, 'the board can show one project');
  await a.goto(BASE + '?test#/organize');
  await a.getByLabel(/Set the completed date/).click();
  await a.goto(BASE + '?test#/tasks/board');
  await openFilters(a);
  await a.getByLabel('Board project').selectOption({ label: 'Pack bag (0 of 2)' });
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'More actions for Zip bag' }).click();
  await a.getByRole('menuitem', { name: 'Move to In progress' }).click();
  await a.getByRole('button', { name: 'More actions for Zip bag' }).click();
  await a.getByRole('menuitem', { name: 'Move to Done' }).click();
  check((await until(async () => { const t = (await textOf(a, 'Tasks/Zip bag.md')) ?? ''; return /status: done/.test(t) && !/completedDate/.test(t); })) >= 0, 'with the rule off a move to Done writes no completed date');
  await a.goto(BASE + '?test#/organize');
  await a.getByLabel(/Set the completed date/).click();

  // Bulk edit: select tasks, mark them done, shift dates, move notes, all with one Undo each.
  await a.goto(BASE + '?test#/tasks');
  for (const t of ['Bulk one due:2026-10-20', 'Bulk two due:2026-10-21', 'Bulk three due:2026-10-22']) {
    await a.locator('input[aria-label="New task"]').fill(t);
    await a.getByRole('button', { name: 'Add task' }).click();
  }
  await a.locator('.task-list li', { hasText: 'Bulk three' }).waitFor();
  const bulkText = async (n) => (await textOf(a, `Tasks/${n}.md`)) ?? '';
  const names = ['Bulk one', 'Bulk two', 'Bulk three'];
  const spot = () => a.evaluate(() => {
    const top = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; };
    return [document.querySelector('.page-select'), document.querySelector('.task-list li')].map((el) => (el ? top(el) : 'none')).join(' ');
  });
  const before = await spot();
  await startSelecting(a);
  check((await until(async () => (await a.locator('.page-select').innerText()).trim() === 'Done')) >= 0, 'the Select button reads Done while selecting');
  check((await spot()) === before, 'entering select mode moves neither the Select button nor the list');
  await a.locator('.task-list li', { hasText: 'Bulk one' }).locator('.row-check').click();
  await a.locator('.task-list li', { hasText: 'Bulk three' }).locator('.row-check').click({ modifiers: ['Shift'] });
  check((await a.locator('.bulk-count').innerText()) === '3 selected', 'a Shift click selects the tasks in between');
  await a.getByRole('button', { name: 'Status', exact: true }).click();
  await a.getByLabel('Status for the selected tasks').selectOption('done');
  await a.getByRole('button', { name: 'Apply' }).click();
  check((await until(async () => (await Promise.all(names.map(bulkText))).every((t) => /status: done/.test(t) && /completedDate: /.test(t)))) >= 0, 'marking three tasks Done sets status and completedDate');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await Promise.all(names.map(bulkText))).every((t) => /status: open/.test(t) && !/completedDate/.test(t)))) >= 0, 'one Undo reopens all three');
  await a.getByRole('button', { name: 'Dates', exact: true }).click();
  await a.getByLabel('Days to shift').fill('3');
  await a.getByRole('button', { name: 'Later', exact: true }).click();
  check((await until(async () => (await bulkText('Bulk one')).includes('due: 2026-10-23') && (await bulkText('Bulk three')).includes('due: 2026-10-25'))) >= 0, 'Later shifts the due dates by days');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await bulkText('Bulk one')).includes('due: 2026-10-20'))) >= 0, 'Undo puts the dates back');
  await a.locator('.page-select').click();

  await a.goto(BASE + '?test#/notes');
  await a.locator('.tree-note', { hasText: 'Bulk one' }).waitFor();
  await a.locator('.tree-note', { hasText: 'Bulk one' }).click({ modifiers: ['Control'] });
  await a.locator('.tree-note', { hasText: 'Bulk two' }).click({ modifiers: ['Control'] });
  check((await a.locator('.bulk-count').innerText()) === '2 selected', 'Ctrl click selects notes in the tree without opening them');
  check(!a.url().includes('/notes/'), 'and the note was not opened');
  await a.getByRole('button', { name: 'Tags', exact: true }).click();
  await a.getByLabel('Tag', { exact: true }).fill('batch');
  await a.getByRole('button', { name: 'Add tag' }).click();
  check((await until(async () => /batch/.test(await bulkText('Bulk one')) && /batch/.test(await bulkText('Bulk two')) && !/batch/.test(await bulkText('Bulk three')))) >= 0, 'Add tag tags the selected notes only');
  await a.getByRole('button', { name: 'Move to folder' }).click();
  await a.getByLabel('Folder (empty for the top level)').fill('Moved/Here');
  await a.getByRole('button', { name: 'Move', exact: true }).click();
  check((await until(async () => (await byPath(a, 'Moved/Here/Bulk one.md')) !== undefined && (await byPath(a, 'Moved/Here/Bulk two.md')) !== undefined)) >= 0, 'Move to folder moves both notes');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await byPath(a, 'Tasks/Bulk one.md')) !== undefined && (await byPath(a, 'Tasks/Bulk two.md')) !== undefined)) >= 0, 'one Undo moves them back');
  const workPaths = () => a.evaluate(() => Object.values(window.__app.json('space/work', 'notes')).filter((n) => !n.deleted).map((n) => n.path));
  await a.getByRole('button', { name: 'Move to space' }).click();
  await a.getByLabel('Space to move the selected notes to').selectOption({ label: 'Work' });
  await a.getByLabel('Folder (empty for the top level)').fill('');
  await a.getByRole('button', { name: 'Move', exact: true }).click();
  check((await until(async () => { const w = await workPaths(); return w.includes('Bulk one.md') && w.includes('Bulk two.md'); })) >= 0, 'Move to space copies the notes into the other space');
  check((await byPath(a, 'Tasks/Bulk one.md')) === undefined, 'and leaves none behind');
  await a.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await byPath(a, 'Tasks/Bulk one.md')) !== undefined && !(await workPaths()).includes('Bulk one.md'))) >= 0, 'one Undo moves them back');
  check((await a.locator('.bulk-bar').count()) === 0, 'selecting ends once the selected notes have moved away');

  // All spaces: both spaces in one tree, search across them, new notes and tasks in the last used space.
  const inSpace = async (p, space) => Object.entries(await p.evaluate(([id]) => window.__app.json(id, 'notes'), [space])).filter(([, n]) => !n.deleted).map(([, n]) => n.path);
  await a.goto(BASE + '?test#/notes');
  const picker = a.getByLabel('Space', { exact: true });
  await picker.selectOption({ label: 'Work' });
  await newNote(a);
  await a.locator('input[aria-label="Note title"]').waitFor();
  await a.keyboard.type('Zeta');
  await a.keyboard.press('Enter');
  check((await until(async () => (await inSpace(a, 'space/work')).includes('Zeta.md'))) >= 0, 'a note made while Work is picked lives in Work');
  await a.locator('.cm-content').click();
  await a.keyboard.type('Zebra invoice for the other space.');
  check((await a.locator('.notes-space').count()) === 0, 'with one space picked the tree has no space headings');
  await picker.selectOption({ label: 'All spaces' });
  check((await a.locator('.notes-space-head').allInnerTexts()).map((t) => t.trim()).join() === 'Personal,Work', 'All spaces shows each space as a top-level folder');
  check((await a.locator('.notes-space', { hasText: 'Zeta' }).count()) === 1 && (await a.locator('.notes-space', { hasText: 'Acme' }).count()) === 1, 'each space\'s notes sit under its own folder');
  await a.reload();
  check((await a.getByLabel('Space', { exact: true }).inputValue()) === 'all', 'All spaces is remembered on this device');
  await a.getByLabel('Search notes').fill('invoice');
  await until(async () => (await a.locator('.search-hits li').count()) >= 3);
  const hitPaths = await a.locator('.search-hits .hit-path').allInnerTexts();
  check(hitPaths.some((t) => t.startsWith('Personal · ')) && hitPaths.some((t) => t.startsWith('Work · ')), `search finds notes in every space, labelled (${hitPaths})`);
  await a.locator('.search-hits li', { hasText: 'Work · Zeta.md' }).click();
  // The editor of the note open before the reload may still be on screen; the space becomes the last
  // used one only once the route names the Zeta note, so wait for that, not for any editor.
  const zetaId = await a.evaluate(() => Object.entries(window.__app.json('space/work', 'notes')).find(([, n]) => n.path === 'Zeta.md')?.[0]);
  check((await until(async () => (await a.evaluate(() => location.hash)).endsWith(`/notes/${zetaId}`))) >= 0, 'the search hit opened the Zeta note');
  await a.locator('.cm-content').waitFor();
  await a.getByLabel('Search notes').fill('');
  await newNote(a);
  const eta = a.locator('input[aria-label="Note title"]');
  await eta.waitFor();
  await until(async () => eta.evaluate((el) => document.activeElement === el));
  await eta.fill('Eta');
  await a.keyboard.press('Enter');
  check((await until(async () => (await inSpace(a, 'space/work')).includes('Eta.md'))) >= 0, `a new note goes to the last used space (${await inSpace(a, 'space/work')} / ${await inSpace(a, 'space/personal')})`);
  await a.goto(BASE + '?test#/tasks');
  await a.getByLabel('Space', { exact: true }).selectOption({ label: 'All spaces' });
  await a.getByLabel('Space for the new task').selectOption({ label: 'Work' });
  await a.getByLabel('New task', { exact: true }).fill('Water the plants');
  await a.getByRole('button', { name: 'Add task' }).click();
  await a.locator('.task-list li', { hasText: 'Water the plants' }).waitFor();
  check((await inSpace(a, 'space/work')).includes('Tasks/Water the plants.md'), 'a task added with Work chosen is stored in Work');
  await openFilters(a);
  await a.getByLabel('Status').selectOption('all');
  await a.keyboard.press('Escape');
  const labels = await a.locator('.task-list .task-space').allInnerTexts();
  check(labels.includes('Work') && labels.includes('Personal'), `tasks of every space are listed with their space (${labels})`);
  await a.getByLabel('Space', { exact: true }).selectOption({ label: 'Personal' });
  check((await a.locator('.task-list li', { hasText: 'Water the plants' }).count()) === 0, 'picking one space hides the other space\'s tasks');

  // Move to another space: copied there with a new id, gone here, with an Undo.
  await a.goto(BASE + `?test#/notes/${acmeId}`);
  await a.locator('.cm-content').waitFor();
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: 'Move to…' }).click();
  await a.locator('dialog').getByLabel('Space', { exact: true }).selectOption({ label: 'Work' });
  await a.locator('dialog li', { hasText: 'Top level' }).click();
  check((await until(async () => (await inSpace(a, 'space/work')).includes('Projects/Acme.md') || (await inSpace(a, 'space/work')).includes('Acme.md'))) >= 0, 'Move to… another space copies the note there');
  check(!(await inSpace(a, 'space/personal')).some((x) => x.endsWith('Acme.md')), 'and removes it from the old space, with no stub');
  await a.locator('.toast', { hasText: 'Moved to Work' }).getByRole('button', { name: 'Undo' }).click();
  check((await until(async () => (await inSpace(a, 'space/personal')).some((x) => x.endsWith('Acme.md')))) >= 0, 'Undo brings the note back to the first space');
  check(!(await inSpace(a, 'space/work')).some((x) => x.endsWith('Acme.md')), 'and leaves none in the other');
  // The note came back under a new id (a move copies it).
  acmeId = (await byPath(a, 'Projects/Acme.md'))[0];

  // Dragging a note onto a folder of another space moves it there (same move as the dialog).
  await a.goto(BASE + '?test#/notes');
  await a.getByLabel('Space', { exact: true }).selectOption({ label: 'All spaces' });
  await a.setViewportSize({ width: 1200, height: 1400 }); // the tree is long enough now that both ends of the drag must be on screen
  await a.locator('.notes-space', { hasText: 'Personal' }).locator('a.tree-note', { hasText: 'Acme' }).dragTo(a.locator('.notes-space', { hasText: 'Work' }).locator('button.tree-folder', { hasText: 'Tasks' }));
  check((await until(async () => (await inSpace(a, 'space/work')).includes('Tasks/Acme.md'))) >= 0, 'dragging a note onto another space\'s folder moves it there');
  check(!(await inSpace(a, 'space/personal')).some((x) => x.endsWith('Acme.md')), 'and removes it from the first space');
  await a.locator('.toast', { hasText: 'Moved to Work' }).getByRole('button', { name: 'Undo' }).click();
  check((await until(async () => (await inSpace(a, 'space/personal')).some((x) => x.endsWith('Acme.md')))) >= 0, 'Undo brings the dragged note back');
  acmeId = (await byPath(a, 'Projects/Acme.md'))[0];

  // Outline, unlinked mentions, bookmarks, weekly and monthly notes.
  await a.goto(BASE + `?test#/notes/${acmeId}`);
  await a.locator('.cm-content').waitFor();
  await a.locator('.note-links summary', { hasText: 'Outline' }).click();
  check((await a.locator('.outline li', { hasText: 'Plan' }).count()) === 1, 'the Outline lists the note\'s headings');
  await a.locator('.outline').getByRole('button', { name: 'Plan' }).click();
  check((await until(async () => (await a.evaluate(() => document.querySelector('.note-editor')?.shadowRoot?.activeElement?.className ?? '')).includes('cm-content'))) >= 0, 'clicking a heading puts the cursor in the editor');
  await newNote(a);
  const standupTitle = a.locator('input[aria-label="Note title"]');
  await until(async () => (await standupTitle.inputValue()) !== 'Acme');
  await standupTitle.fill('Standup');
  await a.keyboard.press('Enter');
  check((await until(async () => (await byPath(a, 'Standup.md')) !== undefined)) >= 0, 'new note titled Standup');
  await a.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.type('Met acme today, and code `Acme` stays out.');
  check((await until(async () => (await textOf(a, 'Standup.md'))?.includes('stays out.'))) >= 0, 'a note mentioning Acme without a link');
  await a.goto(BASE + `?test#/notes/${acmeId}`);
  await a.locator('.cm-content').waitFor();
  await a.locator('.note-links summary', { hasText: 'Unlinked mentions' }).click();
  check((await until(async () => (await a.locator('.note-links details', { hasText: 'Unlinked mentions' }).locator('a', { hasText: 'Standup' }).count()) === 1)) >= 0, 'Unlinked mentions lists the note that names Acme without linking');
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: 'Bookmark', exact: true }).click();
  check((await until(async () => (await a.locator('.bookmarks a', { hasText: 'Acme' }).count()) === 1)) >= 0, 'Bookmark adds the note to the Bookmarks list');
  await a.reload();
  check((await until(async () => (await a.locator('.bookmarks a', { hasText: 'Acme' }).count()) === 1)) >= 0, 'and it stays after a reload');
  await a.getByRole('button', { name: 'More actions for this note' }).click();
  await a.getByRole('menuitem', { name: 'Remove bookmark' }).click();
  check((await until(async () => (await a.locator('.bookmarks').count()) === 0)) >= 0, 'Remove bookmark takes it off the list');
  await notesMenu(a, 'New…', "This week's note");
  check((await until(async () => (await inSpace(a, 'space/personal')).some((x) => /^Weekly\/\d{4}-W\d\d\.md$/.test(x)))) >= 0, 'This week\'s note is made in Weekly/ with an ISO week name');
  await notesMenu(a, 'New…', "This month's note");
  check((await until(async () => (await inSpace(a, 'space/personal')).some((x) => /^Monthly\/\d{4}-\d\d\.md$/.test(x)))) >= 0, 'This month\'s note is made in Monthly/');

  // Narrow screen: the list collapses behind a button while a note is open.
  await b.setViewportSize({ width: 375, height: 800 });
  await b.goto(BASE + `?test#/notes/${acmeId}`);
  await b.locator('.cm-content').waitFor();
  check(!(await b.locator('.notes-side').isVisible()) && (await b.getByRole('button', { name: '☰ All notes' }).isVisible()), '375 px: tree collapsed behind a button');
  check(await b.evaluate(() => document.documentElement.scrollWidth <= 375), '375 px: no horizontal scroll on the note');
  check((await b.locator('.props-head').getAttribute('aria-expanded')) === 'false', '375 px: Properties start collapsed so the text comes first');
  await b.getByRole('button', { name: '☰ All notes' }).click();
  check(await b.locator('.notes-side').isVisible(), '375 px: tree shown on demand');
  await b.goto(BASE + '?test#/tasks/board');
  await b.locator('.task-card').first().waitFor();
  check(await b.evaluate(() => document.documentElement.scrollWidth <= 375), '375 px: no horizontal scroll on the board');
  await b.goto(BASE + '?test#/tasks');
  await b.locator('.task-list li').first().waitFor();
  await startSelecting(b);
  await b.locator('.row-check').first().click();
  await b.getByRole('button', { name: 'Dates', exact: true }).click();
  check(await b.evaluate(() => document.documentElement.scrollWidth <= 375), '375 px: no horizontal scroll with the action bar open');
  check(await b.locator('.bulk-bar').isVisible(), '375 px: the action bar is shown');
  // Formatting bar on a phone: shows while the editor has focus and edits the text (NE27).
  const barText = async () => (await notes(a))[(await a.evaluate(() => location.hash)).split('/').pop()]?.text ?? null;
  await newNote(a);
  await a.locator('input[aria-label="Note title"]').waitFor();
  await a.keyboard.type('Bar');
  await a.keyboard.press('Enter');
  await a.setViewportSize({ width: 375, height: 800 });
  // Enter sends the cursor to the body as soon as the editor has loaded (focusBody), which on a busy machine can come first: wait for it, then take focus away.
  await a.locator('.note-pane .note-editor .cm-content').waitFor();
  await until(() => a.evaluate(() => !!document.querySelector('.note-pane .note-editor')?.contains(document.activeElement)), 3000);
  await a.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await a.locator('.note-format-bar').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  check((await a.locator('.note-format-bar').count()) === 0, 'no formatting bar without editor focus');
  await a.locator('.note-editor .cm-content').click();
  await a.locator('.note-format-bar').waitFor();
  const bar = await a.locator('.note-format-bar').boundingBox();
  check(bar.x >= 0 && bar.x + bar.width <= 375, 'the formatting bar fits at 375 px');
  await a.keyboard.type('word');
  check((await until(async () => bodyOf(await barText()).includes('word'))) >= 0, 'text typed before using the bar');
  await a.getByRole('button', { name: 'Bold' }).click();
  check((await until(async () => bodyOf(await barText()).includes('**word**'))) >= 0, 'the Bold button bolds the word');
  await a.getByRole('button', { name: 'Bullet' }).click();
  check((await until(async () => bodyOf(await barText()).includes('- **word**'))) >= 0, 'bar buttons bold the word and make a bullet');
  await a.getByRole('button', { name: 'Indent' }).click();
  check((await until(async () => bodyOf(await barText()).includes('  - **word**'))) >= 0, 'the Indent button indents the line');
  await a.setViewportSize({ width: 1200, height: 900 });

} catch (e) {
  fail(`exception: ${e.stack || e}`);
}

await finish(browser, mock);
