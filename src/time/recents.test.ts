import { describe, expect, it } from 'vitest';
import { deleteEntry, findRunning, startTimer, stopTimer } from './entries';
import { buildRecents, recentKey, relativeAgo } from './recents';
import { at, makeSpaceDocs } from './testing';

const T0 = at(2026, 10, 14, 9, 0);
const MIN = 60_000;

/** Track `fields` in `space` from `start` for `mins` minutes; returns the entry id. */
function track(docs: ReturnType<typeof makeSpaceDocs>, space: string, start: number, mins: number, fields: Parameters<typeof startTimer>[3]): string {
  const { id } = startTimer(docs, space, 'dev', fields, start);
  stopTimer(docs.get(space)!, id, start + mins * MIN);
  return id;
}

describe('buildRecents', () => {
  it('is empty when nothing was tracked', () => {
    expect(buildRecents(makeSpaceDocs())).toEqual({ last: undefined, others: [] });
  });

  it('puts the entry that stopped last first, then distinct combinations, most recent first', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 30, { description: 'a' });
    track(docs, 'personal', T0 + 40 * MIN, 30, { description: 'b' });
    track(docs, 'personal', T0 + 80 * MIN, 30, { description: 'c' });
    const r = buildRecents(docs);
    expect(r.last?.entry.description).toBe('c');
    expect(r.others.map((o) => o.entry.description)).toEqual(['b', 'a']);
  });

  it('shows a repeated combination once, at its latest, ignoring case, spacing and tag order', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'Review  PR', tags: ['x', 'y'] });
    track(docs, 'personal', T0 + 20 * MIN, 10, { description: 'other' });
    track(docs, 'personal', T0 + 40 * MIN, 10, { description: 'review pr', tags: ['Y', 'X'] });
    const r = buildRecents(docs);
    expect(r.last?.entry.description).toBe('review pr');
    expect(r.others.map((o) => o.entry.description)).toEqual(['other']);
  });

  it('keeps the same description with a different project or tags apart', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'x', project_id: 'p1' });
    track(docs, 'personal', T0 + 20 * MIN, 10, { description: 'x', project_id: 'p2' });
    track(docs, 'personal', T0 + 40 * MIN, 10, { description: 'x', tags: ['t'] });
    expect(buildRecents(docs).others).toHaveLength(2);
  });

  it('limits the further rows to five', () => {
    const docs = makeSpaceDocs();
    for (let i = 0; i < 9; i++) track(docs, 'personal', T0 + i * 20 * MIN, 10, { description: `job ${i}` });
    const r = buildRecents(docs);
    expect(r.last?.entry.description).toBe('job 8');
    expect(r.others.map((o) => o.entry.description)).toEqual(['job 7', 'job 6', 'job 5', 'job 4', 'job 3']);
    expect(buildRecents(docs, { limit: 2 }).others).toHaveLength(2);
  });

  it('reads every space, ordered by when each stopped, and names the space', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'home' });
    track(docs, 'work', T0 + 30 * MIN, 10, { description: 'office' });
    const r = buildRecents(docs);
    expect(r.last).toMatchObject({ spaceId: 'work' });
    expect(r.others[0]).toMatchObject({ spaceId: 'personal' });
  });

  it('the same description in two spaces is two picks', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'standup' });
    track(docs, 'work', T0 + 30 * MIN, 10, { description: 'standup' });
    const r = buildRecents(docs);
    expect(r.last?.spaceId).toBe('work');
    expect(r.others.map((o) => o.spaceId)).toEqual(['personal']);
  });

  it('skips the running entry and a twin of it, and never lists a running entry', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'again' });
    track(docs, 'personal', T0 + 20 * MIN, 10, { description: 'before' });
    startTimer(docs, 'personal', 'dev', { description: 'again' }, T0 + 40 * MIN);
    const running = findRunning(docs)[0]!;
    expect(buildRecents(docs).others.map((o) => o.entry.description)).toEqual(['again']);
    const r = buildRecents(docs, { running });
    expect(r.last?.entry.description).toBe('before');
    expect(r.others).toEqual([]);
  });

  it('leaves out the last stopped one when it is the running one\'s twin; the rest stay in the further rows', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'old' });
    track(docs, 'personal', T0 + 20 * MIN, 10, { description: 'same' });
    startTimer(docs, 'personal', 'dev', { description: 'same' }, T0 + 40 * MIN);
    const r = buildRecents(docs, { running: findRunning(docs)[0]! });
    expect(r.last).toBeUndefined();
    expect(r.others.map((o) => o.entry.description)).toEqual(['old']);
  });

  it('never lists a soft-deleted entry', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'kept' });
    const gone = track(docs, 'personal', T0 + 20 * MIN, 10, { description: 'deleted' });
    deleteEntry(docs.get('personal')!, gone, T0 + 60 * MIN);
    const r = buildRecents(docs);
    expect(r.last?.entry.description).toBe('kept');
    expect(r.others).toEqual([]);
  });

  it('skips entries with nothing to pick (no description, project or tags) in the further rows', () => {
    const docs = makeSpaceDocs();
    track(docs, 'personal', T0, 10, { description: 'real' });
    track(docs, 'personal', T0 + 20 * MIN, 10, {});
    track(docs, 'personal', T0 + 40 * MIN, 10, {});
    const r = buildRecents(docs);
    expect(r.last?.entry.description).toBe('');
    expect(r.others.map((o) => o.entry.description)).toEqual(['real']);
  });
});

describe('recentKey and relativeAgo', () => {
  it('ignores billable and tag order', () => {
    const base = { description: ' A  b ', project_id: null, tags: ['x', 'Y'] };
    expect(recentKey(base, 's')).toBe(recentKey({ ...base, description: 'a b', tags: ['y', 'X'] }, 's'));
    expect(recentKey(base, 's')).not.toBe(recentKey(base, 't'));
  });
  it('words a past time', () => {
    const now = T0 + 10 * 24 * 3600_000;
    expect(relativeAgo(now - 20_000, now)).toBe('just now');
    expect(relativeAgo(now - 5 * MIN, now)).toBe('5 min ago');
    expect(relativeAgo(now - 2 * 3600_000, now)).toBe('2 h ago');
    expect(relativeAgo(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(relativeAgo(now - 3 * 24 * 3600_000, now)).toBe('3 days ago');
    expect(relativeAgo(now + 5000, now)).toBe('just now');
    expect(relativeAgo(now - 9 * 24 * 3600_000, now)).toMatch(/\d/);
  });
});
