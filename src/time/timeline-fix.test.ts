import { describe, expect, it } from 'vitest';
import { addManualEntry, isRunning, liveEntries, startTimer } from './entries';
import type { Spaces } from './bulk-edit';
import { at, makeSpaceDocs, useTimeZone } from './testing';
import { type FixEntry, isInside, planExtendPrevious, planSplitAround, planStartNextEarlier, planDrag, planTrimFirst, planTrimSecond, runFix } from './timeline-fix';

const MIN = 60_000;
const H = 60 * MIN;
const e = (id: string, start: number, end: number | null): FixEntry => ({ id, spaceId: 'personal', start, end, title: id });
const NOW = at(2026, 3, 4, 20);

describe('gap fixes', () => {
  const gap = { start: at(2026, 3, 4, 10), end: at(2026, 3, 4, 10, 50) };
  it('extends the previous entry to the end of the gap', () => {
    const plan = planExtendPrevious(e('a', at(2026, 3, 4, 9), gap.start), gap);
    expect(plan).toMatchObject({ ok: true, steps: [{ kind: 'edit', stop: gap.end }] });
  });
  it('starts the next entry earlier, and a running one stays running', () => {
    expect(planStartNextEarlier(e('b', gap.end, null), gap)).toMatchObject({ ok: true, steps: [{ kind: 'edit', start: gap.start }] });
  });
  it('refuses when the entries moved since the view drew', () => {
    expect(planExtendPrevious(e('a', at(2026, 3, 4, 9), gap.start + MIN), gap).ok).toBe(false);
    expect(planStartNextEarlier(e('b', gap.end + MIN, null), gap).ok).toBe(false);
    expect(planExtendPrevious(undefined, gap).ok).toBe(false);
  });
});

