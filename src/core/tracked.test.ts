import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createRecord } from './schema';
import { formatTracked, trackedByTask } from './tracked';

function entry(doc: Y.Doc, task: string | null, start: string, stop: string | null, deleted = false): void {
  const id = createRecord(doc, 'time_entries', { start, stop, task_id: task, deleted: false });
  if (deleted) doc.getMap<Y.Map<unknown>>('time_entries').get(id)?.set('deleted', true);
}

describe('trackedByTask', () => {
  it('sums entries per task across documents, counts a running one to now, skips deleted and unlinked', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    entry(a, 't1', '2026-03-25T08:00:00Z', '2026-03-25T09:30:00Z');
    entry(a, null, '2026-03-25T08:00:00Z', '2026-03-25T09:00:00Z');
    entry(a, 't1', '2026-03-25T10:00:00Z', '2026-03-25T11:00:00Z', true);
    entry(b, 't1', '2026-03-25T12:00:00Z', null);
    entry(b, 't2', '2026-03-25T12:00:00Z', '2026-03-25T12:10:00Z');
    const m = trackedByTask([a, b], Date.parse('2026-03-25T12:30:00Z'));
    expect(m.get('t1')).toBe(90 * 60 + 30 * 60);
    expect(m.get('t2')).toBe(600);
    expect(m.size).toBe(2);
  });
});

describe('formatTracked', () => {
  it('reads as hours and minutes', () => {
    expect(formatTracked(undefined)).toBe('');
    expect(formatTracked(0)).toBe('< 1 m');
    expect(formatTracked(20)).toBe('< 1 m');
    expect(formatTracked(45 * 60)).toBe('45 m');
    expect(formatTracked(3600)).toBe('1 h');
    expect(formatTracked(5400)).toBe('1 h 30 m');
  });
});
