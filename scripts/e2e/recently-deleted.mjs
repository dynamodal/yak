// End-to-end: Recently deleted (#107, B-107) across two devices.
//
//   npm run e2e recently-deleted
//
// A and B are paired. A deletes one item of every kind (time entry, note, project, client, tag, file in a note);
// B lists all six in Settings › Recently deleted, with the 45 days stated per kind, and restores each; A sees it back.
// Delete for good on B asks first, then clears the note and the file on both devices: A keeps only a tombstone, the
// file's bytes go on both, and nothing comes back. The synced setting "Delete files for good straight away" set on B
// makes A delete a file for good at once. Placeholder data only. Screenshots go to RD_SHOTS_DIR when set (never the repo).
import { BASE, launch, startMock, check, fail, watchPage, until, finish, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const SPACE = 'space/personal';
const TIME = 'space/personal/time';
const SHOTS = process.env.RD_SHOTS_DIR;
const mock = await startMock();
const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'], viewport: { width: 1100, height: 900 } })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
  await page.locator('input[aria-label="Connection server"]').fill(mock.url);
  return page;
};
const a = await mk('A');
const b = await mk('B');
const st = (p) => p.evaluate(() => window.__app?.state());
const json = (p, id, map) => p.evaluate(([i, m]) => window.__app.json(i, m), [id, map]);
const rec = async (p, id, map, key) => (await json(p, id, map))?.[key];
const bytes = (p) => p.evaluate(([i]) => window.__app.fileBytes(i), [SPACE]);
const now = new Date().toISOString();
const hour = new Date(Date.now() - 3600_000).toISOString();

