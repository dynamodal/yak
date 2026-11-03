import { describe, expect, test } from 'vitest';
import { canStepNext, dayKey, dayLabel, dayShortLabel, parseDayKey, presetFor, rangeDays, resolveRange, startOfWeek, stepRange, toCustom } from './dates';
import { splitByDay } from '../core/split-by-day';
import { at, useTimeZone } from './testing';

const H = 3_600_000;

describe('day keys', () => {
  useTimeZone('Europe/Berlin');

  test('format and parse round-trip in local time', () => {
    expect(dayKey(at(2025, 3, 5, 23, 59))).toBe('2025-03-05');
    expect(parseDayKey('2025-03-05')).toBe(at(2025, 3, 5));
  });

  test('rejects invalid dates', () => {
    expect(parseDayKey('2025-02-30')).toBeUndefined();
    expect(parseDayKey('2025-3-5')).toBeUndefined();
    expect(parseDayKey('')).toBeUndefined();
  });

  test('fixed English labels', () => {
    expect(dayLabel('2025-03-03')).toBe('Mon 2025-03-03');
    expect(dayShortLabel('2025-03-09')).toBe('Sun 9');
  });
});

describe('presets (Wednesday 2025-03-12)', () => {
  useTimeZone('Europe/Berlin');
  const now = at(2025, 3, 12, 10, 30);

  test('today', () => {
    expect(resolveRange('today', now, 'monday')).toEqual({ from: at(2025, 3, 12), to: at(2025, 3, 13) });
  });

  test('weeks start on Monday', () => {
    expect(resolveRange('this_week', now, 'monday')).toEqual({ from: at(2025, 3, 10), to: at(2025, 3, 17) });
    expect(resolveRange('last_week', now, 'monday')).toEqual({ from: at(2025, 3, 3), to: at(2025, 3, 10) });
  });

  test('on a Sunday the Monday week still ends that day', () => {
    const sunday = at(2025, 3, 16, 23, 0);
    expect(resolveRange('this_week', sunday, 'monday')).toEqual({ from: at(2025, 3, 10), to: at(2025, 3, 17) });
  });

  test('on a Monday the week starts that day', () => {
    expect(startOfWeek(at(2025, 3, 10, 0, 0), 'monday')).toBe(at(2025, 3, 10));
  });

  test('Sunday-start weeks when the setting says so', () => {
    expect(resolveRange('this_week', now, 'sunday')).toEqual({ from: at(2025, 3, 9), to: at(2025, 3, 16) });
  });

  test('months and year', () => {
    expect(resolveRange('this_month', now, 'monday')).toEqual({ from: at(2025, 3, 1), to: at(2025, 4, 1) });
    expect(resolveRange('last_month', now, 'monday')).toEqual({ from: at(2025, 2, 1), to: at(2025, 3, 1) });
    expect(resolveRange('this_year', now, 'monday')).toEqual({ from: at(2025, 1, 1), to: at(2026, 1, 1) });
  });

  test('last month in January is December of the previous year', () => {
    expect(resolveRange('last_month', at(2025, 1, 15), 'monday')).toEqual({ from: at(2024, 12, 1), to: at(2025, 1, 1) });
  });

  test('custom ranges include both end days', () => {
    expect(resolveRange('custom', now, 'monday', { from: '2025-03-03', to: '2025-03-05' })).toEqual({ from: at(2025, 3, 3), to: at(2025, 3, 6) });
  });

  test('reversed custom ranges are swapped, one valid end is used for both, none means today', () => {
    expect(resolveRange('custom', now, 'monday', { from: '2025-03-05', to: '2025-03-03' })).toEqual({ from: at(2025, 3, 3), to: at(2025, 3, 6) });
    expect(resolveRange('custom', now, 'monday', { from: '2025-03-05', to: '' })).toEqual({ from: at(2025, 3, 5), to: at(2025, 3, 6) });
    expect(resolveRange('custom', now, 'monday', { from: 'x', to: 'y' })).toEqual({ from: at(2025, 3, 12), to: at(2025, 3, 13) });
    expect(resolveRange('custom', now, 'monday')).toEqual({ from: at(2025, 3, 12), to: at(2025, 3, 13) });
  });
});

