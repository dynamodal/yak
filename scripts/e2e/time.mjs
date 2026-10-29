// End-to-end for the time module: start and stop, edit, manual entry, projects, idle banner,
// narrow-screen layout, and two paired profiles that both start timers and converge to one
// running timer. Runs against dist/ served with the real headers, so CSP violations fail the run.
//
//   npm run e2e time
//
import { join } from 'node:path';
import { BASE, launch, startMock, sleep, ok, fail, check, watchPage, until, finish, keepAllSpaces, startSelecting, pickSpace, openJoin, startSyncing, joinByInvite, pill, startRound, stopRound, detailsDialog, openDetails, poll } from './lib.mjs';


const mock = await startMock();
const browser = await launch();

async function open(name, { viewport, hash = '#/time', clock } = {}) {
  const context = await browser.newContext({ viewport: viewport ?? { width: 1100, height: 900 } });
  const page = await context.newPage();
  watchPage(page, name);
  // `clock: 'noon'` starts the page's clock at 12:00 local today and lets it run, so a run near
  // midnight does not push entries (and a split) across two days.
  if (clock) await page.clock.install({ time: clock === 'noon' ? new Date(new Date().setHours(12, 0, 0, 0)) : new Date() });
  await page.goto(`${BASE}?test${hash}`);
  await page.locator('.timer-pill').waitFor();
  return page;
}


// The timer has no bar on the Time page any more: description, project, tags and billable live in the pill's details popover.
const bar = (p) => detailsDialog(p);
const desc = (p) => bar(p).getByLabel('Description', { exact: true });
const fillDesc = async (p, text) => { await openDetails(p); await desc(p).fill(text); };
const isBillable = async (p) => (await bar(p).getByRole('button', { name: 'Billable' }).getAttribute('aria-pressed')) === 'true';
const rows = (p) => p.locator('li.entry');
const lines = (p) => p.locator('.te-row, .te-group');
const line = (p, text) => p.locator('.te-row, .te-group', { hasText: text }).first();
const all = (p) => p.evaluate(() => ['space/personal/time', 'space/work/time'].flatMap((id) => Object.values(window.__app.json(id, 'time_entries')).filter((e) => !e.deleted).map((e) => ({ ...e, space: id }))));
const runningCount = (p) => p.evaluate(() => ['space/personal/time', 'space/work/time'].reduce((n, id) => n + Object.values(window.__app.json(id, 'time_entries')).filter((e) => e.stop === null && !e.deleted).length, 0));
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const pickProject = async (p, scope, name) => {
  await scope.getByRole('button', { name: /^(Project|Add project)/ }).first().click();
  await p.getByLabel('Find a project').fill(name);
  await p.getByLabel('Find a project').press('Enter');
};
const addTag = async (p, scope, name) => {
  await scope.getByRole('button', { name: /^Tags/ }).first().click();
  await p.getByLabel('Find or add a tag').fill(name);
  await p.getByLabel('Find or add a tag').press('Enter');
  await p.keyboard.press('Escape');
};

