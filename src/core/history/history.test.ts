import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bulkEdit } from '../bulk';
import { collection, createRecord, updateRecord } from '../schema';
import { dayOf, dayPoints, historyDays, type Point, pointSummary } from './browse';
import { lineDiff } from './diff';
import { MemoryStore } from './memory-store';
import { HistoryRecorder } from './recorder';
import { compareCollection, minimalEdit, noteVersions, replay, restoreRecords, stateAt } from './travel';
import { bucketOf, planThinning, thinDocument } from './thinning';
import { type BatchAlert, CorruptionWatch, DEFAULT_THRESHOLDS, type Thresholds } from './watch';
import type { NewSegment, Segment } from './types';

const DAY = 86_400_000;
const entry = (description: string) => ({ start: '2026-10-01T08:00:00.000Z', stop: '2026-10-01T09:00:00.000Z', duration: 3600, description, project_id: null, task_id: null, tags: [], billable: false, device_id: 'd', created_at: 'x', updated_at: 'x', deleted: false });

/** A recorder with a clock the test moves. */
function setup() {
  const store = new MemoryStore();
  const clock = { t: 1_000_000 };
  const recorder = new HistoryRecorder(store, () => clock.t, 60_000);
  const doc = new Y.Doc();
  return { store, clock, recorder, doc };
}

describe('HistoryRecorder', () => {
  it('records the whole state as a baseline, then merges updates into segments', async () => {
    const { store, clock, recorder, doc } = setup();
    createRecord(doc, 'time_entries', entry('before'));
    await recorder.attach('space/a/private', doc);
    expect((await store.list('space/a/private')).map((s) => s.baseline)).toEqual([true]);
    clock.t += 1000;
    const id = createRecord(doc, 'time_entries', entry('one'));
    clock.t += 5000;
    updateRecord(doc, 'time_entries', id, { description: 'two' });
    await recorder.flush('space/a/private');
    const segs = await store.list('space/a/private');
    expect(segs).toHaveLength(2);
    expect(segs[1]).toMatchObject({ baseline: false, local: true, start: 1_001_000, end: 1_006_000 });
    // The log alone rebuilds the document.
    const rebuilt = replay(segs, Infinity).doc;
    expect(rebuilt.getMap('time_entries').toJSON()).toEqual(doc.getMap('time_entries').toJSON());
  });

  it('does not write a baseline twice, and marks edits that came from a link as not local', async () => {
    const { store, recorder, doc } = setup();
    await recorder.attach('d', doc);
    recorder.detachAll();
    const again = new HistoryRecorder(store, () => 2_000_000);
    await again.attach('d', doc);
    expect(await store.list('d')).toHaveLength(1);
    const other = new Y.Doc();
    createRecord(other, 'time_entries', entry('remote'));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), 'a-provider');
    await again.flush('d');
    expect((await store.list('d'))[1]?.local).toBe(false);
  });
});

describe('time travel', () => {
  it('shows a past state and tells when the log begins later', async () => {
    const { store, clock, recorder, doc } = setup();
    await recorder.attach('d', doc);
    clock.t = 2_000_000;
    const id = createRecord(doc, 'time_entries', entry('first'));
    await recorder.flush('d');
    clock.t = 3_000_000;
    updateRecord(doc, 'time_entries', id, { description: 'second' });
    await recorder.flush('d');
    const at = async (t: number) => (await stateAt(store, 'd', t)).doc.getMap<Y.Map<unknown>>('time_entries').get(id)?.get('description');
    expect(await at(2_500_000)).toBe('first');
    expect(await at(3_500_000)).toBe('second');
    expect((await stateAt(store, 'd', 10)).before).toBe(true);
  });
});

