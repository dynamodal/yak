import { describe, expect, test } from 'vitest';
import { type ReportOptions, NO_FILTERS, buildReport } from './aggregate';
import { rangeDays } from './dates';
import { copyAllText, buildTimesheet, formatTenths, invoiceLines, roundTenths, timesheetBy } from './timesheet';
import { at, client, entry, project, source, useTimeZone } from './testing';

const MIN = 60_000;

function report(src: ReturnType<typeof source>, range: { from: number; to: number }, groupBy: ReportOptions['groupBy'] = 'project') {
  return buildReport(src, { now: at(2025, 12, 31), range, weekStart: 'monday', filters: NO_FILTERS, groupBy, thenBy: null, multiSpace: false });
}

describe('rounding', () => {
  test('nearest tenth, half up', () => {
    expect(roundTenths(2 * MIN)).toBe(0); // 0.033 h
    expect(roundTenths(3 * MIN)).toBe(1); // exactly 0.05 h rounds up
    expect(roundTenths(9 * MIN)).toBe(2); // 0.15 h
    expect(roundTenths(8 * MIN)).toBe(1);
    expect(roundTenths(0)).toBe(0);
  });
  test('formats one decimal', () => {
    expect(formatTenths(0)).toBe('0.0');
    expect(formatTenths(12)).toBe('1.2');
    expect(formatTenths(80)).toBe('8.0');
  });
  test('no float artifacts on many small sums', () => {
    expect(formatTenths(roundTenths(7 * 3_600_000 + 18 * MIN))).toBe('7.3');
  });
});

describe('timesheet (Europe/Berlin)', () => {
  useTimeZone('Europe/Berlin');
  const wk = () => ({ from: at(2025, 3, 24), to: at(2025, 3, 31) });

  test('rounds per day; totals are sums of rounded days', () => {
    const src = source({
      projects: [project({ id: 'p1', name: 'Alpha' })],
      entries: [
        // Mon: 3 + 3 min -> 0.1 per entry would give 0.2; the day is 6 min -> 0.1
        entry({ startMs: at(2025, 3, 24, 9), endMs: at(2025, 3, 24, 9, 3), projectId: 'p1', description: 'a' }),
        entry({ startMs: at(2025, 3, 24, 10), endMs: at(2025, 3, 24, 10, 3), projectId: 'p1', description: 'b' }),
        // Tue: 2 min -> 0.0
        entry({ startMs: at(2025, 3, 25, 9), endMs: at(2025, 3, 25, 9, 2), projectId: 'p1', description: 'c' }),
        // Wed: 1 h 20 -> 1.3
        entry({ startMs: at(2025, 3, 26, 9), endMs: at(2025, 3, 26, 10, 20), projectId: 'p1', description: 'd' }),
      ],
    });
    const ts = buildTimesheet(report(src, wk()), 'project');
    const row = ts.rows[0]!;
    expect(row.days.map((d) => d.tenths)).toEqual([1, 0, 13, 0, 0, 0, 0]);
    expect(row.totalTenths).toBe(14);
    expect(ts.totalTenths).toBe(14);
    expect(invoiceLines(row).map((l) => `${l.text} | ${l.hours}`)).toEqual(['2025-03-24 - a; b | 0.1', '2025-03-26 - d | 1.3']);
  });

  test('note: distinct descriptions merged like Group by description, in order of first start, blanks skipped', () => {
    const src = source({
      entries: [
        entry({ startMs: at(2025, 3, 24, 14), endMs: at(2025, 3, 24, 15), description: 'Review' }),
        entry({ startMs: at(2025, 3, 24, 9), endMs: at(2025, 3, 24, 10), description: '  Design ' }),
        entry({ startMs: at(2025, 3, 24, 11), endMs: at(2025, 3, 24, 12), description: '   ' }),
        entry({ startMs: at(2025, 3, 24, 12), endMs: at(2025, 3, 24, 13), description: 'design' }),
      ],
    });
    const row = buildTimesheet(report(src, wk()), 'project').rows[0]!;
    expect(row.days[0]!.note).toBe('Design; Review');
    expect(row.days[0]!.tenths).toBe(40);
  });

  test('a day with only empty descriptions has an empty note; the line is just the date', () => {
    const src = source({ entries: [entry({ startMs: at(2025, 3, 24, 9), endMs: at(2025, 3, 24, 10), description: '' })] });
    const row = buildTimesheet(report(src, wk()), 'project').rows[0]!;
    expect(row.days[0]!.note).toBe('');
    expect(invoiceLines(row)).toEqual([{ day: '2025-03-24', text: '2025-03-24', hours: '1.0' }]);
  });

  test('an entry over midnight splits between days', () => {
    const src = source({ entries: [entry({ startMs: at(2025, 3, 24, 23), endMs: at(2025, 3, 25, 2, 30), description: 'Night' })] });
    const row = buildTimesheet(report(src, wk()), 'project').rows[0]!;
    expect(row.days.slice(0, 3).map((d) => d.tenths)).toEqual([10, 25, 0]);
    expect(row.days[1]!.note).toBe('Night');
  });

  test('DST day has 23 hours: an all-day entry rounds to 23.0 h', () => {
    const src = source({ entries: [entry({ startMs: at(2025, 3, 30), endMs: at(2025, 3, 31), description: 'Long' })] });
    const row = buildTimesheet(report(src, wk()), 'project').rows[0]!;
    expect(row.days[6]!.tenths).toBe(230);
    expect(rangeDays(wk())).toHaveLength(7);
  });

  test('rows follow client or project; other Group by falls back to project', () => {
    expect(timesheetBy('client')).toBe('client');
    expect(timesheetBy('tag')).toBe('project');
    const src = source({
      clients: [client({ id: 'c1', name: 'Acme' })],
      projects: [project({ id: 'p1', name: 'A', clientId: 'c1' }), project({ id: 'p2', name: 'B', clientId: 'c1' })],
      entries: [
        entry({ startMs: at(2025, 3, 24, 9), endMs: at(2025, 3, 24, 10), projectId: 'p1' }),
        entry({ startMs: at(2025, 3, 24, 11), endMs: at(2025, 3, 24, 12), projectId: 'p2' }),
      ],
    });
    expect(buildTimesheet(report(src, wk()), 'client').rows).toHaveLength(1);
    expect(buildTimesheet(report(src, wk()), 'description').rows).toHaveLength(2);
  });

  test('all-spaces labels and labels that are all spaces pass through', () => {
    const src = source({
      projects: [project({ id: 'p1', name: '   ' })],
      entries: [entry({ startMs: at(2025, 3, 24, 9), endMs: at(2025, 3, 24, 10), projectId: 'p1', description: 'x' })],
    });
    const ts = buildTimesheet(report(src, wk()), 'project');
    expect(ts.rows).toHaveLength(1);
    expect(typeof ts.rows[0]!.label).toBe('string');
  });

  test('copy all is tab separated and skips zero days', () => {
    expect(copyAllText([{ day: '2025-03-24', text: '2025-03-24 - a\tb', hours: '1.5' }, { day: '2025-03-25', text: '2025-03-25 - c', hours: '0.1' }])).toBe(
      '2025-03-24 - a b\t1.5\n2025-03-25 - c\t0.1',
    );
  });
});
