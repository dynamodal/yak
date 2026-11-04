import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { type EntryRecord } from './entries';
import { at, useTimeZone } from './testing';
import { blockText, dragEdge, snapMinutes, wallToMs, cutByDay, DEFAULT_HOUR_PX, drawnBox, drawnPosition, gapLabelFits, minutesToPx, openingScrollTop, pxToMinutes, scrollForZoom, ZOOM_LEVELS, zoomLevel, zoomStep, entryBlocks, findGaps, findOverlaps, layoutLanes, minutesText, spansTouching } from './timeline';

const MIN = 60_000;
const H = 60 * MIN;
const span = (id: string, start: number, end: number) => ({ id, start, end });
const day = (y: number, mo: number, d: number) => ({ from: at(y, mo, d), to: addDays(at(y, mo, d), 1) });

describe('cutByDay', () => {
  useTimeZone('Europe/Berlin');
  it('cuts at local midnight and clips to the range', () => {
    const range = { from: at(2026, 3, 4), to: at(2026, 3, 6) };
    const pieces = cutByDay([span('a', at(2026, 3, 3, 22), at(2026, 3, 5, 2))], range);
    expect(pieces.map((p) => [p.day, p.start, p.end])).toEqual([
      ['2026-03-04', at(2026, 3, 4), at(2026, 3, 5)],
      ['2026-03-05', at(2026, 3, 5), at(2026, 3, 5, 2)],
    ]);
  });
});

describe('spansTouching', () => {
  useTimeZone('Europe/Berlin');
  it('keeps entries that began before the range and drops ones that end at its start', () => {
    const entry = (id: string, start: number, stop: number | null): EntryRecord => ({ id, start: new Date(start).toISOString(), stop: stop === null ? null : new Date(stop).toISOString() }) as EntryRecord;
    const range = day(2026, 3, 4);
    const now = at(2026, 3, 4, 12);
    const found = spansTouching(
      [entry('night', at(2026, 3, 3, 23), at(2026, 3, 4, 1)), entry('before', at(2026, 3, 3, 8), at(2026, 3, 4)), entry('run', at(2026, 3, 4, 11), null), entry('zero', at(2026, 3, 4, 9), at(2026, 3, 4, 9))],
      range,
      now,
    );
    expect(found.map((s) => s.id)).toEqual(['night', 'run']);
    expect(found[1]?.end).toBe(now);
  });
});

describe('findOverlaps', () => {
  it('needs a minute of real time', () => {
    expect(findOverlaps([span('a', 0, 10 * MIN), span('b', 10 * MIN, 20 * MIN)])).toEqual([]);
    expect(findOverlaps([span('a', 0, 10 * MIN), span('b', 9.5 * MIN, 20 * MIN)])).toEqual([]);
    expect(findOverlaps([span('a', 0, 10 * MIN), span('b', 9 * MIN, 20 * MIN)])).toEqual([{ firstId: 'a', secondId: 'b', start: 9 * MIN, end: 10 * MIN }]);
  });
  it('reports one inside another and every pair of three', () => {
    const found = findOverlaps([span('outer', 0, 60 * MIN), span('inner', 10 * MIN, 20 * MIN), span('c', 15 * MIN, 30 * MIN)]);
    expect(found.map((o) => [o.firstId, o.secondId, o.start, o.end])).toEqual([
      ['outer', 'inner', 10 * MIN, 20 * MIN],
      ['outer', 'c', 15 * MIN, 30 * MIN],
      ['inner', 'c', 15 * MIN, 20 * MIN],
    ]);
  });
});