describe.each(['Europe/Berlin', 'America/New_York', 'Pacific/Auckland', 'UTC'])('splitting in %s', (tz) => {
  useTimeZone(tz);
  const week = { get from() { return at(2025, 3, 3); }, get to() { return at(2025, 3, 10); } };

  test('an entry inside one day is one slice', () => {
    expect(splitByDay(at(2025, 3, 5, 9), at(2025, 3, 5, 11), week)).toEqual([{ day: '2025-03-05', ms: 2 * H }]);
  });

  test('an entry across midnight is split at midnight', () => {
    expect(splitByDay(at(2025, 3, 5, 22), at(2025, 3, 6, 2), week)).toEqual([
      { day: '2025-03-05', ms: 2 * H },
      { day: '2025-03-06', ms: 2 * H },
    ]);
  });

  test('an entry over several days gets whole-day slices in between', () => {
    const slices = splitByDay(at(2025, 3, 4, 12), at(2025, 3, 7, 6), week);
    expect(slices.map((s) => s.day)).toEqual(['2025-03-04', '2025-03-05', '2025-03-06', '2025-03-07']);
    expect(slices.reduce((a, s) => a + s.ms, 0)).toBe(66 * H);
  });

  test('time outside the range is dropped', () => {
    expect(splitByDay(at(2025, 3, 2, 22), at(2025, 3, 3, 2), week)).toEqual([{ day: '2025-03-03', ms: 2 * H }]);
    expect(splitByDay(at(2025, 3, 9, 23), at(2025, 3, 10, 5), week)).toEqual([{ day: '2025-03-09', ms: 1 * H }]);
    expect(splitByDay(at(2025, 3, 20, 9), at(2025, 3, 20, 10), week)).toEqual([]);
  });
});

describe('daylight-saving changes', () => {
  describe('Europe/Berlin', () => {
    useTimeZone('Europe/Berlin');
    const range = { get from() { return at(2025, 3, 24); }, get to() { return at(2025, 4, 1); } };

    test('the spring-forward day has 23 hours', () => {
      const slices = splitByDay(at(2025, 3, 30), at(2025, 3, 31), range);
      expect(slices).toEqual([{ day: '2025-03-30', ms: 23 * H }]);
    });

    test('an entry from 23:00 to 03:00 across the change lasted 3 real hours', () => {
      const slices = splitByDay(at(2025, 3, 29, 23), at(2025, 3, 30, 3), range);
      expect(slices).toEqual([
        { day: '2025-03-29', ms: 1 * H },
        { day: '2025-03-30', ms: 2 * H },
      ]);
    });

    test('the fall-back day has 25 hours and is one day', () => {
      const r = { from: at(2025, 10, 20), to: at(2025, 10, 28) };
      expect(splitByDay(at(2025, 10, 26), at(2025, 10, 27), r)).toEqual([{ day: '2025-10-26', ms: 25 * H }]);
      expect(rangeDays(r)).toHaveLength(8);
    });

    test('a week containing the change still lists 7 days', () => {
      expect(rangeDays(resolveRange('this_week', at(2025, 3, 26, 12), 'monday'))).toEqual([
        '2025-03-24', '2025-03-25', '2025-03-26', '2025-03-27', '2025-03-28', '2025-03-29', '2025-03-30',
      ]);
    });
  });

  describe('America/New_York', () => {
    useTimeZone('America/New_York');
    test('spring forward 2025-03-09 and fall back 2025-11-02', () => {
      const r1 = { from: at(2025, 3, 9), to: at(2025, 3, 10) };
      expect(splitByDay(at(2025, 3, 9), at(2025, 3, 10), r1)).toEqual([{ day: '2025-03-09', ms: 23 * H }]);
      const r2 = { from: at(2025, 11, 2), to: at(2025, 11, 3) };
      expect(splitByDay(at(2025, 11, 2), at(2025, 11, 3), r2)).toEqual([{ day: '2025-11-02', ms: 25 * H }]);
    });
  });
});