// ---- one profile: the basic flows ----
{
  const p = await open('solo', { clock: 'noon' });
  check((await p.title()).length > 0 && (await pill(p).count()) === 1 && (await bar(p).count()) === 0, 'timer view is the default view, with the pill and no bar');

  await fillDesc(p, 'Write report');
  await desc(p).press('Enter');
  await stopRound(p).waitFor();
  check((await runningCount(p)) === 1 && (await rows(p).count()) === 1 && (await rows(p).first().evaluate((el) => el.classList.contains('running'))) && !(await p.getByText('Nothing tracked').count()), 'Enter starts a timer; the running entry shows in the pill and as a row in the list');
  check(/0:00:0\d/.test(await pill(p).innerText()), 'the pill shows the elapsed time');
  await p.reload();
  await stopRound(p).waitFor();
  ok('running timer survives reload');
  await sleep(2200);
  await stopRound(p).click();
  await startRound(p).waitFor();
  check((await runningCount(p)) === 0 && (await rows(p).count()) === 1, 'stop leaves no running entry and the entry joins Today');
  check((await p.locator('.day-head').first().innerText()).includes('Today'), 'entries are grouped under a day heading with its total');

  // project, client, tag
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  await p.getByLabel('New client name').fill('Acme');
  await p.getByRole('button', { name: 'Add client' }).click();
  await p.getByLabel('New project name').fill('Alpha');
  await p.getByLabel('New project client').selectOption({ label: 'Acme' });
  await p.getByRole('button', { name: 'Add project' }).click();
  await p.getByLabel('Billable Alpha').check();
  await p.getByLabel('Hourly rate of Alpha').fill('80');
  await p.getByLabel('Hourly rate of Alpha').press('Tab');
  check((await p.locator('.proj-row').count()) >= 2, 'client and project created');
  // Rows are a list; clicking one opens its fields, Done closes them.
  await p.getByRole('group', { name: 'Edit Alpha' }).getByRole('button', { name: 'Done' }).click();
  check((await p.getByLabel('Name of Alpha').count()) === 0, 'Done closes the project fields');
  const alphaRow = p.locator('.proj-row', { hasText: 'Alpha' });
  check(/Acme/.test(await alphaRow.innerText()) && /Billable · 80 USD\/h/.test(await alphaRow.innerText()), 'the project row reads client, billable and rate');
  await alphaRow.locator('.proj-summary').click();
  check((await p.getByLabel('Name of Alpha').count()) === 1, 'clicking the row opens its fields');
  await p.getByRole('group', { name: 'Edit Alpha' }).getByRole('button', { name: 'Done' }).click();
  await p.getByRole('button', { name: 'More actions for project Alpha' }).click();
  check((await p.getByRole('menuitem', { name: 'Edit' }).count()) === 1 && (await p.getByRole('menuitem', { name: 'Archive' }).count()) === 1 && (await p.getByRole('menuitem', { name: 'Delete' }).count()) === 1, 'the row menu offers Edit, Archive and Delete');
  await p.keyboard.press('Escape');

  await p.getByRole('link', { name: 'Time', exact: true }).click();
  await fillDesc(p, 'Design');
  await pickProject(p, bar(p), 'alp');
  { const l = await bar(p).getByRole('button', { name: /^Project/ }).getAttribute('aria-label'); check(l === 'Project: Alpha in Personal', `project picked by typing and Enter (${l})`); }
  check(await isBillable(p), 'billable defaults from the project');
  await addTag(p, bar(p), 'deep');
  check((await bar(p).getByRole('button', { name: /^Tags/ }).getAttribute('aria-label')) === 'Tags: deep', 'tag created from the picker');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).click();
  await stopRound(p).waitFor();
  await sleep(1100);
  await stopRound(p).click();
  const entryId = await rows(p).first().getAttribute('data-entry');
  const row = p.locator(`li[data-entry="${entryId}"]`);
  const text = await row.innerText();
  check(text.includes('Design') && text.includes('Alpha') && text.includes('Acme') && text.includes('deep'), `entry shows project, client and tag (${text.replace(/\n/g, ' | ')})`);

  // hover reveals the row actions
  const actionsOpacity = () => row.locator('.te-actions').evaluate((el) => getComputedStyle(el).opacity);
  await p.mouse.move(0, 0);
  check((await actionsOpacity()) === '0', 'row actions are hidden until hover');
  await row.hover();
  await until(async () => (await actionsOpacity()) === '1', 1000);
  check((await actionsOpacity()) === '1', 'hovering a row shows continue and more actions');

  // inline edits: description, duration
  await row.getByRole('button', { name: 'Description of Design' }).click();
  await row.getByLabel('Description of Design').fill('Design v2');
  await row.getByLabel('Description of Design').press('Enter');
  await until(async () => (await row.innerText()).includes('Design v2'));
  check((await row.innerText()).includes('Design v2'), 'description edited inline');
  await row.getByRole('button', { name: 'Duration of Design v2' }).click();
  await row.getByLabel('Duration of Design v2').fill('2 bananas');
  await row.getByLabel('Duration of Design v2').press('Enter');
  check(await row.getByRole('alert').first().isVisible(), 'an unreadable duration is refused with a message');
  await row.getByLabel('Duration of Design v2').fill('1:30');
  await row.getByLabel('Duration of Design v2').press('Enter');
  await until(async () => (await row.innerText()).includes('1.50 h'));
  check((await row.innerText()).includes('1.50 h'), 'duration typed as 1:30 sets 1.50 h');
  await row.getByRole('button', { name: 'Duration of Design v2' }).click();
  await row.getByLabel('Duration of Design v2').fill('2h');
  await row.getByLabel('Duration of Design v2').press('Enter');
  await until(async () => (await row.innerText()).includes('2.00 h'));
  check((await row.innerText()).includes('2.00 h'), `duration typed as 2h sets 2.00 h (${(await row.innerText()).replace(/\n/g, ' | ')})`);

  // project changed inline
  await pickProject(p, row, 'no project');
  await until(async () => !(await row.innerText()).includes('Alpha'));
  check(!(await row.innerText()).includes('Alpha'), 'project removed inline from the row');
  await pickProject(p, row, 'alpha');
  await until(async () => (await row.innerText()).includes('Alpha'));
  check((await row.innerText()).includes('Alpha'), 'project set inline from the row');

  // full editor: a click on the row background
  await row.locator('.te-range').click();
  const panel = row.locator('.edit-panel');
  await panel.waitFor();
  check(await panel.isVisible(), 'clicking the row opens the full editor');
  const stopVal = await panel.getByLabel('Stop time').inputValue();
  await panel.getByLabel('Start time').fill(`${stopVal.slice(0, 11)}23:59`);
  await panel.getByLabel('Stop time').fill(`${stopVal.slice(0, 11)}00:01`);
  await panel.getByRole('button', { name: 'Save times' }).click();
  check(await panel.getByRole('alert').first().isVisible(), 'a stop before the start is refused with a message');
  await panel.getByRole('button', { name: 'Reset' }).click();

  // split, then the two halves collapse into a group with a count
  await panel.getByRole('button', { name: 'Split', exact: true }).click();
  await until(async () => (await p.locator('.te-group').count()) === 1);
  const group = p.locator('.te-group').first();
  check((await p.locator('.te-group').count()) === 1 && (await group.locator('.te-count').innerText()).trim() === '2', 'split makes two entries, shown as one row with a count of 2');
  check((await group.locator('.total').innerText()).includes('2.00 h'), 'the group row shows the sum of its entries');
  await group.getByRole('button', { name: /^2 entries: Design v2/ }).click();
  check((await group.locator('li.entry').count()) === 2, 'the count expands to the single entries');
  await group.getByRole('button', { name: /^2 entries: Design v2/ }).click();
  check((await group.locator('li.entry').count()) === 0, 'and collapses again');

  // continue from the group
  await group.hover();
  await group.getByRole('button', { name: 'Continue: Design v2' }).first().click();
  await stopRound(p).waitFor();
  await openDetails(p);
  await until(async () => (await desc(p).inputValue()) === 'Design v2');
  check((await desc(p).inputValue()) === 'Design v2' && (await isBillable(p)) && (await bar(p).getByRole('button', { name: /^Project/ }).getAttribute('aria-label')) === 'Project: Alpha', `continue starts a copy that is running (desc=${await desc(p).inputValue()})`);
  await stopRound(p).click();
  await until(async () => (await group.locator('.te-count').innerText()).trim() === '3');
  check((await group.locator('.te-count').innerText()).trim() === '3', 'the continued entry joins the group (count 3)');

  // finished entry from the page header's Add entry
  const before = (await all(p)).length;
  await p.getByRole('button', { name: 'Add entry' }).click();
  const manual = p.getByRole('dialog', { name: 'Add entry' });
  await manual.getByLabel('Description', { exact: true }).fill('Phone call');
  await manual.getByRole('button', { name: 'Add', exact: true }).click();
  await until(async () => (await all(p)).length === before + 1);
  check((await all(p)).length === before + 1 && (await line(p, 'Phone call').innerText()).includes('1.00 h'), 'finished entry added with Add entry (default one hour)');
  check((await manual.count()) === 0, 'the Add entry form closes after adding');

  // more actions: duplicate, delete
  const phone = line(p, 'Phone call');
  await phone.hover();
  await phone.getByRole('button', { name: 'More actions: Phone call' }).click();
  await p.getByRole('menuitem', { name: 'Duplicate' }).click();
  await until(async () => (await all(p)).length === before + 2);
  check((await all(p)).length === before + 2 && (await line(p, 'Phone call').locator('.te-count').innerText()).trim() === '2', 'duplicate adds a copy (grouped with the original)');
  await line(p, 'Phone call').getByRole('button', { name: /^2 entries: Phone call/ }).click();
  const first = line(p, 'Phone call').locator('li.entry').first();
  await first.hover();
  await first.getByRole('button', { name: 'More actions: Phone call' }).click();
  await p.getByRole('menuitem', { name: 'Delete' }).click();
  await until(async () => (await all(p)).length === before + 1);
  check((await all(p)).length === before + 1 && (await p.locator('.te-group', { hasText: 'Phone call' }).count()) === 0, 'delete removes the entry at once; one left, shown as a plain row');
  const undo = p.locator('.toast', { hasText: 'Deleted “Phone call”' }).getByRole('button', { name: 'Undo' });
  check(await undo.isVisible(), 'a toast offers Undo');
  await undo.click();
  await until(async () => (await all(p)).length === before + 2);
  check((await all(p)).length === before + 2, 'Undo brings the entry back');
  // delete again, then restore from "Recently deleted"
  await line(p, 'Phone call').getByRole('button', { name: /^2 entries: Phone call/ }).click().catch(() => {});
  const again = line(p, 'Phone call').locator('li.entry').first();
  await again.hover();
  await again.getByRole('button', { name: 'More actions: Phone call' }).click();
  await p.getByRole('menuitem', { name: 'Delete' }).click();
  await until(async () => (await all(p)).length === before + 1);
  const deleted = p.locator('.tl-deleted');
  check((await deleted.locator('summary').innerText()).includes('Recently deleted (1)'), 'the deleted entry is listed under Recently deleted');
  await deleted.locator('summary').click();
  await deleted.getByRole('button', { name: 'Restore Phone call' }).click();
  await until(async () => (await all(p)).length === before + 2);
  check((await all(p)).length === before + 2 && (await p.locator('.tl-deleted').count()) === 0, 'Restore brings it back and empties the list');
  // and delete it again (still restorable, but out of the way of later checks)
  await line(p, 'Phone call').getByRole('button', { name: /^2 entries: Phone call/ }).click().catch(() => {});
  const third = line(p, 'Phone call').locator('li.entry').first();
  await third.hover();
  await third.getByRole('button', { name: 'More actions: Phone call' }).click();
  await p.getByRole('menuitem', { name: 'Delete' }).click();
  await until(async () => (await all(p)).length === before + 1);

  // the bar offers projects from every space, labelled by space; the entry goes to the project's space
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  check((await p.getByLabel('Show space').inputValue()) === 'all', 'the Projects page shows all spaces by default');
  await p.getByLabel('Space for new items').first().selectOption({ label: 'Work' });
  await p.getByLabel('New project name').fill('Ops');
  await p.getByRole('button', { name: 'Add project' }).click();
  check((await p.locator('.proj-row', { has: p.getByLabel('Name of Ops') }).locator('.space-tag').innerText()) === 'Work', 'a project added from All spaces lands in the chosen space and is labelled with it');
  await p.getByRole('link', { name: 'Time', exact: true }).click();
  await fillDesc(p, 'On call');
  await bar(p).getByRole('button', { name: /^Project/ }).click();
  const headings = await p.locator('.picker-heading').allInnerTexts();
  check(headings.map((h) => h.toLowerCase()).join(',') === 'personal,work', `project list is grouped by space (${headings})`);
  await p.getByRole('option', { name: /Ops/ }).click();
  check((await bar(p).getByRole('button', { name: /^Project/ }).getAttribute('aria-label')) === 'Project: Ops in Work' && (await bar(p).locator('.picker-space').innerText()) === 'Work', 'the bar labels a project from another space with its space');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).click();
  await until(async () => (await runningCount(p)) === 1);
  const started = (await all(p)).find((e) => e.description === 'On call');
  check(started && started.space === 'space/work/time' && started.stop === null, `the entry went into the project's space (${started?.space})`);
  check((await stopRound(p).count()) === 1, 'the pill holds the entry running in the other space');
  await openDetails(p);
  check((await bar(p).innerText()).includes('Ops'), 'its details show the project of the other space');
  await stopRound(p).click();
  await until(async () => (await runningCount(p)) === 0);

  // a client, a project and a tag can be made from the bar itself
  await fillDesc(p, 'Created inline');
  await bar(p).getByRole('button', { name: /^Project/ }).click();
  await p.getByLabel('Find a project').fill('Initech / Reports');
  await p.getByRole('option', { name: /Create project “Reports” for client “Initech”/ }).click();
  check((await bar(p).getByRole('button', { name: /^Project: Reports/ }).count()) === 1, 'typing "Client / Project" in the bar makes both and picks the project');
  const names = async (coll) => p.evaluate((c) => ['space/personal', 'space/work'].flatMap((id) => Object.values(window.__app.json(id, c)).map((r) => r.name)), coll);
  check((await names('clients')).includes('Initech') && (await names('projects')).includes('Reports'), 'the new client and project are in the space');
  await bar(p).getByRole('button', { name: /^Tags/ }).click();
  await p.getByLabel('Find or add a tag').fill('fresh-tag');
  await p.getByLabel('Find or add a tag').press('Enter');
  await p.keyboard.press('Escape');
  check((await bar(p).getByRole('button', { name: /^Tags: fresh-tag/ }).count()) === 1, 'a new tag is made and chosen from the bar');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).click();
  await until(async () => (await runningCount(p)) === 1);
  await stopRound(p).click();
  await until(async () => (await runningCount(p)) === 0);

  // Tags: one list; hiding only leaves the pickers; rename and remove are bulk edits with one Undo.
  const tagged = async (tag) => (await all(p)).filter((e) => (e.tags ?? []).includes(tag)).length;
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  const tagRow = (name) => p.locator('.tag-row', { has: p.locator('.tag-name', { hasText: new RegExp(`^${name}$`) }) });
  const tagAct = async (pg, name, item) => {
    await pg.getByRole('button', { name: `More actions for tag ${name}` }).click();
    await pg.getByRole('menuitem', { name: item, exact: true }).click();
  };
  await tagRow('fresh-tag').waitFor();
  check((await tagRow('fresh-tag').innerText()).includes('1 entry'), 'the tag list shows how many entries use a tag');
  await tagAct(p, 'fresh-tag', 'Hide from pickers');
  check((await tagRow('fresh-tag').innerText()).includes('hidden from pickers'), 'a hidden tag is marked in the list');
  check((await tagged('fresh-tag')) === 1, 'hiding leaves the tag on its entries');
  await p.getByRole('link', { name: 'Time', exact: true }).click();
  await openDetails(p);
  await bar(p).getByRole('button', { name: /^Tags/ }).click();
  check((await p.getByRole('option', { name: 'fresh-tag' }).count()) === 0, 'the hidden tag is not offered in the picker');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  await tagAct(p, 'fresh-tag', 'Show again');
  await tagAct(p, 'fresh-tag', 'Rename or merge');
  await p.getByLabel('New name for fresh-tag').fill('renamed-tag');
  check((await tagRow('fresh-tag').innerText()).includes('1 entry'), 'rename shows a count before it is applied');
  await tagRow('fresh-tag').getByRole('button', { name: 'Rename', exact: true }).click();
  check((await until(async () => (await tagged('renamed-tag')) === 1)) >= 0, 'rename rewrites the entries');
  check((await p.locator('.history-banner').count()) === 0, 'a bulk edit raises no history warning');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await tagged('fresh-tag')) === 1 && (await tagged('renamed-tag')) === 0)) >= 0, 'one Undo reverses the rename');
  await tagAct(p, 'fresh-tag', 'Remove from all items');
  check((await p.getByText(/Bulk edit: takes/).count()) === 1, 'remove says it is a bulk edit and counts what it changes');
  await p.getByRole('button', { name: 'Remove from all items', exact: true }).last().click();
  check((await until(async () => (await tagged('fresh-tag')) === 0)) >= 0, 'remove takes the tag off every entry');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await tagged('fresh-tag')) === 1)) >= 0, 'and one Undo brings it back');

  // Move to another space: archive here, create there, entries follow; one Undo.
  const projIn = (space, name) => p.evaluate(([sp, n]) => Object.values(window.__app.json(sp, 'projects')).filter((x) => x.name === n && !x.deleted).map((x) => x.active), [space, name]);
  const srcId = (await projIn('space/personal', 'Reports')).length ? 'space/personal' : 'space/work';
  const [src, dst] = srcId === 'space/personal' ? ['personal', 'work'] : ['work', 'personal'];
  const dstName = dst === 'work' ? 'Work' : 'Personal';
  await p.getByLabel('Show space').selectOption({ label: src === 'work' ? 'Work' : 'Personal' });
  await p.getByRole('button', { name: 'More actions for project Reports' }).click();
  await p.getByRole('menuitem', { name: 'Move to space…', exact: true }).click();
  await p.getByLabel('Space to move Reports to').selectOption({ label: dstName });
  await p.getByRole('group', { name: 'Move project Reports to another space' }).getByRole('button', { name: 'Move', exact: true }).click();
  check((await until(async () => (await projIn(`space/${dst}`, 'Reports')).length === 1)) >= 0, 'Move to space creates the project in the other space');
  check((await projIn(srcId, 'Reports'))[0] === false, 'and archives it in the source');
  check((await p.locator('.history-banner').count()) === 0, 'a move raises no history warning');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await projIn(`space/${dst}`, 'Reports')).length === 0 && (await projIn(srcId, 'Reports'))[0] === true)) >= 0, 'one Undo reverses the move');
  await tagAct(p, 'fresh-tag', 'Move to space…');
  await p.getByLabel('Space to move fresh-tag to').selectOption({ label: dstName });
  await p.getByRole('group', { name: 'Move tag fresh-tag to another space' }).getByRole('button', { name: 'Move', exact: true }).click();
  check((await tagRow('fresh-tag').innerText()).includes('hidden'), 'a moved tag is hidden in the source');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  await p.getByLabel('Show space').selectOption('all');

  // Bulk selection on Organize: tick a project and a tag, move both with one action, one Undo.
  await p.getByRole('button', { name: 'Select', exact: true }).click();
  await p.getByLabel(/^Select project Reports/).first().check();
  await p.getByLabel('Select tag fresh-tag').check();
  check((await p.getByRole('status').filter({ hasText: /\d+ selected/ }).innerText()).startsWith('2 selected') || (await p.getByRole('status').filter({ hasText: /\d+ selected/ }).innerText()).startsWith('3 selected'), 'selecting rows counts them in the bar');
  const moveBar = p.getByRole('toolbar', { name: 'Move selected to another space' });
  await moveBar.getByLabel('Space to move the selected items to').selectOption({ label: dstName });
  await moveBar.getByRole('button', { name: 'Move to space', exact: true }).click();
  check((await until(async () => (await projIn(`space/${dst}`, 'Reports')).length === 1)) >= 0, 'bulk move creates the selected project in the other space');
  check((await projIn(srcId, 'Reports'))[0] === false, 'and archives it in the source');
  check((await p.locator('.history-banner').count()) === 0, 'a bulk move raises no history warning');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await projIn(`space/${dst}`, 'Reports')).length === 0 && (await projIn(srcId, 'Reports'))[0] === true)) >= 0, 'one Undo reverses the bulk move');

  // entries view
  await p.evaluate(() => { location.hash = '#/time/week'; });
  await p.getByText('Week total').waitFor();
  const personalCount = (await all(p)).filter((e) => e.space === 'space/personal/time').length;
  // Every kept space is listed: Personal's entries and the one entry started in Work.
  check((await rows(p).count()) === personalCount + 2, `entries view shows this week, one row per entry of every space (${await rows(p).count()} of ${personalCount + 2})`);
  check((await p.locator('.te-row .te-space').count()) === (await rows(p).count()), 'with two spaces, every row carries its space name');
  await pickSpace(p, 'Personal');
  check((await rows(p).count()) === personalCount, 'the space filter narrows the list to one space');
  await pickSpace(p, 'all');
  check((await rows(p).count()) === personalCount + 2, 'and "All spaces" brings the rest back');
  await p.getByRole('button', { name: 'Previous week' }).click();
  check((await rows(p).count()) === 0, 'previous week is empty');
  await p.getByRole('button', { name: 'This week' }).click();
  check((await p.getByLabel('Hours format').count()) === 0, 'entries view has no hours format selector (it lives on Settings)');
  await p.evaluate(() => { location.hash = '#/settings'; });
  await p.getByLabel('Hours shown as').selectOption('hm');
  await p.evaluate(() => { location.hash = '#/time/week'; });
  await p.getByText('Week total').waitFor();
  check(/\d+:\d\d/.test(await p.locator('.section-head .total').innerText()), 'h:mm format set on Settings applies');
  await p.evaluate(() => { location.hash = '#/settings'; });
  await p.getByLabel('Hours shown as').selectOption('decimal');
  await p.evaluate(() => { location.hash = '#/time/week'; });
  await p.getByText('Week total').waitFor();

  // Bulk edit: select with checkboxes and Shift, change several entries at once, one Undo each.
  const rowCount = await rows(p).count();
  check(rowCount >= 4, `enough entries to select (${rowCount})`);
  const ids = await rows(p).evaluateAll((els) => els.map((e) => e.getAttribute('data-entry')));
  const find = async (id) => p.evaluate((i) => ['space/personal/time', 'space/work/time'].map((d) => window.__app.json(d, 'time_entries')[i]).find(Boolean), id);
  await startSelecting(p);
  const box = (i) => rows(p).nth(i).locator('.te-check');
  await box(0).click();
  await box(2).click({ modifiers: ['Shift'] });
  check((await p.locator('.bulk-count').innerText()) === '3 selected', 'a click and a Shift click select the range');
  await rows(p).nth(3).locator('.te-main').click({ modifiers: ['Control'] });
  check((await p.locator('.bulk-count').innerText()) === '4 selected', 'Ctrl click on a row adds it');
  await rows(p).nth(3).locator('.te-main').click({ modifiers: ['Control'] });
  check((await p.locator('.bulk-count').innerText()) === '3 selected', 'and takes it off again');
  const chosen = ids.slice(0, 3);
  const was = await Promise.all(chosen.map(find));
  await p.getByRole('button', { name: 'Billable', exact: true }).click();
  check((await until(async () => (await Promise.all(chosen.map(find))).every((e) => e.billable === true))) >= 0, 'Billable sets all selected entries');
  check((await p.locator('.history-banner').count()) === 0, 'a bulk edit raises no history warning');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await Promise.all(chosen.map(find))).every((e, i) => e.billable === was[i].billable))) >= 0, 'one Undo restores every entry');
  await p.getByRole('button', { name: 'Tags', exact: true }).click();
  await p.getByLabel('Tag', { exact: true }).fill('bulktag');
  await p.getByRole('button', { name: 'Add tag' }).click();
  check((await until(async () => (await Promise.all(chosen.map(find))).every((e) => e.tags.includes('bulktag')))) >= 0, 'Add tag puts the tag on every selected entry');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await Promise.all(chosen.map(find))).every((e) => !e.tags.includes('bulktag')))) >= 0, 'Undo takes it off again');
  await p.getByRole('button', { name: 'Move dates', exact: true }).click();
  await p.getByRole('button', { name: 'Earlier', exact: true }).click();
  const moved = (await Promise.all(chosen.map(find))).map((e) => e.start);
  check((await until(async () => (await Promise.all(chosen.map(find))).every((e, i) => Date.parse(e.start) === Date.parse(was[i].start) - 86400000))) >= 0, 'Earlier moves start and stop back a day');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await Promise.all(chosen.map(find))).every((e, i) => e.start === was[i].start))) >= 0, 'Undo puts the dates back');
  void moved;
  // On a Monday "Earlier" moves entries into last week, out of this week's list, which drops them
  // from the selection; they come back unselected after Undo. Select them again then.
  if ((await p.locator('.bulk-count').count()) === 0 || (await p.locator('.bulk-count').innerText()) !== `${chosen.length} selected`) {
    if ((await p.locator('.te-check').count()) === 0) await startSelecting(p);
    for (const id of chosen) {
      const box = p.locator(`li.entry[data-entry="${id}"] .te-check`);
      if (!(await box.isChecked())) await box.click();
    }
  }
  const live = async () => (await all(p)).length;
  const liveBefore = await live();
  await p.getByRole('button', { name: 'Delete', exact: true }).click();
  check((await until(async () => (await live()) === liveBefore - 3)) >= 0, 'Delete removes the selected entries');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await live()) === liveBefore)) >= 0, 'and one Undo brings them all back');
  check((await p.locator('.te-check').count()) === 0, 'deleting ends selecting');
  // Move to another space: the entries leave one space and arrive in the other.
  const inSpace = async (space) => (await all(p)).filter((e) => e.space === space).length;
  const personalRows = rows(p).filter({ has: p.locator('.te-space', { hasText: 'Personal' }) });
  const personalBefore = await inSpace('space/personal/time');
  const workBefore = await inSpace('space/work/time');
  await startSelecting(p);
  await personalRows.nth(0).locator('.te-check').click();
  await personalRows.nth(1).locator('.te-check').click();
  await p.getByRole('button', { name: 'Move to space' }).click();
  await p.getByLabel('Space to move the selected entries to').selectOption({ label: 'Work' });
  await p.getByRole('button', { name: 'Move', exact: true }).click();
  check((await until(async () => (await inSpace('space/work/time')) === workBefore + 2 && (await inSpace('space/personal/time')) === personalBefore - 2)) >= 0, 'Move to space moves the entries and leaves no copy');
  await p.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  check((await until(async () => (await inSpace('space/work/time')) === workBefore && (await inSpace('space/personal/time')) === personalBefore)) >= 0, 'and one Undo moves them back');

  // a tag used in two spaces is one row; rename asks which spaces and defaults to all
  const workRows = rows(p).filter({ has: p.locator('.te-space', { hasText: 'Work' }) });
  await startSelecting(p);
  await personalRows.nth(0).locator('.te-check').click();
  await workRows.nth(0).locator('.te-check').click();
  await p.getByRole('button', { name: 'Tags', exact: true }).click();
  await p.getByLabel('Tag', { exact: true }).fill('both');
  await p.getByRole('button', { name: 'Add tag' }).click();
  await until(async () => (await all(p)).filter((e) => (e.tags ?? []).includes('both')).length === 2);
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  check((await p.locator('.tag-row[data-tag="both"]').count()) === 1, 'a tag used in two spaces is one row');
  check(/Personal: 1 entry/.test(await p.locator('.tag-row[data-tag="both"]').innerText()) && /Work: 1 entry/.test(await p.locator('.tag-row[data-tag="both"]').innerText()), 'the row shows a count per space');
  await tagAct(p, 'both', 'Rename or merge');
  check((await p.getByLabel('Personal for both').isChecked()) && (await p.getByLabel('Work for both').isChecked()), 'rename starts with every space chosen');
  await p.getByLabel('New name for both').fill('everywhere');
  await p.getByLabel('New name for both').press('Enter');
  check((await until(async () => (await all(p)).filter((e) => (e.tags ?? []).includes('everywhere')).length === 2 && (await all(p)).every((e) => !(e.tags ?? []).includes('both')))) >= 0, 'renaming in all spaces at once changes both');

  // tags view: rename
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  await tagAct(p, 'deep', 'Rename or merge');
  await p.getByLabel('New name for deep').fill('focus');
  await p.getByLabel('New name for deep').press('Enter');
  await p.getByRole('link', { name: 'Time', exact: true }).click();
  await until(async () => (await lines(p).filter({ hasText: 'focus' }).count()) >= 1);
  check((await lines(p).filter({ hasText: 'focus' }).count()) >= 1, 'renaming a tag updates the entries');
  await p.close();
}