describe('findGaps', () => {
  useTimeZone('Europe/Berlin');
  const range = day(2026, 3, 4);
  const late = at(2026, 3, 4, 23);
  it('finds 15 minutes or more between entries of one day', () => {
    const gaps = findGaps([span('a', at(2026, 3, 4, 8), at(2026, 3, 4, 9)), span('b', at(2026, 3, 4, 9, 14), at(2026, 3, 4, 10)), span('c', at(2026, 3, 4, 10, 15), at(2026, 3, 4, 11))], range, late);
    expect(gaps.map((g) => [g.start, g.end])).toEqual([[at(2026, 3, 4, 10), at(2026, 3, 4, 10, 15)]]);
  });
  it('ignores time before the first entry and after the last, and days with one entry', () => {
    expect(findGaps([span('a', at(2026, 3, 4, 8), at(2026, 3, 4, 9))], range, late)).toEqual([]);
  });
  it('does not count an entry that hides the space as a gap', () => {
    expect(findGaps([span('a', at(2026, 3, 4, 8), at(2026, 3, 4, 12)), span('b', at(2026, 3, 4, 9), at(2026, 3, 4, 9, 30)), span('c', at(2026, 3, 4, 12, 5), at(2026, 3, 4, 13))], range, late)).toEqual([]);
  });
  it('never reports time after now; a running entry ends at now', () => {
    const now = at(2026, 3, 4, 12);
    const gaps = findGaps([span('a', at(2026, 3, 4, 8), at(2026, 3, 4, 9)), span('r', at(2026, 3, 4, 11), now)], range, now);
    expect(gaps.map((g) => [g.start, g.end])).toEqual([[at(2026, 3, 4, 9), at(2026, 3, 4, 11)]]);
    expect(findGaps([span('a', at(2026, 3, 4, 8), at(2026, 3, 4, 9)), span('f', at(2026, 3, 4, 14), at(2026, 3, 4, 15))], range, at(2026, 3, 4, 12))).toEqual([]);
  });
  it('treats midnight as a day edge', () => {
    const two = { from: at(2026, 3, 4), to: at(2026, 3, 6) };
    expect(findGaps([span('n', at(2026, 3, 4, 22), at(2026, 3, 5, 1)), span('m', at(2026, 3, 5, 3), at(2026, 3, 5, 4))], two, at(2026, 3, 6))).toEqual([
      expect.objectContaining({ day: '2026-03-05', start: at(2026, 3, 5, 1), end: at(2026, 3, 5, 3) }),
    ]);
  });
});

describe('daylight saving', () => {
  describe('Europe/Berlin', () => {
    useTimeZone('Europe/Berlin');
    it('the 25-hour day measures real time and draws the repeated hour on one row', () => {
      const range = day(2026, 10, 25);
      expect(range.to - range.from).toBe(25 * H);
      // 02:50 (summer time) to 02:30 (winter time) is 40 real minutes, drawn to the end of the 02:00 row
      expect(drawnPosition(at(2026, 10, 25, 2, 50), at(2026, 10, 25, 2, 50) + 40 * MIN, range.from)).toEqual({ top: 170, bottom: 180 });
      const start = at(2026, 10, 25, 2, 30);
      const second = start + 60 * MIN;
      expect(drawnPosition(second, second + 20 * MIN, range.from)).toEqual({ top: 150, bottom: 170 });
      // a real overlap is decided by real time, not by the drawn rows
      expect(findOverlaps([span('a', start, start + 30 * MIN), span('b', second, second + 30 * MIN)])).toEqual([]);
      const items = [span('a', start, start + 30 * MIN), span('b', second, second + 30 * MIN)];
      expect(layoutLanes(items, range.from).map((p) => [p.lane, p.lanes])).toEqual([[0, 2], [1, 2]]);
      expect(findGaps([span('x', at(2026, 10, 25, 1), at(2026, 10, 25, 2, 30)), span('y', at(2026, 10, 25, 3), at(2026, 10, 25, 4))], range, at(2026, 10, 26))).toEqual([
        expect.objectContaining({ start: at(2026, 10, 25, 2, 30) - 0, end: at(2026, 10, 25, 3) }),
      ]);
    });
    it('the 23-hour day: the skipped hour is not a gap', () => {
      const range = day(2026, 3, 29);
      expect(range.to - range.from).toBe(23 * H);
      const a = span('a', at(2026, 3, 29, 1), at(2026, 3, 29, 2)); // 01:00-01:59 .. real hour ends at the jump
      const b = span('b', at(2026, 3, 29, 3), at(2026, 3, 29, 4));
      expect(a.end).toBe(b.start);
      expect(findGaps([a, b], range, at(2026, 3, 30))).toEqual([]);
      expect(drawnPosition(b.start, b.end, range.from)).toEqual({ top: 180, bottom: 240 });
      expect(drawnPosition(at(2026, 3, 29, 23), at(2026, 3, 30), range.from).bottom).toBe(1440);
    });
  });
  describe('America/New_York', () => {
    useTimeZone('America/New_York');
    it('25-hour day 2026-11-01 and 23-hour day 2026-03-08', () => {
      const fall = day(2026, 11, 1);
      expect(fall.to - fall.from).toBe(25 * H);
      const first = at(2026, 11, 1, 1, 30);
      const again = first + 60 * MIN;
      expect(findOverlaps([span('a', first, first + 45 * MIN), span('b', again, again + 45 * MIN)])).toEqual([]);
      expect(findOverlaps([span('a', first, first + 75 * MIN), span('b', again, again + 45 * MIN)])).toHaveLength(1);
      expect(findGaps([span('a', at(2026, 11, 1, 0), first), span('b', again, again + H)], fall, at(2026, 11, 2))).toEqual([
        expect.objectContaining({ start: first, end: again }),
      ]);
      const spring = day(2026, 3, 8);
      expect(spring.to - spring.from).toBe(23 * H);
      expect(findGaps([span('a', at(2026, 3, 8, 1), at(2026, 3, 8, 2)), span('b', at(2026, 3, 8, 3), at(2026, 3, 8, 4))], spring, at(2026, 3, 9))).toEqual([]);
    });
  });
});

