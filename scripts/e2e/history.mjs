// End-to-end: version history of time entries. The device logs its changes; many entries deleted at
// once raise a banner whose Review shows the moment before; chosen entries come back as new edits
// and everything else stays; thresholds are set in Settings.
//
//   npm run e2e history
//
import { BASE, launch, check, watchPage, until, finish, newNote } from './lib.mjs';

const browser = await launch();
const p = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
watchPage(p, 'A');
await p.goto(BASE + '?test#/time');
await p.waitForFunction(() => window.__history && window.__app && window.__backup);

const h = (fn, ...args) => p.evaluate(([f, a]) => window.__history[f](...a), [fn, args]);
const privateId = async () => {
  const id = await p.evaluate(() => window.__app.spaces().personal);
  return `space/${id}/private`;
};
const entries = async () => h('entries', 'personal');
const live = async (prefix) => (await entries()).filter((e) => e.description.startsWith(prefix) && !e.deleted).length;

// The log: a baseline when recording began, then one merged segment per flush.
check((await until(async () => (await h('count', await privateId())) >= 1)) >= 0, 'recording starts with a baseline segment for each space');
const before = await h('count', await privateId());
await h('addEntries', 'personal', 12, 'Bulk');
await h('flush');
check((await until(async () => (await h('count', await privateId())) === before + 1)) >= 0, 'twelve new entries are one merged segment');
check((await p.locator('.history-banner').count()) === 0, 'creating entries raises no warning');

// A few deletions are normal; no banner.
await h('setOffset', 5 * 60_000);
await h('renameEntries', 'personal', 'Bulk 0', 'Bulk zero');
check((await p.locator('.history-banner').count()) === 0, 'one edit raises no warning');

// Many deleted at once: the banner appears, from this device.
await h('deleteEntries', 'personal', 'Bulk');
await p.locator('.history-banner').waitFor();
check((await p.locator('.history-banner').innerText()).includes('this device') && /\d+ deleted/.test(await p.locator('.history-banner').innerText()), 'deleting 12 entries at once raises a banner naming this device');
await h('flush');