// ---- description combobox: fuzzy suggestions of past work (#60) ----
{
  const p = await open('combo', { clock: 'noon' });
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  await p.getByLabel('New project name').fill('Website');
  await p.getByRole('button', { name: 'Add project' }).click();
  await p.evaluate(() => { location.hash = '#/time'; });
  let d = await openDetails(p);
  await desc(p).fill('Review onboarding');
  await pickProject(p, d, 'Website');
  await addTag(p, d, 'ux');
  await desc(p).press('Enter');
  await stopRound(p).waitFor();
  await sleep(1100);
  await stopRound(p).click();
  await startRound(p).waitFor();
  await startRound(p).click();
  await stopRound(p).click();
  await startRound(p).waitFor();

  d = await openDetails(p);
  const box = desc(p);
  check((await box.getAttribute('role')) === 'combobox' && (await box.getAttribute('aria-autocomplete')) === 'list' && (await box.getAttribute('aria-expanded')) === 'false', 'description is a combobox, closed while nothing is typed');
  await box.fill('rev onb');
  const suggestions = (scope) => scope.getByRole('listbox', { name: 'Suggested past work' }).getByRole('option');
  const opts = suggestions(d);
  check(await poll(async () => (await opts.count()) === 1), 'typing "rev onb" offers one suggestion');
  const text = await opts.first().innerText();
  check(text.includes('Review onboarding') && text.includes('Website') && text.includes('ux'), `the suggestion shows description, project and tags (${text.replace(/\s+/g, ' ')})`);
  check((await box.getAttribute('aria-expanded')) === 'true' && (await box.getAttribute('aria-controls')) === (await d.getByRole('listbox').getAttribute('id')), 'aria-expanded and aria-controls point at the open listbox');
  await box.fill('reveiw onbaording');
  check(await poll(async () => (await opts.count()) === 1), 'a typo in each word still finds it');
  await box.fill('rev onb');
  await box.press('Escape');
  check(!(await opts.count()) || !(await opts.first().isVisible()), 'Esc closes the list');
  check((await detailsDialog(p).count()) === 1, 'the first Esc leaves the popover open');
  await box.fill('onb rev');
  await box.press('ArrowDown');
  const activeId = await box.getAttribute('aria-activedescendant');
  check(activeId && (await p.locator('#' + activeId).getAttribute('aria-selected')) === 'true', 'ArrowDown makes the first suggestion active (aria-activedescendant)');
  await box.press('Enter');
  check((await box.inputValue()) === 'Review onboarding' && (await detailsDialog(p).count()) === 1 && (await stopRound(p).count()) === 0, 'Enter picks: the field is filled, the popover stays open and nothing started');
  check((await d.getByRole('button', { name: /^Project/ }).first().innerText()).includes('Website') && (await d.getByRole('button', { name: /^Tags/ }).first().innerText()).includes('ux'), 'the pick fills the project and tags');
  await box.press('Enter');
  await stopRound(p).waitFor();
  const started = await all(p).then((a) => a.find((e) => e.stop === null));
  check(started && started.description === 'Review onboarding' && started.project_id && started.tags.includes('ux'), 'starting after the pick uses the picked project and tags');
  await stopRound(p).click();
  await startRound(p).waitFor();

  // A click picks too, and Add entry has the same field.
  d = await openDetails(p);
  await desc(p).fill('onboarding');
  await suggestions(d).first().click();
  check((await desc(p).inputValue()) === 'Review onboarding', 'a click on a suggestion picks it');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Add entry' }).click();
  const dlg = p.getByRole('dialog', { name: 'Add entry' });
  await dlg.getByLabel('Description', { exact: true }).fill('rev onb');
  check(await poll(async () => (await suggestions(dlg).count()) === 1), 'Add entry offers suggestions as well');
  await dlg.getByLabel('Description', { exact: true }).press('ArrowDown');
  await dlg.getByLabel('Description', { exact: true }).press('Enter');
  check((await dlg.getByRole('button', { name: /^Project/ }).first().innerText()).includes('Website'), 'picking in Add entry fills the project');
  await p.close();
}