describe('layoutLanes', () => {
  useTimeZone('Europe/Berlin');
  const start = at(2026, 3, 4);
  it('puts overlapping items side by side and lets lanes be reused', () => {
    const items = [span('a', at(2026, 3, 4, 8), at(2026, 3, 4, 10)), span('b', at(2026, 3, 4, 9), at(2026, 3, 4, 11)), span('c', at(2026, 3, 4, 10), at(2026, 3, 4, 12)), span('d', at(2026, 3, 4, 14), at(2026, 3, 4, 15))];
    expect(layoutLanes(items, start).map((p) => [p.item.id, p.lane, p.lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1]]);
  });
});

describe('entryBlocks and text', () => {
  useTimeZone('Europe/Berlin');
  it('builds entries-layer blocks cut at midnight', () => {
    const e = { id: 'x', description: 'Task A', start: new Date(at(2026, 3, 3, 23)).toISOString(), stop: new Date(at(2026, 3, 4, 1)).toISOString() } as EntryRecord;
    const blocks = entryBlocks([e], day(2026, 3, 4), at(2026, 3, 4, 12), () => ({ title: 'Task A', color: '#336699' }));
    expect(blocks).toEqual([{ id: 'x', layer: 'entries', start: at(2026, 3, 4), end: at(2026, 3, 4, 1), title: 'Task A', color: '#336699', editable: false, running: false }]);
  });
  it('words minutes', () => {
    expect([minutesText(50 * MIN), minutesText(H), minutesText(65 * MIN), minutesText(10)]).toEqual(['50 min', '1 h', '1 h 5 min', '1 min']);
  });
});