describe('overlap fixes', () => {
  const a = e('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
  const b = e('b', at(2026, 3, 4, 9, 40), at(2026, 3, 4, 11));
  it('trims the first to end where the second starts, or the second to start where the first ends', () => {
    expect(planTrimFirst(a, b, NOW)).toMatchObject({ ok: true, steps: [{ kind: 'edit', entry: a, stop: b.start }] });
    expect(planTrimSecond(a, b, NOW)).toMatchObject({ ok: true, steps: [{ kind: 'edit', entry: b, start: a.end }] });
    expect(planTrimFirst(b, a, NOW)).toMatchObject({ ok: true }); // argument order does not matter
  });
  it('never stops a running entry', () => {
    const running = e('r', at(2026, 3, 4, 9), null);
    const later = e('l', at(2026, 3, 4, 9, 30), at(2026, 3, 4, 10));
    expect(planTrimFirst(running, later, NOW).ok).toBe(false);
    expect(planTrimSecond(running, later, NOW).ok).toBe(false);
    // the running one is the second: only its start can move, and that is allowed
    const first = e('f', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
    const run2 = e('r2', at(2026, 3, 4, 9, 30), null);
    expect(planTrimSecond(first, run2, NOW)).toMatchObject({ ok: true, steps: [{ start: first.end }] });
    expect(planTrimFirst(first, run2, NOW)).toMatchObject({ ok: true });
  });
  it('does not offer a trim that would leave an entry empty or drop time', () => {
    const outer = e('o', at(2026, 3, 4, 9), at(2026, 3, 4, 12));
    const inner = e('i', at(2026, 3, 4, 10), at(2026, 3, 4, 11));
    expect(planTrimFirst(outer, inner, NOW).ok).toBe(false);
    expect(planTrimSecond(outer, inner, NOW).ok).toBe(false);
    const sameStart = e('s', outer.start, at(2026, 3, 4, 10));
    expect(planTrimFirst(outer, sameStart, NOW).ok).toBe(false);
  });
  it('notices entries that no longer overlap', () => {
    expect(planTrimFirst(a, e('c', a.end! , at(2026, 3, 4, 11)), NOW).ok).toBe(false);
  });
  it('splits the outer entry around the inner one only when it is strictly inside', () => {
    const outer = e('o', at(2026, 3, 4, 9), at(2026, 3, 4, 12));
    const inner = e('i', at(2026, 3, 4, 10), at(2026, 3, 4, 11));
    expect(isInside(outer, inner, NOW)).toBe(true);
    expect(planSplitAround(outer, inner, NOW)).toMatchObject({ ok: true, steps: [{ kind: 'split', at: inner.end, trimTo: inner.start }] });
    expect(planSplitAround(outer, e('t', outer.start, at(2026, 3, 4, 10)), NOW).ok).toBe(false);
    expect(planSplitAround(outer, e('u', at(2026, 3, 4, 10), outer.end), NOW).ok).toBe(false);
    // a running outer entry can be split before now
    expect(planSplitAround(e('o', at(2026, 3, 4, 9), null), inner, NOW).ok).toBe(true);
  });
});

function setup() {
  const docs = makeSpaceDocs();
  const spaces: Spaces = new Map([...docs].map(([id, d]) => [id, { doc: d, privateDoc: d }]));
  const p = docs.get('personal')!;
  const add = (desc: string, start: number, stop: number) => {
    const r = addManualEntry(p, 'dev', { start, stop, description: desc });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  const ref = (id: string) => ({ spaceId: 'personal', id });
  const times = () => liveEntries(p).map((x) => [x.description, new Date(x.start).getTime(), x.stop === null ? null : new Date(x.stop).getTime()]).sort((x, y) => (x[1] as number) - (y[1] as number));
  return { spaces, p, add, ref, times };
}

describe('runFix', () => {
  useTimeZone('Europe/Berlin');
  it('trims in one step and Undo puts it back', () => {
    const { spaces, add, ref, times } = setup();
    const a = add('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
    const b = add('b', at(2026, 3, 4, 9, 40), at(2026, 3, 4, 11));
    const before = times();
    const r = runFix(spaces, 'dev', (read) => planTrimFirst(read(ref(a)), read(ref(b)), NOW));
    expect(r.ok).toBe(true);
    expect(times()).toEqual([['a', at(2026, 3, 4, 9), at(2026, 3, 4, 9, 40)], ['b', at(2026, 3, 4, 9, 40), at(2026, 3, 4, 11)]]);
    if (r.ok) r.undo();
    expect(times()).toEqual(before);
  });
  it('splits the outer entry around the inner and one Undo restores everything', () => {
    const { spaces, add, ref, times, p } = setup();
    const o = add('outer', at(2026, 3, 4, 9), at(2026, 3, 4, 12));
    const i = add('inner', at(2026, 3, 4, 10), at(2026, 3, 4, 11));
    const before = times();
    const r = runFix(spaces, 'dev', (read) => planSplitAround(read(ref(o)), read(ref(i)), NOW));
    expect(r.ok).toBe(true);
    expect(times()).toEqual([
      ['outer', at(2026, 3, 4, 9), at(2026, 3, 4, 10)],
      ['inner', at(2026, 3, 4, 10), at(2026, 3, 4, 11)],
      ['outer', at(2026, 3, 4, 11), at(2026, 3, 4, 12)],
    ]);
    expect(liveEntries(p)).toHaveLength(3);
    if (r.ok) r.undo();
    expect(times()).toEqual(before);
    expect(liveEntries(p)).toHaveLength(2);
  });
  it('refuses on stale data without editing', () => {
    const { spaces, add, ref, times } = setup();
    const a = add('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
    const b = add('b', at(2026, 3, 4, 11), at(2026, 3, 4, 12));
    const before = times();
    const r = runFix(spaces, 'dev', (read) => planExtendPrevious(read(ref(a)), { start: at(2026, 3, 4, 9, 30), end: at(2026, 3, 4, 11) }));
    expect(r.ok).toBe(false);
    expect(runFix(spaces, 'dev', (read) => planTrimFirst(read(ref(a)), read(ref(b)), NOW)).ok).toBe(false);
    expect(times()).toEqual(before);
  });
  it('leaves a running entry running when its start moves', () => {
    const { spaces, p, add, ref } = setup();
    const a = add('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
    const started = startTimer(new Map([['personal', p]]), 'personal', 'dev', { description: 'run' }, at(2026, 3, 4, 10, 30));
    const r = runFix(spaces, 'dev', (read) => planStartNextEarlier(read({ spaceId: 'personal', id: started.id }), { start: at(2026, 3, 4, 10), end: at(2026, 3, 4, 10, 30) }));
    expect(r.ok).toBe(true);
    const run = liveEntries(p).find((x) => x.id === started.id)!;
    expect(isRunning(run)).toBe(true);
    expect(new Date(run.start).getTime()).toBe(at(2026, 3, 4, 10));
    expect(a).toBeTruthy();
    expect(ref(a).id).toBe(a);
  });
  it('works across midnight', () => {
    const { spaces, add, ref, times } = setup();
    const a = add('night', at(2026, 3, 4, 22), at(2026, 3, 5, 2));
    const b = add('early', at(2026, 3, 5, 1), at(2026, 3, 5, 3));
    expect(runFix(spaces, 'dev', (read) => planTrimFirst(read(ref(a)), read(ref(b)), NOW + 24 * H)).ok).toBe(true);
    expect(times()[0]).toEqual(['night', at(2026, 3, 4, 22), at(2026, 3, 5, 1)]);
  });
});

describe('real time on daylight-saving days', () => {
  describe('Europe/Berlin 25-hour day', () => {
    useTimeZone('Europe/Berlin');
    it('trims by real time inside the repeated hour', () => {
      const { spaces, add, ref, times } = setup();
      const first = at(2026, 10, 25, 2, 30); // summer time, 00:30 UTC
      const a = add('a', first, first + 90 * MIN);
      const b = add('b', first + 60 * MIN, first + 120 * MIN); // 02:30 again, winter time
      const r = runFix(spaces, 'dev', (read) => planTrimFirst(read(ref(a)), read(ref(b)), first + 24 * H));
      expect(r.ok).toBe(true);
      expect(times()[0]).toEqual(['a', first, first + 60 * MIN]);
    });
  });
  describe('America/New_York 23-hour day', () => {
    useTimeZone('America/New_York');
    it('extends across the skipped hour by real time', () => {
      const a = e('a', at(2026, 3, 8, 1), at(2026, 3, 8, 2)); // ends at the jump: 03:00 local
      const gap = { start: a.end!, end: at(2026, 3, 8, 3, 20) };
      expect(gap.end - gap.start).toBe(20 * MIN);
      expect(planExtendPrevious(a, gap)).toMatchObject({ ok: true, steps: [{ stop: gap.end }] });
    });
  });
});

describe('drag plan', () => {
  const a = e('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
  it('moves one edge', () => {
    expect(planDrag(a, a, 'stop', at(2026, 3, 4, 10, 15))).toMatchObject({ ok: true, steps: [{ kind: 'edit', stop: at(2026, 3, 4, 10, 15) }] });
    expect(planDrag(a, a, 'start', at(2026, 3, 4, 8, 30))).toMatchObject({ ok: true, steps: [{ kind: 'edit', start: at(2026, 3, 4, 8, 30) }] });
  });
  it('refuses when the entry changed or was deleted during the drag', () => {
    expect(planDrag(undefined, a, 'stop', a.end as number).ok).toBe(false);
    expect(planDrag(e('a', a.start, (a.end as number) + MIN), a, 'stop', a.start + 2 * H).ok).toBe(false);
  });
  it('writes nothing when nothing changes, and never crosses the other edge', () => {
    expect(planDrag(a, a, 'stop', a.end as number).ok).toBe(false);
    expect(planDrag(a, a, 'stop', a.start - MIN).ok).toBe(false);
    expect(planDrag(a, a, 'start', (a.end as number) + MIN).ok).toBe(false);
  });
  it('gives a running entry no stop', () => {
    const run = e('r', at(2026, 3, 4, 9), null);
    expect(planDrag(run, run, 'stop', at(2026, 3, 4, 10)).ok).toBe(false);
    expect(planDrag(run, run, 'start', at(2026, 3, 4, 8))).toMatchObject({ ok: true });
  });
});

describe('runFix with a drag', () => {
  useTimeZone('Europe/Berlin');
  it('moves the edge in one change, Undo puts it back, and a changed entry is refused', () => {
    const { spaces, add, ref, times } = setup();
    const a = add('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
    const before = times();
    const o = e('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10));
    const r = runFix(spaces, 'dev', (read) => planDrag(read(ref(a)), o, 'stop', at(2026, 3, 4, 10, 25)));
    expect(r.ok).toBe(true);
    expect(times()).toEqual([['a', at(2026, 3, 4, 9), at(2026, 3, 4, 10, 25)]]);
    if (r.ok) r.undo();
    expect(times()).toEqual(before);
    const stale = runFix(spaces, 'dev', (read) => planDrag(read(ref(a)), e('a', at(2026, 3, 4, 9), at(2026, 3, 4, 10, 5)), 'stop', at(2026, 3, 4, 10, 25)));
    expect(stale.ok).toBe(false);
    expect(times()).toEqual(before);
  });
});