// ---- entry menu: Move to space (#64) ----
{
  const p = await open('move', { clock: 'noon' });
  await p.evaluate(() => { location.hash = '#/settings/organize'; });
  await p.locator('.projects-page').waitFor();
  await p.getByLabel('New project name').fill('Moveable');
  await p.getByRole('button', { name: 'Add project', exact: true }).click();
  await p.evaluate(() => { location.hash = '#/time'; });
  const d = await openDetails(p);
  await desc(p).fill('Move me');
  await pickProject(p, d, 'Moveable');
  await desc(p).press('Enter');
  await stopRound(p).waitFor();
  await sleep(1100);
  await stopRound(p).click();
  await startRound(p).waitFor();
  const mine = (page) => page.evaluate(() => ['space/personal/time', 'space/work/time'].flatMap((id) => Object.values(window.__app.json(id, 'time_entries')).filter((e) => !e.deleted && e.description === 'Move me').map((e) => ({ ...e, space: id }))));
  check((await mine(p)).length === 1 && (await mine(p))[0].space === 'space/personal/time', 'the entry starts in Personal');
  const row = line(p, 'Move me');
  await row.hover();
  await row.getByRole('button', { name: 'More actions: Move me' }).click();
  check((await p.getByRole('menuitem', { name: 'Move to Personal' }).count()) === 0 && (await p.getByRole('menuitem', { name: 'Move to Work' }).count()) === 1, 'the menu offers the other space only');
  await p.getByRole('menuitem', { name: 'Move to Work' }).click();
  check(await poll(async () => { const m = await mine(p); return m.length === 1 && m[0].space === 'space/work/time' && m[0].project_id; }), 'Move to Work: one live entry in Work, with its project made there');
  const toast = p.getByRole('status').filter({ hasText: 'Moved 1 entry to Work' });
  check((await toast.count()) >= 1, 'a message confirms the move');
  await p.getByRole('button', { name: 'Undo' }).click();
  check(await poll(async () => { const m = await mine(p); return m.length === 1 && m[0].space === 'space/personal/time'; }), 'Undo puts it back');
  await p.close();
}