describe('scale (T-68d)', () => {
  useTimeZone('Europe/Berlin');
  const MIN = 60_000;

  it('knows its levels, the default among them, and reads anything else as the default', () => {
    expect(ZOOM_LEVELS).toContain(DEFAULT_HOUR_PX);
    expect(DEFAULT_HOUR_PX).toBe(60);
    for (const px of ZOOM_LEVELS) expect(zoomLevel(px)).toBe(px);
    for (const bad of [undefined, null, 0, -60, 90, NaN, '60', 'x']) expect(zoomLevel(bad)).toBe(60);
  });

  it('steps one level and stops at the ends', () => {
    expect(zoomStep(60, 1)).toBe(120);
    expect(zoomStep(60, -1)).toBe(30);
    expect(zoomStep(ZOOM_LEVELS[ZOOM_LEVELS.length - 1] as number, 1)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
    expect(zoomStep(ZOOM_LEVELS[0] as number, -1)).toBe(ZOOM_LEVELS[0]);
    expect(zoomStep(77, 1)).toBe(120);
  });

  it('converts minutes and pixels both ways at every level', () => {
    for (const px of ZOOM_LEVELS) {
      expect(minutesToPx(60, px)).toBe(px);
      expect(pxToMinutes(minutesToPx(95, px), px)).toBeCloseTo(95);
    }
  });

  it('the top level makes five minutes tall enough for a line of text', () => {
    const top = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] as number;
    expect(blockText(minutesToPx(5, top)).title).toBe(true);
    expect(blockText(minutesToPx(5, DEFAULT_HOUR_PX)).title).toBe(false);
    expect(blockText(minutesToPx(15, DEFAULT_HOUR_PX)).title).toBe(true);
    expect(blockText(minutesToPx(15, DEFAULT_HOUR_PX)).subtitle).toBe(false);
    expect(blockText(minutesToPx(60, DEFAULT_HOUR_PX)).subtitle).toBe(true);
  });

  it('the shortest gap keeps its label at 60 px per hour and drops it at 30', () => {
    expect(gapLabelFits(minutesToPx(15, 60))).toBe(true);
    expect(gapLabelFits(minutesToPx(15, 30))).toBe(false);
    expect(gapLabelFits(minutesToPx(15, 240))).toBe(true);
  });

  it('draws a box from the drawn position and keeps thin ones visible', () => {
    expect(drawnBox({ top: 90, bottom: 150 }, 60)).toEqual({ top: 90, height: 60 });
    expect(drawnBox({ top: 90, bottom: 150 }, 240)).toEqual({ top: 360, height: 240 });
    expect(drawnBox({ top: 90, bottom: 150 }, 30)).toEqual({ top: 45, height: 30 });
    expect(drawnBox({ top: 90, bottom: 91 }, 30, 4).height).toBe(4);
    expect(drawnBox({ top: 90, bottom: 91 }, 240, 4).height).toBe(4);
  });

  it('on a 25-hour day the repeated hour is one row at every scale', () => {
    const dayStart = at(2026, 10, 25);
    const start = at(2026, 10, 25, 2, 50);
    const pos = drawnPosition(start, start + 40 * MIN, dayStart);
    expect(drawnBox(pos, 60)).toEqual({ top: 170, height: 10 });
    expect(drawnBox(pos, 120)).toEqual({ top: 340, height: 20 });
    expect(drawnBox(pos, 240)).toEqual({ top: 680, height: 40 });
  });

  it('on a 23-hour day an entry after the change sits at its wall clock position', () => {
    const dayStart = at(2026, 3, 29);
    const pos = drawnPosition(at(2026, 3, 29, 3), at(2026, 3, 29, 4), dayStart);
    expect(drawnBox(pos, 60)).toEqual({ top: 180, height: 60 });
    expect(drawnBox(pos, 240)).toEqual({ top: 720, height: 240 });
  });

  it('opens 30 minutes before the first entry, or at 08:00, at any scale', () => {
    expect(openingScrollTop(9 * 60, 60)).toBe(510);
    expect(openingScrollTop(9 * 60, 240)).toBe(2040);
    expect(openingScrollTop(undefined, 60)).toBe(480);
    expect(openingScrollTop(undefined, 30)).toBe(240);
    expect(openingScrollTop(10, 240)).toBe(0);
  });

  it('keeps the middle of the visible grid on the same time when the scale changes', () => {
    const view = 400;
    for (const [from, to] of [[60, 120], [120, 60], [60, 240], [240, 30]] as const) {
      const scrollTop = 2000;
      const middleBefore = pxToMinutes(scrollTop + view / 2, from);
      const next = scrollForZoom(scrollTop, view, from, to);
      expect(pxToMinutes(next + view / 2, to)).toBeCloseTo(middleBefore);
    }
    expect(scrollForZoom(0, 400, 120, 30)).toBe(0);
  });
});