// Review opens History at the moment before and lists what was deleted since.
await p.getByRole('button', { name: 'Review' }).click();
check((await until(async () => /#\/settings\/version-history\/\d+/.test(p.url()))) >= 0, 'Review opens Go back in time');
await p.locator('.history-row').first().waitFor();
check((await p.locator('.history-row').count()) === 12, 'it lists the 12 entries as deleted since');
check((await p.locator('.history-kind', { hasText: 'Deleted since' }).count()) === 12, 'each marked "Deleted since"');
check((await p.locator('.history-banner').count()) === 0, 'the banner is gone once reviewed');

// Restore two of them: they come back as new edits, the others stay deleted.
await p.getByLabel('Restore Bulk 3').check();
await p.getByLabel('Restore Bulk 4').check();
await p.getByRole('button', { name: /^Restore selected \(2\)/ }).click();
await p.getByRole('group', { name: 'Confirm restore' }).getByRole('button', { name: 'Restore', exact: true }).click();
check((await until(async () => (await live('Bulk')) === 2)) >= 0, 'only the two chosen entries are back');
const back = (await entries()).find((e) => e.description === 'Bulk 3');
check(back && back.deleted === false && !('deleted_at' in back) && typeof back.restored_at === 'string', 'a restored entry says it came from history');
check((await until(async () => (await p.locator('.history-row').count()) === 10)) >= 0, 'the list shows the 10 still deleted');

// Browse the log: days with changes, then the points of a day; a point sets the compared time.
await p.locator('.history-day').first().click();
await p.locator('.history-point').first().waitFor();
const pointTexts = await p.locator('.history-point').allInnerTexts();
check(pointTexts.some((t) => t.includes('12 entries') && t.includes('This device')), `a day lists its points with a summary and the device (${pointTexts.join(' | ')})`);
check(pointTexts.some((t) => t.includes('Before restore')), 'a restore leaves a "Before restore" point');
await p.locator('.history-point', { hasText: '12 entries' }).first().click();
check(await p.locator('.history-point.active').count() === 1, 'choosing a point marks it');
check((await until(async () => (await p.locator('.history-row').count()) === 10)) >= 0, 'a point shows what differed then versus now');

// An earlier time than the log begins.
await p.getByLabel('As of').fill('2020-01-01T10:00');
check((await until(async () => (await p.getByText('before this device began recording').count()) === 1)) >= 0, 'a time before the log begins is said so');

// Opened without a time, the page starts where the log begins (a week ago would read as an error on a new device).
await p.evaluate(() => { location.hash = '#/settings'; });
await p.evaluate(() => { location.hash = '#/settings/version-history/open'; });
await p.getByText('Recorded on: This device, from').waitFor();
check((await until(async () => (await p.getByText('before this device began recording').count()) === 0)) >= 0, 'by default the page does not say the time is before the log begins');

// Thresholds are settings: with 3 as the limit, three deletions warn.
await p.evaluate(() => { location.hash = '#/settings/version-history'; });
await p.locator('details > summary', { hasText: 'Warnings when many' }).click();
await p.getByLabel('Warn when this many entries are deleted within a minute').fill('3');
await p.getByLabel('Warn when this many entries are deleted within a minute').blur();
// The watch reads the limit when entries are deleted: be sure it is stored first (a loaded machine can lag).
check((await until(() => p.evaluate(() => window.__app.json(`account/${window.__app.accountId()}`, 'settings')?.history_deleted === 3))) >= 0, 'the lower limit is stored');
await h('addEntries', 'personal', 3, 'Few');
await h('setOffset', 20 * 60_000);
await h('deleteEntries', 'personal', 'Few');
await p.locator('.history-banner').waitFor();
check((await p.locator('.history-banner').innerText()).includes('3 deleted'), 'a lower limit in Settings warns on a smaller batch');

// ---- Notes: version history, a named version, restore, and Recently deleted.
await p.evaluate(() => { location.hash = '#/notes'; });
const noteList = async () => p.evaluate(() => Object.values(window.__app.json('space/personal', 'notes')));
const noteText = async () => (await noteList()).find((n) => n.path === 'Plan.md' && !n.deleted)?.text ?? '';
await newNote(p);
await p.locator('input[aria-label="Note title"]').waitFor();
await p.keyboard.type('Plan');
await p.keyboard.press('Enter');
await until(async () => (await noteText()) !== '');
await p.locator('.cm-content').click();
await p.keyboard.type('first draft');
await until(async () => (await noteText()).includes('first draft'));
await h('flush');
await h('setOffset', 40 * 60_000);
await p.keyboard.type(' and a second part');
await until(async () => (await noteText()).includes('second part'));
await h('flush');

await p.getByRole('button', { name: 'More actions for this note' }).click();
await p.getByRole('menuitem', { name: 'Version history…' }).click();
await p.locator('dialog.note-history').waitFor();
check((await until(async () => (await p.locator('.nh-list li').count()) >= 2)) >= 0, 'the note menu opens a list of earlier versions');
await p.getByLabel('Name for this version').fill('With two parts');
await p.getByRole('button', { name: 'Save named version' }).click();
check((await until(async () => (await p.locator('.nh-badge', { hasText: 'With two parts' }).count()) === 1)) >= 0, 'a version can be named');
await p.locator('.nh-list button', { hasText: 'first draft' }).filter({ hasNotText: 'same as now' }).last().click();
check((await p.locator('.nh-added', { hasText: 'second part' }).count()) >= 1, 'the difference shows what was added since (second part)');
await p.getByRole('button', { name: 'Restore this version' }).click();
check((await until(async () => { const t = await noteText(); return t.includes('first draft') && !t.includes('second part'); })) >= 0, 'restoring puts the older text back as an edit');

// A named version keeps its own text: restore it, and the second part returns.
await p.getByRole('button', { name: 'More actions for this note' }).click();
await p.getByRole('menuitem', { name: 'Version history…' }).click();
await p.locator('.nh-badge', { hasText: 'With two parts' }).click();
await p.getByRole('button', { name: 'Restore this version' }).click();
check((await until(async () => (await noteText()).includes('second part'))) >= 0, 'a named version restores its own text');

// Recently deleted notes.
await p.getByRole('button', { name: 'More actions for this note' }).click();
await p.getByRole('menuitem', { name: 'Delete note' }).click();
await p.locator('details.deleted-notes summary').click();
check((await p.locator('details.deleted-notes').innerText()).includes('Plan.md'), 'a deleted note is listed under Recently deleted');
await p.getByRole('button', { name: 'Restore Plan.md' }).click();
check((await until(async () => (await noteText()).includes('second part'))) >= 0, 'Restore brings it back with its text');

// ---- History tab covers notes and tasks too.
const histMark = Date.now() + 50 * 60_000;
await h('flush');
await p.evaluate(() => { location.hash = '#/notes'; });
if ((await p.getByRole('button', { name: 'More actions for this note' }).count()) === 0) await p.getByText('Plan', { exact: true }).first().click();
await h('flush');
await h('setOffset', 60 * 60_000);
await p.getByRole('button', { name: 'More actions for this note' }).click();
await p.getByRole('menuitem', { name: 'Delete note' }).click();
await h('flush');
await p.evaluate((ms) => { location.hash = `#/settings/version-history/${ms}`; }, histMark);
await p.locator('.history-notes .history-row').first().waitFor();
check((await p.locator('.history-notes .history-row', { hasText: 'Plan.md' }).innerText()).includes('Deleted since'), 'History lists a note deleted since');
check(/notes and tasks/i.test(await p.locator('.history-page .hint').first().innerText()), 'the page says it covers notes and tasks');
await p.getByLabel('Restore Plan.md').check();
await p.getByRole('button', { name: /^Restore selected \(1\)/ }).click();
await p.getByRole('group', { name: 'Confirm restore' }).getByRole('button', { name: 'Restore', exact: true }).click();
check((await until(async () => (await noteText()).includes('second part'))) >= 0, 'restoring a note from History brings it back with its text');

await finish(browser);