// ---- narrow screens: 375 px phone, 360 px "mini" window ----
for (const viewport of [{ width: 375, height: 800 }, { width: 360, height: 560 }]) {
  const w = viewport.width;
  const p = await open(`narrow-${w}`, { viewport });
  // Narrow, the idle pill is only its round button: start at once, then name the running entry in the popover.
  const startNamed = async (text) => {
    await startRound(p).click();
    await fillDesc(p, text);
    await bar(p).getByRole('button', { name: 'Update', exact: true }).click();
  };
  for (let i = 0; i < 12; i++) {
    await startNamed(`Narrow entry ${i % 3} with a long description that cannot fit on one line here`);
    await stopRound(p).click();
  }
  await startNamed('Running on a narrow screen with a long description too');
  await stopRound(p).waitFor();
  const stopBox = await stopRound(p).boundingBox();
  check(stopBox && stopBox.x >= 0 && stopBox.x + stopBox.width <= w && stopBox.y < viewport.height, `${w} px: the pill's stop button is on screen (${JSON.stringify(stopBox)})`);
  const pillBox = await pill(p).boundingBox();
  check(pillBox && pillBox.width > w - 40, `${w} px: the running pill takes its own full-width row (${Math.round(pillBox?.width)})`);
  await line(p, 'Narrow entry 0').locator('.te-line').first().click({ position: { x: 4, y: 4 } });
  await openDetails(p);
  await bar(p).getByRole('button', { name: /^Project/ }).click();
  await p.locator('.picker').waitFor();
  await sleep(150); // effects (the Esc listener) run after the next frame
  await p.keyboard.press('Escape');
  check((await detailsDialog(p).count()) === 1, `${w} px: Esc closes only the project list, not the popover under it`);
  await p.keyboard.press('Escape');
  for (const view of ['time', 'time/week', 'organize']) {
    await p.evaluate((v) => { location.hash = `#/${v}`; }, view);
    await sleep(300);
    const o = await overflow(p);
    check(o <= 0, `${w} px: no horizontal scroll on ${view} (${o})`);
  }
  await p.evaluate(() => { location.hash = '#/time/week'; });
  await startSelecting(p);
  await p.locator('.te-check').first().click();
  await p.getByRole('button', { name: 'Set project' }).click();
  await p.getByRole('button', { name: 'Move dates' }).click();
  const oBulk = await overflow(p);
  check(oBulk <= 0, `${w} px: no horizontal scroll with the action bar open (${oBulk})`);
  await p.evaluate(() => { location.hash = '#/time'; });
  await sleep(300);
  await p.mouse.wheel(0, 2000);
  await sleep(300);
  const header = await p.locator('.timer-pill').getByRole('button', { name: 'Stop timer' }).boundingBox();
  check(header && header.y >= 0 && header.y + header.height <= viewport.height && header.x + header.width <= w, `${w} px: after scrolling the list, the header's stop button is still on screen`);
  await p.close();
}