describe('stepping periods (#277)', () => {
  useTimeZone('Europe/Berlin');
  const now = at(2025, 3, 12, 10, 30); // Wednesday
  const day = (y: number, m: number, d: number) => ({ from: at(y, m, d), to: at(y, m, d + 1) });

  test('a day steps by one day, over month ends too', () => {
    expect(stepRange(day(2025, 3, 12), -1)).toEqual(day(2025, 3, 11));
    expect(stepRange(day(2025, 3, 1), -1)).toEqual({ from: at(2025, 2, 28), to: at(2025, 3, 1) });
    expect(stepRange(day(2025, 3, 31), 1)).toEqual(day(2025, 4, 1));
  });

  test('a week steps by seven days and keeps its week start', () => {
    const monday = resolveRange('this_week', now, 'monday');
    expect(stepRange(monday, -1)).toEqual(resolveRange('last_week', now, 'monday'));
    expect(stepRange(stepRange(monday, -1), 1)).toEqual(monday);
    const sunday = resolveRange('this_week', now, 'sunday');
    expect(stepRange(sunday, -1)).toEqual({ from: at(2025, 3, 2), to: at(2025, 3, 9) });
  });

  test('a week over a daylight-saving change is still seven calendar days', () => {
    const week = { from: at(2025, 3, 24), to: at(2025, 3, 31) };
    expect(stepRange(week, 1)).toEqual({ from: at(2025, 3, 31), to: at(2025, 4, 7) });
    expect(rangeDays(stepRange(week, -1))).toHaveLength(7);
  });

  test('a calendar month steps to the neighbouring month whatever its length', () => {
    const march = resolveRange('this_month', now, 'monday');
    expect(stepRange(march, -1)).toEqual({ from: at(2025, 2, 1), to: at(2025, 3, 1) });
    expect(stepRange(march, 1)).toEqual({ from: at(2025, 4, 1), to: at(2025, 5, 1) });
    expect(stepRange({ from: at(2025, 1, 1), to: at(2025, 2, 1) }, -1)).toEqual({ from: at(2024, 12, 1), to: at(2025, 1, 1) });
    expect(stepRange({ from: at(2024, 3, 1), to: at(2024, 4, 1) }, -1)).toEqual({ from: at(2024, 2, 1), to: at(2024, 3, 1) }); // leap February
  });

  test('a custom range that is a whole month steps by month', () => {
    const custom = resolveRange('custom', now, 'monday', { from: '2025-01-01', to: '2025-01-31' });
    expect(toCustom(stepRange(custom, 1))).toEqual({ from: '2025-02-01', to: '2025-02-28' });
  });

  test('a year steps to the neighbouring year', () => {
    const year = resolveRange('this_year', now, 'monday');
    expect(stepRange(year, -1)).toEqual({ from: at(2024, 1, 1), to: at(2025, 1, 1) });
    expect(stepRange(year, 1)).toEqual({ from: at(2026, 1, 1), to: at(2027, 1, 1) });
  });

  test('a custom range steps by its own length', () => {
    const ten = resolveRange('custom', now, 'monday', { from: '2025-03-05', to: '2025-03-14' });
    expect(toCustom(stepRange(ten, -1))).toEqual({ from: '2025-02-23', to: '2025-03-04' });
    expect(toCustom(stepRange(ten, 1))).toEqual({ from: '2025-03-15', to: '2025-03-24' });
  });

  test('Next is available only after the period has ended', () => {
    expect(canStepNext(resolveRange('this_week', now, 'monday'), now)).toBe(false);
    expect(canStepNext(resolveRange('today', now, 'monday'), now)).toBe(false);
    expect(canStepNext(resolveRange('last_week', now, 'monday'), now)).toBe(true);
    expect(canStepNext({ from: at(2025, 3, 5), to: at(2025, 3, 12) }, now)).toBe(true); // ends yesterday
    expect(canStepNext({ from: at(2025, 3, 20), to: at(2025, 3, 21) }, now)).toBe(false); // in the future
  });

  test('stepping from a preset equals the neighbouring preset', () => {
    const range = resolveRange('this_week', now, 'monday');
    expect(presetFor(stepRange(range, -1), now, 'monday')).toBe('last_week');
    expect(presetFor(stepRange(stepRange(range, -1), 1), now, 'monday')).toBe('this_week');
    expect(presetFor(stepRange(stepRange(range, -1), -1), now, 'monday')).toBe('custom');
    expect(presetFor(stepRange(resolveRange('this_month', now, 'monday'), -1), now, 'monday')).toBe('last_month');
  });
});
