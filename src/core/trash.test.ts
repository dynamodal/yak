import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addEntry, addNote } from '../backup/testing';
import { attachmentsMap } from './blobs/attachments';
import { restoreRecords } from './history/travel';
import { collection, createRecord, liveRecords, softDelete } from './schema';
import { deletedAtMs, inTrash, purgeRecord, readDeleteFilesNow, restoreRecord, trashItems, trashRecord, TRASH_DAYS, writeDeleteFilesNow } from './trash';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T12:00:00Z');

const project = (doc: Y.Doc, name: string): string =>
  createRecord(doc, 'projects', { name, client_id: null, color: '#336699', billable: false, rate: null, currency: 'USD', active: true, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', deleted: false });
const tag = (doc: Y.Doc, name: string): string => createRecord(doc, 'tags', { name, created_at: '2026-09-01T00:00:00Z', deleted: false });
const file = (doc: Y.Doc, hash: string, name: string): void => {
  const m = new Y.Map<unknown>();
  m.set('name', name);
  m.set('size', 3);
  m.set('type', 'application/octet-stream');
  m.set('created_at', '2026-09-01T00:00:00Z');
  m.set('deleted', false);
  attachmentsMap(doc).set(hash, m);
};
const sync = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe('retention', () => {
  it('lists every kind for 45 days after the delete, then not', () => {
    const doc = new Y.Doc();
    const ids = { time_entries: addEntry(doc, '2026-09-30T09:00:00Z', '2026-09-30T10:00:00Z', 'Write'), notes: addNote(doc, 'A.md', 'a'), projects: project(doc, 'P'), tags: tag(doc, 't') };
    file(doc, 'h1', 'a.png');
    for (const [kind, id] of Object.entries(ids)) trashRecord(doc, kind as keyof typeof ids, id, T0);
    trashRecord(doc, 'files', 'h1', T0);
    for (const kind of ['time_entries', 'notes', 'projects', 'tags', 'files'] as const) {
      const items = trashItems(doc, kind, T0 + (TRASH_DAYS - 1) * DAY);
      expect(items, kind).toHaveLength(1);
      expect(items[0]!.deletedAt).toBe(T0);
      expect(items[0]!.expiresAt).toBe(T0 + TRASH_DAYS * DAY);
      expect(trashItems(doc, kind, T0 + TRASH_DAYS * DAY), kind).toHaveLength(0);
    }
  });

  it('newest first, and the title is what the person knows it by', () => {
    const doc = new Y.Doc();
    const a = project(doc, 'Old');
    const b = project(doc, 'New');
    trashRecord(doc, 'projects', a, T0);
    trashRecord(doc, 'projects', b, T0 + DAY);
    expect(trashItems(doc, 'projects', T0 + 2 * DAY).map((t) => t.title)).toEqual(['New', 'Old']);
  });

  it('a restore past the window is refused', () => {
    const doc = new Y.Doc();
    const p = project(doc, 'P');
    trashRecord(doc, 'projects', p, T0);
    expect(restoreRecord(doc, 'projects', p, T0 + 46 * DAY).ok).toBe(false);
    expect(restoreRecord(doc, 'projects', p, T0 + DAY)).toEqual({ ok: true });
    expect(liveRecords(doc, 'projects')).toHaveLength(1);
    expect(collection(doc, 'projects').get(p)!.has('deleted_at')).toBe(false);
  });
});

describe('data deleted before Recently deleted (no migration, F39)', () => {
  it('projects, clients, tags and files without a date are listed as date unknown and never expire', () => {
    const doc = new Y.Doc();
    const p = project(doc, 'P');
    const t = tag(doc, 't');
    file(doc, 'h1', 'a.png');
    softDelete(doc, 'projects', p);
    softDelete(doc, 'tags', t);
    attachmentsMap(doc).get('h1')!.set('deleted', true);
    const later = T0 + 1000 * DAY;
    for (const kind of ['projects', 'tags', 'files'] as const) {
      const [item] = trashItems(doc, kind, later);
      expect(item?.deletedAt, kind).toBeNull();
      expect(item?.expiresAt, kind).toBeNull();
    }
    expect(restoreRecord(doc, 'projects', p, later)).toEqual({ ok: true });
  });

  it('time entries without a stamp stay out (a move leaves its original unstamped); notes go by updated_at', () => {
    const doc = new Y.Doc();
    const e = addEntry(doc, '2026-09-30T09:00:00Z', '2026-09-30T10:00:00Z', 'Moved');
    softDelete(doc, 'time_entries', e);
    expect(trashItems(doc, 'time_entries')).toHaveLength(0);
    const n = addNote(doc, 'N.md', 'n');
    softDelete(doc, 'notes', n);
    const at = Date.parse(collection(doc, 'notes').get(n)!.get('updated_at') as string);
    expect(deletedAtMs('notes', collection(doc, 'notes').get(n)!)).toBe(at);
    expect(trashItems(doc, 'notes', at + DAY)).toHaveLength(1);
  });

  it('a note restored and deleted again by an older build goes by the later date', () => {
    const doc = new Y.Doc();
    const n = addNote(doc, 'N.md', 'n');
    trashRecord(doc, 'notes', n, T0);
    const rec = collection(doc, 'notes').get(n)!;
    rec.set('deleted', false); // older build's restore leaves deleted_at
    rec.set('deleted', true);
    rec.set('updated_at', new Date(T0 + 40 * DAY).toISOString());
    expect(inTrash('notes', rec, T0 + 50 * DAY)).toBe(true);
  });

  it('a tag merged by a rename is not a delete', () => {
    const doc = new Y.Doc();
    const t = tag(doc, 't');
    collection(doc, 'tags').get(t)!.set('deleted', true);
    collection(doc, 'tags').get(t)!.set('merged', true);
    expect(trashItems(doc, 'tags')).toHaveLength(0);
  });
});

describe('delete for good', () => {
  it('clears the content and leaves a tombstone, which never comes back from another device', () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    const n = addNote(one, 'Secret.md', 'private words');
    sync(one, two);
    trashRecord(one, 'notes', n, T0);
    sync(one, two);
    // While `one` deletes for good, `two` (offline) edits the deleted note and restores it.
    purgeRecord(one, 'notes', n, T0 + DAY);
    collection(two, 'notes').get(n)!.set('path', 'Renamed.md');
    collection(two, 'notes').get(n)!.set('deleted', false);
    sync(one, two);
    for (const doc of [one, two]) {
      const rec = collection(doc, 'notes').get(n)!;
      expect(rec.has('purged_at')).toBe(true);
      expect(rec.has('text')).toBe(false);
      expect(liveRecords(doc, 'notes')).toHaveLength(0);
      expect(trashItems(doc, 'notes', T0 + 2 * DAY)).toHaveLength(0);
      expect(restoreRecord(doc, 'notes', n).ok).toBe(false);
    }
    expect(JSON.stringify(collection(two, 'notes').toJSON())).not.toContain('private words');
  });

  it('an old copy merged in later (a stale device, a backup update) does not bring it back', () => {
    const doc = new Y.Doc();
    const e = addEntry(doc, '2026-09-30T09:00:00Z', '2026-09-30T10:00:00Z', 'Gone');
    const before = Y.encodeStateAsUpdate(doc);
    trashRecord(doc, 'time_entries', e, T0);
    purgeRecord(doc, 'time_entries', e, T0);
    Y.applyUpdate(doc, before);
    const rec = collection(doc, 'time_entries').get(e)!;
    expect([...rec.keys()].sort()).toEqual(['deleted', 'purged_at']);
    expect(liveRecords(doc, 'time_entries')).toHaveLength(0);
  });

  it('Version history, which may still hold a copy, can bring it back whole', () => {
    const doc = new Y.Doc();
    const n = addNote(doc, 'Kept.md', 'old words');
    const past = new Y.Doc();
    Y.applyUpdate(past, Y.encodeStateAsUpdate(doc));
    trashRecord(doc, 'notes', n, T0);
    purgeRecord(doc, 'notes', n, T0);
    expect(restoreRecords(doc, past, 'notes', [n])).toBe(1);
    expect(liveRecords<{ path: string }>(doc, 'notes').map((r) => r.path)).toEqual(['Kept.md']);
    expect(String(collection(doc, 'notes').get(n)!.get('text'))).toBe('old words');
  });

  it('only a deleted record can be deleted for good', () => {
    const doc = new Y.Doc();
    const p = project(doc, 'P');
    expect(purgeRecord(doc, 'projects', p)).toBe(false);
    expect(liveRecords(doc, 'projects')).toHaveLength(1);
  });
});

describe('restore of a file', () => {
  it('takes a free name when another live file has its name now', () => {
    const doc = new Y.Doc();
    file(doc, 'h1', 'a.png');
    trashRecord(doc, 'files', 'h1', T0);
    file(doc, 'h2', 'A.png');
    expect(restoreRecord(doc, 'files', 'h1', T0 + DAY)).toEqual({ ok: true });
    expect(attachmentsMap(doc).get('h1')!.get('name')).toBe('a 2.png');
  });
});

describe('the account setting', () => {
  it('is off by default and synced in the account settings map', () => {
    const doc = new Y.Doc();
    expect(readDeleteFilesNow(doc)).toBe(false);
    writeDeleteFilesNow(doc, true);
    expect(readDeleteFilesNow(doc)).toBe(true);
    expect(doc.getMap('settings').get('delete_files_now')).toBe(true);
  });
});