// ---- touch: row actions always visible ----
{
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const p = await context.newPage();
  p.on('pageerror', (e) => fail(`touch pageerror: ${e.message}`));
  await p.goto(`${BASE}?test#/time`);
  await pill(p).waitFor();
  await startRound(p).tap();
  await fillDesc(p, 'Touch');
  await bar(p).getByRole('button', { name: 'Update', exact: true }).tap();
  await stopRound(p).tap();
  const actions = p.locator('.te-row .te-actions').first();
  await actions.waitFor();
  check((await actions.evaluate((el) => getComputedStyle(el).opacity)) === '1' && (await actions.getByRole('button', { name: 'Continue: Touch' }).isVisible()), 'on a touch screen continue and more actions are always visible');
  // A tap anywhere on the row, the description included, opens the editor in a bottom sheet.
  const touchRow = p.locator('.te-row').first();
  check((await touchRow.getByRole('button', { name: /^Description of|^Duration of|^Project of|^Add project/ }).count()) === 0, 'phone: the row has no inline edit controls');
  await touchRow.locator('.te-desc').tap();
  const sheet = p.getByRole('dialog', { name: 'Edit Touch' });
  await sheet.waitFor({ timeout: 3000 }).catch(() => {});
  check(await sheet.isVisible(), 'phone: tapping the row opens the editor in a sheet');
  await sleep(400); // the slide-in animation
  check((await touchRow.locator(':scope > .edit-panel').count()) === 0, 'phone: the editor does not expand inside the list');
  const sheetBox = await sheet.boundingBox();
  check(sheetBox && Math.abs(sheetBox.y + sheetBox.height - 800) <= 1 && sheetBox.width >= 389, `phone: the sheet sits along the bottom edge (${JSON.stringify(sheetBox)})`);
  check(await p.evaluate(() => document.activeElement?.closest('dialog.sheet') !== null), 'phone: focus moves into the sheet');
  await sheet.getByLabel('Entry Description').fill('Touch edited');
  await sheet.getByLabel('Entry Description').press('Enter');
  await until(async () => (await all(p)).some((e) => e.description === 'Touch edited'));
  check((await all(p)).some((e) => e.description === 'Touch edited'), 'phone: an edit in the sheet saves');
  await p.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
  check(!(await sheet.isVisible()), 'phone: Escape closes the sheet');
  // A tap on the backdrop (above the sheet) closes it; so does a swipe down on the handle.
  await touchRow.locator('.te-line').tap({ position: { x: 4, y: 4 } });
  await sheet.waitFor();
  await p.mouse.click(195, 20);
  await sheet.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
  check(!(await sheet.isVisible()), 'phone: a tap on the backdrop closes the sheet');
  await touchRow.locator('.te-line').tap({ position: { x: 4, y: 4 } });
  await sheet.waitFor();
  await sleep(400);
  const handle = await sheet.locator('.sheet-handle').boundingBox();
  await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await p.mouse.down();
  await p.mouse.move(handle.x + handle.width / 2, handle.y + 150, { steps: 5 });
  await p.mouse.up();
  await sheet.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
  check(!(await sheet.isVisible()), 'phone: a swipe down on the handle closes the sheet');
  check((await overflow(p)) <= 0, '390 px: no horizontal scroll after the sheet');
  // A long press on a row starts selecting (a touch screen has no Ctrl or Shift).
  await p.locator('.te-row .te-line').first().evaluate(async (el) => {
    const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', bubbles: true, clientX: 20, clientY: 20 }));
    fire('pointerdown');
    await new Promise((r) => setTimeout(r, 650));
    fire('pointerup');
  });
  await p.locator('.te-row .te-line').first().click();
  check((await p.locator('.bulk-count').innerText()) === '1 selected' && (await p.locator('.bulk-bar').isVisible()), 'a long press selects the row and shows the action bar');
  check((await overflow(p)) <= 0, '390 px: the action bar fits the screen');
  await context.close();
}