describe('comparing and restoring records', () => {
  function history() {
    const past = new Y.Doc();
    const a = createRecord(past, 'time_entries', entry('keep'));
    const b = createRecord(past, 'time_entries', entry('edited'));
    const c = createRecord(past, 'time_entries', entry('removed'));
    const now = new Y.Doc();
    Y.applyUpdate(now, Y.encodeStateAsUpdate(past));
    updateRecord(now, 'time_entries', b, { description: 'edited later', billable: true });
    updateRecord(now, 'time_entries', c, { deleted: true, deleted_at: 'z' });
    const added = createRecord(now, 'time_entries', entry('new'));
    return { past, now, a, b, c, added };
  }

  it('lists what was deleted or changed since, and counts what was added', () => {
    const { past, now, b, c } = history();
    const cmp = compareCollection(past, now, 'time_entries');
    expect(cmp.addedSince).toBe(1);
    expect(cmp.changes.map((x) => [x.id, x.kind]).sort()).toEqual([[b, 'changed'], [c, 'deleted']].sort());
    expect(cmp.changes.find((x) => x.id === b)?.fields.map((f) => f.field).sort()).toEqual(['billable', 'description']);
  });

  it('restores only the chosen records, as new edits, and leaves later records alone', () => {
    const { past, now, b, c, added } = history();
    expect(restoreRecords(now, past, 'time_entries', [c])).toBe(1);
    const recs = now.getMap<Y.Map<unknown>>('time_entries');
    expect(recs.get(c)?.get('deleted')).toBe(false);
    expect(recs.get(c)?.has('deleted_at')).toBe(false);
    expect(typeof recs.get(c)?.get('restored_at')).toBe('string');
    expect(recs.get(b)?.get('description')).toBe('edited later');
    expect(recs.get(added)?.get('description')).toBe('new');
    expect(compareCollection(past, now, 'time_entries').changes.map((x) => x.id)).toEqual([b]);
  });

  it('brings back a record that is gone from the document', () => {
    const { past, now, a } = history();
    now.getMap('time_entries').delete(a);
    expect(compareCollection(past, now, 'time_entries').changes.find((x) => x.id === a)?.kind).toBe('missing');
    restoreRecords(now, past, 'time_entries', [a]);
    expect(now.getMap<Y.Map<unknown>>('time_entries').get(a)?.get('description')).toBe('keep');
  });
});

describe('restoring notes', () => {
  const note = (text: string) => ({ path: 'A.md', text: new Y.Text(text), created_at: 'x', updated_at: 'x', deleted: false });
  const mk = (): { past: Y.Doc; now: Y.Doc; id: string } => {
    const past = new Y.Doc();
    const id = createRecord(past, 'notes', note('one\ntwo'));
    const now = new Y.Doc();
    Y.applyUpdate(now, Y.encodeStateAsUpdate(past));
    return { past, now, id };
  };

  it('puts old text back as an edit of the existing Y.Text and un-deletes', () => {
    const { past, now, id } = mk();
    const t = now.getMap<Y.Map<unknown>>('notes').get(id)?.get('text') as Y.Text;
    t.insert(0, 'new ');
    updateRecord(now, 'notes', id, { deleted: true });
    expect(compareCollection(past, now, 'notes').changes[0]?.kind).toBe('deleted');
    restoreRecords(now, past, 'notes', [id]);
    const rec = now.getMap<Y.Map<unknown>>('notes').get(id);
    expect(rec?.get('text')).toBe(t);
    expect(t.toString()).toBe('one\ntwo');
    expect(rec?.get('deleted')).toBe(false);
  });

  it('recreates a note that is gone with a Y.Text', () => {
    const { past, now, id } = mk();
    now.getMap('notes').delete(id);
    restoreRecords(now, past, 'notes', [id]);
    expect((now.getMap<Y.Map<unknown>>('notes').get(id)?.get('text') as Y.Text).toString()).toBe('one\ntwo');
  });
});

describe('note versions', () => {
  it('lists each distinct text, and a minimal edit turns one into another', async () => {
    const { store, clock, recorder, doc } = setup();
    await recorder.attach('space/a', doc);
    const notes = doc.getMap<Y.Map<unknown>>('notes');
    const rec = new Y.Map<unknown>();
    const text = new Y.Text('hello');
    rec.set('text', text);
    rec.set('deleted', false);
    notes.set('n1', rec);
    clock.t += 1000;
    await recorder.flush('space/a');
    text.insert(5, ' world');
    clock.t += 1000;
    await recorder.flush('space/a');
    text.delete(0, 5);
    clock.t += 1000;
    await recorder.flush('space/a');
    const versions = noteVersions(await store.list('space/a'), 'n1');
    expect(versions.map((v) => v.text)).toEqual(['hello', 'hello world', ' world']);
    const edit = minimalEdit('hello world', ' world');
    expect(edit).toEqual({ index: 0, remove: 5, insert: '' });
    expect(minimalEdit('abc', 'abXc')).toEqual({ index: 2, remove: 0, insert: 'X' });
  });
});