describe('dragging an edge (T-68e)', () => {
  const MIN = 60_000;
  describe('Europe/Berlin', () => {
    useTimeZone('Europe/Berlin');
    let dayStart = 0;
    let span = { start: 0, end: 0 };
    beforeEach(() => {
      dayStart = at(2026, 6, 10);
      span = { start: at(2026, 6, 10, 9), end: at(2026, 6, 10, 10) };
    });

    it('snaps to 5 minutes', () => {
      expect([0, 2, 3, 7.4, 7.6, 62].map((m) => snapMinutes(m))).toEqual([0, 0, 5, 5, 10, 60]);
    });

    it('moves the stop to the snapped pointer time at every scale', () => {
      for (const px of ZOOM_LEVELS) {
        const y = minutesToPx(10 * 60 + 23, px);
        const r = dragEdge('stop', pxToMinutes(y, px), span, dayStart);
        expect(r).toEqual({ time: at(2026, 6, 10, 10, 25), changed: true });
      }
    });

    it('one snap step is five minutes of pointer travel at 240 and still five at 30', () => {
      for (const px of [30, 240]) {
        const r = dragEdge('start', pxToMinutes(minutesToPx(9 * 60, px) + minutesToPx(5, px), px), span, dayStart);
        expect(r.time).toBe(at(2026, 6, 10, 9, 5));
      }
    });

    it('cannot cross the other edge: a snap step is left', () => {
      expect(dragEdge('start', 11 * 60, span, dayStart).time).toBe(at(2026, 6, 10, 9, 55));
      expect(dragEdge('stop', 8 * 60, span, dayStart).time).toBe(at(2026, 6, 10, 9, 5));
    });

    it('an entry already shorter than a step can grow but not be pushed', () => {
      const short = { start: at(2026, 6, 10, 9), end: at(2026, 6, 10, 9) + 3 * MIN };
      expect(dragEdge('start', 9 * 60 + 2, short, dayStart)).toEqual({ time: short.start, changed: false });
      expect(dragEdge('stop', 9 * 60 + 20, short, dayStart).time).toBe(at(2026, 6, 10, 9, 20));
    });

    it('stays inside the day and writes nothing when nothing changes', () => {
      expect(dragEdge('stop', 5000, span, dayStart).time).toBe(at(2026, 6, 11));
      expect(dragEdge('start', -50, span, dayStart).time).toBe(dayStart);
      expect(dragEdge('stop', 10 * 60 + 1, span, dayStart)).toEqual({ time: span.end, changed: false });
    });

    it('a running entry uses now as its end', () => {
      const now = at(2026, 6, 10, 12, 7);
      expect(dragEdge('start', 12 * 60 + 5, { start: at(2026, 6, 10, 11), end: now }, dayStart).time).toBe(at(2026, 6, 10, 12, 2));
    });
  });

  describe('Berlin daylight saving', () => {
    useTimeZone('Europe/Berlin');
    it('25-hour day: the repeated hour is the first occurrence, and a stop never lands before the start', () => {
      const dayStart = at(2026, 10, 25);
      const first = wallToMs(dayStart, 2 * 60 + 30);
      expect(first).toBe(at(2026, 10, 25, 2, 30));
      expect(wallToMs(dayStart, 1440)).toBe(addDays(dayStart, 1));
      // an entry that started in the second 02:xx; dragging its stop to 02:40 lands on the first occurrence, so a step is kept
      const secondStart = first + 60 * MIN;
      const r = dragEdge('stop', 2 * 60 + 40, { start: secondStart, end: secondStart + 30 * MIN }, dayStart);
      expect(r.time).toBeGreaterThanOrEqual(secondStart + 5 * MIN);
    });

    it('23-hour day: the skipped hour lands an hour later and the day end is the next midnight', () => {
      const dayStart = at(2026, 3, 29);
      expect(wallToMs(dayStart, 2 * 60 + 30)).toBe(at(2026, 3, 29, 3, 30));
      expect(wallToMs(dayStart, 4 * 60)).toBe(at(2026, 3, 29, 4));
      expect(wallToMs(dayStart, 1440)).toBe(addDays(dayStart, 1));
    });
  });

  describe('New York daylight saving', () => {
    useTimeZone('America/New_York');
    it('gives the same answers', () => {
      expect(wallToMs(at(2026, 11, 1), 1440)).toBe(addDays(at(2026, 11, 1), 1));
      expect(wallToMs(at(2026, 3, 8), 2 * 60 + 15)).toBe(at(2026, 3, 8, 3, 15));
      expect(wallToMs(at(2026, 3, 8), 4 * 60)).toBe(at(2026, 3, 8, 4));
    });
  });
});