try {
  await startSyncing(a);
  await joinByInvite(a, b);
  check((await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000)) >= 0, 'paired and connected');

  // One item of every kind on A, with placeholder names.
  const ids = await a.evaluate(
    ([space, time, at, start]) => {
      const add = window.__app.addRecord;
      return {
        project: add(space, 'projects', { name: 'Sample project', client_id: null, color: '#336699', billable: false, rate: null, currency: 'USD', active: true, created_at: at, updated_at: at, deleted: false }),
        client: add(space, 'clients', { name: 'Sample client', archived: false, created_at: at, updated_at: at, deleted: false }),
        tag: add(space, 'tags', { name: 'sample-tag', created_at: at, deleted: false }),
        note: add(space, 'notes', { path: 'Sample note.md', text: 'Placeholder text', created_at: at, updated_at: at, deleted: false }),
        entry: add(time, 'time_entries', { start, stop: at, duration: 3600, description: 'Sample entry', project_id: null, task_id: null, tags: [], billable: false, device_id: 'e2e', created_at: at, updated_at: at, deleted: false }),
      };
    },
    [SPACE, TIME, now, hour],
  );
  await a.evaluate(([id]) => window.__app.addFile(id, 'sample.txt', 'placeholder file'), [SPACE]);
  const hash = Object.keys((await json(a, SPACE, 'attachments')) ?? {})[0];
  check(!!hash, 'A added a file');
  check((await until(async () => (await bytes(b)) === 'placeholder file'.length, 30000)) >= 0, 'B received the file');
  check((await until(async () => !!(await rec(b, TIME, 'time_entries', ids.entry)), 15000)) >= 0, 'B has the records');

  for (const [kind, map, doc, id] of [
    ['projects', 'projects', SPACE, ids.project],
    ['clients', 'clients', SPACE, ids.client],
    ['tags', 'tags', SPACE, ids.tag],
    ['notes', 'notes', SPACE, ids.note],
    ['time_entries', 'time_entries', TIME, ids.entry],
    ['files', 'attachments', SPACE, hash],
  ]) {
    await a.evaluate(([d, k, i]) => window.__app.trash(d, k, i), [doc, kind, id]);
    check(typeof (await rec(a, doc, map, id))?.deleted_at === 'string', `A deleted the ${kind} with a date`);
  }

  await b.goto(BASE + '?test#/settings/recently-deleted');
  const section = b.locator('[data-recently-deleted]');
  const rows = section.locator('li.rd-row');
  check((await until(async () => (await rows.count()) === 6, 15000)) >= 0, `B lists all six deleted items (${await rows.count()})`);
  for (const kind of ['time_entries', 'notes', 'projects', 'clients', 'tags', 'files']) {
    const group = section.locator(`[data-kind="${kind}"]`);
    check((await group.locator('li.rd-row').count()) === 1, `one ${kind} row`);
    check(/Kept 45 days/.test(await group.locator('p.hint').first().innerText()), `the ${kind} group states 45 days once`);
  }
  check(/Deleted .+ · goes /.test(await rows.first().innerText()), 'a row says when it was deleted and when it goes');
  check((await bytes(b)) === 'placeholder file'.length && (await bytes(a)) === 'placeholder file'.length, 'the deleted file keeps its bytes on both devices');
  if (SHOTS) await section.screenshot({ path: `${SHOTS}/recently-deleted-b.png` });

  // Restore each kind on B; A sees it back.
  for (const [title, map, doc, id] of [
    ['Sample entry', 'time_entries', TIME, ids.entry],
    ['Sample note', 'notes', SPACE, ids.note],
    ['Sample project', 'projects', SPACE, ids.project],
    ['Sample client', 'clients', SPACE, ids.client],
    ['sample-tag', 'tags', SPACE, ids.tag],
    ['sample.txt', 'attachments', SPACE, hash],
  ]) {
    const button = b.getByRole('button', { name: `Restore ${title}`, exact: true });
    await until(async () => (await button.count()) === 1 && (await button.isEnabled()), 10000);
    await button.click();
    check((await until(async () => (await rec(a, doc, map, id))?.deleted === false, 15000)) >= 0, `restored on B, ${title} is back on A`);
  }
  check((await until(async () => (await rows.count()) === 0)) >= 0, 'nothing is left in the list');

  // Delete for good on B: the note and the file.
  await a.evaluate(([s, n, h]) => (window.__app.trash(s, 'notes', n), window.__app.trash(s, 'files', h)), [SPACE, ids.note, hash]);
  check((await until(async () => (await rows.count()) === 2, 15000)) >= 0, 'B lists the note and the file again');
  await b.getByRole('button', { name: 'Delete Sample note for good', exact: true }).click();
  const ask = section.locator('.rd-confirm');
  check(/for good on all your devices.+Older backups and this device’s Version history may still hold a copy/s.test(await ask.innerText()), 'Delete for good asks first and names what may still hold a copy');
  if (SHOTS) await section.locator('[data-kind="notes"]').screenshot({ path: `${SHOTS}/recently-deleted-confirm.png` });
  check(typeof (await rec(b, SPACE, 'notes', ids.note))?.path === 'string', 'nothing is cleared before the confirmation');
  await ask.getByRole('button', { name: 'Delete for good' }).click();
  await b.getByRole('button', { name: 'Delete sample.txt for good', exact: true }).click();
  await section.locator('.rd-confirm').getByRole('button', { name: 'Delete for good' }).click();
  check((await until(async () => (await rows.count()) === 0)) >= 0, 'both leave B’s list');
  const tomb = async (p) => {
    const n = await rec(p, SPACE, 'notes', ids.note);
    const f = await rec(p, SPACE, 'attachments', hash);
    return !!n && Object.keys(n).sort().join() === 'deleted,purged_at' && !!f && Object.keys(f).sort().join() === 'deleted,purged_at';
  };
  check((await until(() => tomb(a), 15000)) >= 0, 'A keeps only tombstones: no text, path or file name');
  check(await tomb(b), 'B too');
  check((await until(async () => (await bytes(a)) === 0 && (await bytes(b)) === 0, 15000)) >= 0, 'the file’s bytes are gone on both devices');
  await a.goto(BASE + '?test#/settings/recently-deleted');
  await a.locator('[data-recently-deleted]').waitFor();
  check((await a.locator('[data-recently-deleted] li.rd-row').count()) === 0, 'A’s list does not show them either');
  await a.reload();
  await a.waitForFunction(() => window.__app);
  check(await tomb(a), 'after a reload nothing came back');

  // The synced setting: on at B, A deletes a file for good straight away.
  await b.locator('input[data-setting="delete-files-now"]').check();
  check((await until(async () => (await json(a, 'account', 'settings'))?.delete_files_now === true || (await a.evaluate(() => document.querySelector('input[data-setting="delete-files-now"]')?.checked)), 15000)) >= 0, 'the setting reached A');
  await a.evaluate(([id]) => window.__app.addFile(id, 'other.txt', 'another placeholder'), [SPACE]);
  const other = Object.entries((await json(a, SPACE, 'attachments')) ?? {}).find(([, v]) => v.name === 'other.txt')?.[0];
  await a.evaluate(([s, h]) => window.__app.trash(s, 'files', h), [SPACE, other]);
  check((await until(async () => (await bytes(a)) === 0 && !!(await rec(a, SPACE, 'attachments', other))?.purged_at, 15000)) >= 0, 'with the setting on, A deleted it for good at once');
} catch (e) {
  fail(String(e));
}
await finish(browser, mock);