describe('thinning', () => {
  const seg = (seq: number, end: number): Segment => ({ docId: 'd', seq, start: end - 10, end, update: new Uint8Array(), local: true, baseline: false });
  const now = new Date(2026, 9, 17, 12).getTime();

  it('keeps recent segments, merges older ones per day and the oldest per month', () => {
    expect(bucketOf(seg(1, now - 10 * DAY), now)).toBeNull();
    expect(bucketOf(seg(1, now - 100 * DAY), now)?.startsWith('d')).toBe(true);
    expect(bucketOf(seg(1, now - 400 * DAY), now)?.startsWith('m')).toBe(true);
  });

  it('plans runs of neighbours in one bucket and nothing for a lone segment', () => {
    const day = new Date(2026, 5, 1, 9).getTime();
    const runs = planThinning([seg(1, now - DAY), seg(2, day), seg(3, day + 3600_000), seg(4, day + 7200_000), seg(5, day + DAY)], now);
    expect(runs.map((r) => r.map((s) => s.seq))).toEqual([[2, 3, 4]]);
  });

  it('never merges across a "Before restore" mark', () => {
    const day = new Date(2026, 5, 1, 9).getTime();
    const segs = [seg(1, day), seg(2, day + 3600_000), seg(3, day + 7200_000), seg(4, day + 10_800_000)];
    expect(planThinning(segs, now).map((r) => r.map((s) => s.seq))).toEqual([[1, 2, 3, 4]]);
    expect(planThinning(segs, now, undefined, [day + 3600_000 + 5]).map((r) => r.map((s) => s.seq))).toEqual([[1, 2], [3, 4]]);
  });

  it('keeps the state at a mark after thinning', async () => {
    const store = new MemoryStore();
    const old = new Date(2026, 5, 1, 9).getTime();
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    for (const word of ['a', 'b', 'c', 'd']) doc.getText('t').insert(doc.getText('t').length, word);
    for (const [i, u] of updates.entries()) await store.append({ docId: 'd', start: old + i * 1000, end: old + i * 1000, update: u, local: true, baseline: false });
    await store.addMark({ id: 'm', docId: 'd', noteId: '', name: 'Before restore', at: old + 1500, text: '', kind: 'before-restore' });
    await thinDocument(store, 'd', now);
    expect(replay(await store.list('d'), old + 1500).doc.getText('t').toString()).toBe('ab');
  });

  it('merges without losing content', async () => {
    const store = new MemoryStore();
    const doc = new Y.Doc();
    const old = new Date(2026, 5, 1, 9).getTime();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    for (const word of ['a', 'b', 'c']) doc.getText('t').insert(doc.getText('t').length, word);
    let i = 0;
    for (const u of updates) {
      const s: NewSegment = { docId: 'd', start: old + i * 1000, end: old + i * 1000, update: u, local: true, baseline: false };
      await store.append(s);
      i++;
    }
    expect(await thinDocument(store, 'd', now)).toBe(1);
    const left = await store.list('d');
    expect(left).toHaveLength(1);
    expect(replay(left, Infinity).doc.getText('t').toString()).toBe('abc');
    expect(left[0]).toMatchObject({ start: old, end: old + 2000, seq: 1 });
  });
});

describe('CorruptionWatch', () => {
  async function watch(count: (alerts: BatchAlert[]) => void, thresholds?: Partial<Thresholds>) {
    const alerts: BatchAlert[] = [];
    const clock = { t: Date.parse('2026-10-17T12:00:00Z') };
    const w = new CorruptionWatch((a) => alerts.push(a), () => ({ ...DEFAULT_THRESHOLDS, ...thresholds }), () => clock.t);
    const doc = new Y.Doc();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(createRecord(doc, 'time_entries', { ...entry(`e${i}`), start: '2026-09-01T08:00:00.000Z' }));
    w.attach('space/a/private', doc);
    count(alerts);
    return { alerts, clock, doc, ids };
  }

  it('raises an alert when many entries are deleted within a minute', async () => {
    const { alerts, doc, ids } = await watch(() => undefined);
    for (const id of ids.slice(0, 9)) updateRecord(doc, 'time_entries', id, { deleted: true });
    expect(alerts).toHaveLength(0);
    updateRecord(doc, 'time_entries', ids[9]!, { deleted: true });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ deleted: 10, local: true });
    expect(alerts[0]!.before).toBeLessThan(Date.parse('2026-10-17T12:00:00Z'));
  });

  it('stays quiet for a bulk edit and for undoing it', async () => {
    const { alerts, doc, ids } = await watch(() => undefined);
    const { undo } = bulkEdit([doc], (tx) => tx(doc, () => ids.forEach((id) => collection(doc, 'time_entries').get(id)?.set('description', 'bulk'))));
    undo();
    expect(alerts).toHaveLength(0);
  });

  it('raises an alert when many old entries change, but not for a few edits or for recent entries', async () => {
    const { alerts, doc, ids, clock } = await watch(() => undefined);
    for (const id of ids.slice(0, 5)) updateRecord(doc, 'time_entries', id, { description: 'x' });
    expect(alerts).toHaveLength(0);
    clock.t += 120_000;
    for (const id of ids.slice(5, 30)) updateRecord(doc, 'time_entries', id, { description: 'y' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.changed).toBe(25);
  });

  it('forgets changes older than the window and ignores restores', async () => {
    const { alerts, doc, ids, clock } = await watch(() => undefined);
    for (const id of ids.slice(0, 8)) updateRecord(doc, 'time_entries', id, { deleted: true });
    clock.t += 120_000;
    for (const id of ids.slice(8, 16)) updateRecord(doc, 'time_entries', id, { deleted: true });
    expect(alerts).toHaveLength(0);
    doc.transact(() => {
      for (const id of ids.slice(16, 30)) doc.getMap<Y.Map<unknown>>('time_entries').get(id)?.set('deleted', true);
    }, 'history-restore');
    expect(alerts).toHaveLength(0);
  });

  it('says when the batch came from another device', async () => {
    const { alerts, doc, ids } = await watch(() => undefined);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    for (const id of ids.slice(0, 10)) updateRecord(other, 'time_entries', id, { deleted: true });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), 'a-provider');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.local).toBe(false);
  });
});