// ---- idle banner (fake clock jumps 15 minutes) ----
{
  const p = await open('idle', { clock: true });
  await fillDesc(p, 'Idle test');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).click();
  await p.clock.fastForward('02:00');
  await p.clock.fastForward('15:00');
  const banner = p.getByRole('alertdialog', { name: 'Idle time' });
  await banner.waitFor({ timeout: 5000 }).catch(() => {});
  check(await banner.isVisible(), 'idle banner appears after a 15 minute gap');
  if (await banner.isVisible()) {
    await banner.getByRole('button', { name: 'Discard and continue' }).click();
    await until(async () => (await all(p)).length === 2);
    check((await all(p)).length === 2 && (await runningCount(p)) === 1, 'discard and continue: old entry stopped at the gap, a new one running');
    check(!(await banner.isVisible()), 'banner closes');
  }
  await p.close();
}

// ---- two paired profiles ----
{
  const mk = async (n) => {
    const page = await open(n, { hash: '#/devices' });
    await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
    await page.locator('input[aria-label="Connection server"]').fill(mock.url);
    return page;
  };
  const a = await mk('A');
  const b = await mk('B');
  const st = (p) => p.evaluate(() => window.__app.state());
  await startSyncing(a);
  await joinByInvite(a, b);
  const t = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
  check(t >= 0, `paired and connected in ${t} ms`);

  for (const p of [a, b]) await p.evaluate(() => { location.hash = '#/time'; });
  await fillDesc(a, 'From A');
  await b.evaluate(() => { location.hash = '#/notes'; });
  await b.getByLabel('Space', { exact: true }).selectOption({ label: 'Work' });
  await b.evaluate(() => { location.hash = '#/time'; });
  await fillDesc(b, 'From B');
  // Both start right after the link drops (reconnecting takes longer than two clicks), in
  // different spaces, so each device has a running timer the other has not seen.
  await a.evaluate(() => window.__app.dropLink());
  await bar(a).getByRole('button', { name: 'Start', exact: true }).click();
  await bar(b).getByRole('button', { name: 'Start', exact: true }).click();
  const apart = (await runningCount(a)) === 1 && (await runningCount(b)) === 1 && (await a.evaluate(() => window.__app.state())) !== 'connected';
  check(apart, 'each profile had its own running timer while the link was down');
  const snap = (p) => p.evaluate(() => JSON.stringify(['space/personal/time', 'space/work/time'].map((id) => Object.entries(window.__app.json(id, 'time_entries')).sort().map(([k, v]) => [k, v.stop, v.deleted]))));
  const converged = await until(async () => {
    const [ra, rb] = await Promise.all([runningCount(a), runningCount(b)]);
    return ra === 1 && rb === 1 && (await snap(a)) === (await snap(b));
  }, 30000);
  check(converged >= 0, `both profiles started timers and converged to one running timer in ${converged} ms`);
  const stoppedA = await a.evaluate(() => Object.values(window.__app.json('space/personal/time', 'time_entries')).find((e) => e.description === 'From A'));
  check(stoppedA && stoppedA.stop !== null, 'the older timer (A) was stopped, the later one (B) kept running');
    check((await stopRound(a).count()) === 1, 'profile A shows the timer running in the other space');
  await a.close();
  await b.close();
}

await finish(browser, mock);
