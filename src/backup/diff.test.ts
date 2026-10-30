import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collection, createRecord, softDelete, updateRecord } from '../core/schema';
import { attachmentsMap } from '../core/blobs/attachments';
import { countByKind, countsText, diffBackup, type DiffItem } from './diff';

const SPACE = 'space/0123456789abcdef01234567';
const PRIVATE = `${SPACE}/private`;

/** A device's documents and a backup taken from them; later edits go to `docs` only. */
function setup() {
  const space = new Y.Doc();
  const priv = new Y.Doc();
  const docs = new Map([
    [SPACE, space],
    [PRIVATE, priv],
  ]);
  const backup = () => [...docs].map(([id, d]) => ({ id, update: Y.encodeStateAsUpdate(d) }));
  return { space, priv, docs, backup };
}

const titles = (items: DiffItem[]) => items.map((i) => `${i.kind}:${i.title}`).sort();

function addFile(doc: Y.Doc, hash: string, name: string): void {
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    attachmentsMap(doc).set(hash, m);
    m.set('name', name);
    m.set('size', 3);
    m.set('created_at', '2026-10-01T00:00:00Z');
  });
}

describe('diffBackup', () => {
  it('finds nothing when the backup is the current state', async () => {
    const { space, priv, docs, backup } = setup();
    createRecord(priv, 'time_entries', { description: 'Write', start: '2026-10-01T09:00:00Z', deleted: false });
    createRecord(space, 'notes', { path: 'A.md', deleted: false });
    const d = await diffBackup(docs, backup());
    expect(d.merge).toEqual({ added: [], removed: [], changed: [] });
    expect(d.replace).toEqual({ added: [], removed: [], changed: [] });
  });

  it('per kind: Replace removes what was made after the backup, Merge removes nothing', async () => {
    const { space, priv, docs, backup } = setup();
    createRecord(space, 'notes', { path: 'Old.md', deleted: false });
    const b = backup();
    createRecord(priv, 'time_entries', { description: 'Later entry', start: '2026-10-02T09:00:00Z', deleted: false });
    createRecord(space, 'notes', { path: 'Later.md', deleted: false });
    createRecord(space, 'projects', { name: 'Later project', deleted: false });
    createRecord(space, 'clients', { name: 'Later client', deleted: false });
    createRecord(space, 'tags', { name: 'later', deleted: false });
    addFile(space, 'h1', 'later.png');
    space.getMap('settings').set('week_start', 'sunday');
    const d = await diffBackup(docs, b);
    expect(titles(d.replace.removed)).toEqual([
      'clients:Later client',
      'files:later.png',
      'notes:Later.md',
      'projects:Later project',
      'settings:week_start',
      'tags:later',
      'time_entries:Later entry',
    ]);
    expect(d.replace.added).toEqual([]);
    expect(d.merge).toEqual({ added: [], removed: [], changed: [] });
    expect(countByKind(d.replace.removed)).toMatchObject({ time_entries: 1, notes: 1, projects: 1, clients: 1, tags: 1, files: 1, settings: 1 });
    expect(d.replace.removed.find((i) => i.kind === 'time_entries')?.start).toBe('2026-10-02T09:00:00Z');
  });

  it('Merge and Replace both bring back what was deleted since the backup', async () => {
    const { space, priv, docs, backup } = setup();
    const entry = createRecord(priv, 'time_entries', { description: 'Gone', deleted: false });
    const note = createRecord(space, 'notes', { path: 'Gone.md', deleted: false });
    addFile(space, 'h2', 'gone.pdf');
    const b = backup();
    softDelete(priv, 'time_entries', entry);
    softDelete(space, 'notes', note);
    attachmentsMap(space).get('h2')?.set('deleted', true);
    const d = await diffBackup(docs, b);
    // A Yjs merge keeps the later delete; Replace makes the device the backup.
    expect(d.merge.added).toEqual([]);
    expect(titles(d.replace.added)).toEqual(['files:gone.pdf', 'notes:Gone.md', 'time_entries:Gone']);
  });

  it('Merge adds what only the backup holds, from another device', async () => {
    const { space, docs } = setup();
    createRecord(space, 'notes', { path: 'Here.md', deleted: false });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(space));
    createRecord(other, 'notes', { path: 'There.md', deleted: false });
    createRecord(other, 'projects', { name: 'There', deleted: false });
    const d = await diffBackup(docs, [{ id: SPACE, update: Y.encodeStateAsUpdate(other) }]);
    expect(titles(d.merge.added)).toEqual(['notes:There.md', 'projects:There']);
    expect(titles(d.replace.added)).toEqual(['notes:There.md', 'projects:There']);
    expect(d.replace.removed).toEqual([]);
  });

  it('a changed record counts as changed, not as added and removed', async () => {
    const { space, docs, backup } = setup();
    const id = createRecord(space, 'projects', { name: 'Acme', color: '#000000', deleted: false });
    const b = backup();
    updateRecord(space, 'projects', id, { color: '#ffffff' });
    const d = await diffBackup(docs, b);
    expect(titles(d.replace.changed)).toEqual(['projects:Acme']);
    expect(d.replace.added).toEqual([]);
    expect(d.replace.removed).toEqual([]);
    expect(d.merge.changed).toEqual([]);
  });

  it('a note whose text changed is changed', async () => {
    const { space, docs, backup } = setup();
    const id = createRecord(space, 'notes', { path: 'T.md', deleted: false });
    const text = new Y.Text('one');
    collection(space, 'notes').get(id)?.set('text', text);
    const b = backup();
    text.insert(3, ' two');
    const d = await diffBackup(docs, b);
    expect(titles(d.replace.changed)).toEqual(['notes:T.md']);
  });

  it('a document the backup lacks is emptied by Replace and left alone by Merge', async () => {
    const { space, priv, docs } = setup();
    createRecord(priv, 'time_entries', { description: 'Private', deleted: false });
    const d = await diffBackup(docs, [{ id: SPACE, update: Y.encodeStateAsUpdate(space) }]);
    expect(titles(d.replace.removed)).toEqual(['time_entries:Private']);
    expect(d.merge.removed).toEqual([]);
  });

  it('never lists a record deleted for good', async () => {
    const { space, docs } = setup();
    const other = new Y.Doc();
    const id = createRecord(other, 'notes', { deleted: true, purged_at: '2026-10-01T00:00:00Z' });
    expect(id).toBeTruthy();
    const d = await diffBackup(docs, [{ id: SPACE, update: Y.encodeStateAsUpdate(other) }]);
    expect(d.merge.added).toEqual([]);
    expect(d.replace.added).toEqual([]);
    expect(space.getMap('notes').size).toBe(0);
  });

  it('leaves the current documents untouched', async () => {
    const { space, docs } = setup();
    const before = Y.encodeStateVector(space);
    const other = new Y.Doc();
    createRecord(other, 'notes', { path: 'X.md', deleted: false });
    await diffBackup(docs, [{ id: SPACE, update: Y.encodeStateAsUpdate(other) }]);
    expect(Y.encodeStateVector(space)).toEqual(before);
    expect(space.getMap('notes').size).toBe(0);
  });

  it('yields while it works and stops when aborted', async () => {
    const { space, docs, backup } = setup();
    for (let i = 0; i < 50; i++) createRecord(space, 'tags', { name: `t${i}`, deleted: false });
    const b = backup();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const d = await diffBackup(docs, b, { chunk: 5 });
    clearInterval(timer);
    expect(d.replace.removed).toEqual([]);
    expect(ticks).toBeGreaterThan(0);
    const ctl = new AbortController();
    ctl.abort();
    await expect(diffBackup(docs, b, { signal: ctl.signal })).rejects.toThrow('stopped');
  });
});

describe('countsText', () => {
  it('names the kinds with counts, singular and plural', () => {
    const item = (kind: DiffItem['kind']): DiffItem => ({ kind, docId: SPACE, id: 'x', title: '' });
    expect(countsText([])).toBe('nothing');
    expect(countsText([item('time_entries'), item('time_entries'), item('notes')])).toBe('2 time entries, 1 note or task');
  });
});