describe('lineDiff', () => {
  it('marks lines only in one of the texts', () => {
    const d = lineDiff('a\nb\nc', 'a\nc\nd');
    expect(d.map((l) => `${l.kind[0]}:${l.text}`)).toEqual(['s:a', 'r:b', 's:c', 'a:d']);
  });
  it('handles empty texts and falls back for huge inputs', () => {
    expect(lineDiff('', 'x').map((l) => l.kind)).toEqual(['removed', 'added']);
    expect(lineDiff('a\nb', 'c\nd', 1).every((l) => l.kind !== 'same')).toBe(true);
  });
});

describe('browsing the log', () => {
  const T = new Date(2026, 9, 10, 12, 0, 0).getTime();

  it('lists days with changes, newest first, and skips the baseline and empty days', async () => {
    const { store, clock, recorder, doc } = setup();
    clock.t = T;
    await recorder.attach('d', doc);
    for (const days of [0, 0, 3]) {
      clock.t = T + days * DAY + 1000;
      createRecord(doc, 'time_entries', entry('x'));
      await recorder.flush('d');
      clock.t += 61_000;
    }
    const list = await historyDays(store, ['d']);
    expect(list).toEqual([
      { day: dayOf(T + 3 * DAY), points: 1 },
      { day: dayOf(T), points: 2 },
    ]);
  });

  it('summarises a point by the entries and notes it touched', async () => {
    const { store, clock, recorder, doc } = setup();
    clock.t = T;
    createRecord(doc, 'time_entries', entry('old'));
    await recorder.attach('d', doc);
    clock.t = T + 1000;
    createRecord(doc, 'time_entries', entry('a'));
    createRecord(doc, 'time_entries', entry('b'));
    createRecord(doc, 'notes', { path: 'N.md', text: new Y.Text('hi'), tags: [], deleted: false } as never);
    await recorder.flush('d');
    clock.t += 120_000;
    const [first] = collection(doc, 'time_entries').keys();
    updateRecord(doc, 'time_entries', first as string, { description: 'changed' });
    await recorder.flush('d');
    const points = await dayPoints(store, ['d'], dayOf(T));
    expect(points.map((p) => [p.entries, p.notes, p.local])).toEqual([
      [2, 1, true],
      [1, 0, true],
    ]);
    expect(pointSummary(points[0] as Point)).toBe('2 entries · 1 note');
    expect(pointSummary({ entries: 0, notes: 0 })).toBe('Other changes');
    expect(points.every((p) => p.source === 'This device')).toBe(true);
  });

  it('lists a "Before restore" mark once, as a point of its own', async () => {
    const { store, clock, recorder, doc } = setup();
    clock.t = T;
    await recorder.attach('d', doc);
    for (const docId of ['d', 'd2']) await store.addMark({ id: docId, docId, noteId: '', name: 'Before restore', at: T + 5000, text: '', kind: 'before-restore' });
    await store.addMark({ id: 'n', docId: 'd', noteId: 'note', name: 'v1', at: T + 6000, text: 'x' });
    const points = await dayPoints(store, ['d', 'd2'], dayOf(T));
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ mark: 'Before restore', end: T + 5000, source: 'This device' });
    expect(pointSummary(points[0] as Point)).toBe('Before restore');
  });

  it('keeps a day with 200 points quick', async () => {
    const { store, clock, recorder, doc } = setup();
    clock.t = T;
    await recorder.attach('d', doc);
    const id = createRecord(doc, 'time_entries', entry('x'));
    for (let i = 0; i < 200; i++) {
      clock.t += 61_000;
      updateRecord(doc, 'time_entries', id, { description: `v${i}` });
      await recorder.flush('d');
    }
    const began = Date.now();
    const points = await dayPoints(store, ['d'], dayOf(T));
    expect(points.length).toBeGreaterThanOrEqual(190);
    expect(Date.now() - began).toBeLessThan(2000);
  });
});
