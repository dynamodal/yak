import { describe, expect, test } from 'vitest';
import {
  type Filters,
  type ReportOptions,
  NONE,
  NO_FILTERS,
  applyFilters,
  buildReport,
  detailRows,
  filterChoices,
  granularityFor,
  groupSegments,
  resolveEntries,
  sortDetailRows,
  timeBuckets,
  toSegments,
} from './aggregate';
import { resolveRange } from './dates';
import { at, client, entry, project, source, useTimeZone } from './testing';

const H = 3_600_000;
const NOW = () => at(2025, 3, 12, 12);

function opts(over: Partial<ReportOptions> = {}): ReportOptions {
  return {
    now: NOW(),
    range: { from: at(2025, 3, 10), to: at(2025, 3, 17) },
    weekStart: 'monday',
    filters: NO_FILTERS,
    groupBy: 'project',
    thenBy: null,
    multiSpace: false,
    ...over,
  };
}

const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });

describe('aggregate (Europe/Berlin)', () => {
  useTimeZone('Europe/Berlin');

  const base = () =>
    source({
      clients: [client({ id: 'c1', name: 'Acme' }), client({ id: 'c2', name: 'Globex' })],
      projects: [
        project({ id: 'p1', name: 'Website', clientId: 'c1', rate: 100, currency: 'USD' }),
        project({ id: 'p2', name: 'Audit', clientId: 'c2', rate: 80, currency: 'EUR' }),
        project({ id: 'p3', name: 'Internal', clientId: null, rate: null }),
      ],
      entries: [
        entry({ startMs: at(2025, 3, 10, 9), endMs: at(2025, 3, 10, 11), projectId: 'p1', billable: true, description: 'Design', tags: ['ui', 'review'] }),
        entry({ startMs: at(2025, 3, 11, 9), endMs: at(2025, 3, 11, 10, 30), projectId: 'p2', billable: true, description: 'Audit work' }),
        entry({ startMs: at(2025, 3, 11, 13), endMs: at(2025, 3, 11, 14), projectId: 'p3', billable: false, description: 'Admin', tags: ['ops'] }),
        entry({ startMs: at(2025, 3, 12, 8), endMs: at(2025, 3, 12, 9), billable: false, description: 'design' }),
      ],
    });

  test('totals: duration, billable duration and amounts per currency', () => {
    const r = buildReport(base(), opts());
    expect(r.totals.ms).toBe(5.5 * H);
    expect(r.totals.billableMs).toBe(3.5 * H);
    expect(r.totals.amounts).toEqual({ USD: 200, EUR: 120 });
  });

  test('billable time on a project without a rate has no amount', () => {
    const s = source({
      projects: [project({ id: 'p', rate: null })],
      entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'p', billable: true })],
    });
    const r = buildReport(s, opts());
    expect(r.totals.billableMs).toBe(H);
    expect(r.totals.amounts).toEqual({});
  });

  test('a zero rate yields a zero amount, which is still an amount', () => {
    const s = source({
      projects: [project({ id: 'p', rate: 0 })],
      entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'p', billable: true })],
    });
    expect(buildReport(s, opts()).totals.amounts).toEqual({ USD: 0 });
  });

  test('non-billable entries carry no amount even on a rated project', () => {
    const s = source({
      projects: [project({ id: 'p', rate: 100 })],
      entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'p', billable: false })],
    });
    expect(buildReport(s, opts()).totals.amounts).toEqual({});
  });

  test('amounts follow the hours, including part hours', () => {
    const s = source({
      projects: [project({ id: 'p', rate: 90 })],
      entries: [entry({ startMs: at(2025, 3, 10, 9), endMs: at(2025, 3, 10, 9, 20), projectId: 'p', billable: true })],
    });
    expect(buildReport(s, opts()).totals.amounts.USD).toBeCloseTo(30, 10);
  });

  describe('entries that are left out or special', () => {
    test('deleted entries do not count', () => {
      const s = base();
      s.entries.push(entry({ startMs: at(2025, 3, 10, 14), endMs: at(2025, 3, 10, 20), deleted: true }));
      expect(buildReport(s, opts()).totals.ms).toBe(5.5 * H);
    });

    test('invalid dates are skipped instead of throwing', () => {
      const s = base();
      s.entries.push({ ...entry({ startMs: 0 }), start: 'not a date' });
      s.entries.push({ ...entry({ startMs: at(2025, 3, 10, 9) }), stop: 'nonsense' });
      expect(buildReport(s, opts()).totals.ms).toBe(5.5 * H);
    });

    test('a stop before the start counts as zero, not negative time', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 10), endMs: at(2025, 3, 10, 9) })] });
      expect(buildReport(s, opts()).totals.ms).toBe(0);
    });

    test('a running entry counts up to now', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 12, 10), endMs: null, billable: true })] });
      const r = buildReport(s, opts());
      expect(r.totals.ms).toBe(2 * H);
      expect(r.totals.billableMs).toBe(2 * H);
      expect(r.hasRunning).toBe(true);
      expect(buildReport(s, opts({ now: at(2025, 3, 12, 10, 30) })).totals.ms).toBe(0.5 * H);
    });

    test('a running entry started before now-in-the-future is never negative', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 12, 14), endMs: null })] });
      expect(buildReport(s, opts({ now: at(2025, 3, 12, 12) })).totals.ms).toBe(0);
    });

    test('a running entry that crossed midnight is split between both days', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 11, 23), endMs: null })] });
      const r = buildReport(s, opts({ now: at(2025, 3, 12, 2) }));
      expect(r.groups).toHaveLength(1);
      const days = groupSegments(r.segments, 'day');
      expect(days.map((d) => [d.key, d.ms])).toEqual([
        ['2025-03-11', 1 * H],
        ['2025-03-12', 2 * H],
      ]);
    });

    test('an entry crossing midnight splits across days but not in the detailed view', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 22), endMs: at(2025, 3, 11, 3) })] });
      const r = buildReport(s, opts());
      expect(groupSegments(r.segments, 'day').map((d) => [d.key, d.ms])).toEqual([
        ['2025-03-10', 2 * H],
        ['2025-03-11', 3 * H],
      ]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.ms).toBe(5 * H);
      expect(r.rows[0]?.day).toBe('2025-03-10');
    });

    test('an entry crossing the range edge counts only the part inside', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 9, 22), endMs: at(2025, 3, 10, 3) })] });
      const r = buildReport(s, opts());
      expect(r.totals.ms).toBe(3 * H);
      expect(r.rows[0]?.ms).toBe(3 * H);
    });

    test('entries outside the range are left out', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 17, 0), endMs: at(2025, 3, 17, 1) }), entry({ startMs: at(2025, 3, 9, 0), endMs: at(2025, 3, 9, 1) })] });
      expect(buildReport(s, opts()).segments).toEqual([]);
    });

    test('entries without a project form a group of their own', () => {
      const r = buildReport(base(), opts());
      const none = r.groups.find((g) => g.key === NONE);
      expect(none?.label).toBe('(No project)');
      expect(none?.ms).toBe(H);
    });

    test('archived projects still report their hours and are labelled', () => {
      const s = source({
        projects: [project({ id: 'old', name: 'Old job', active: false })],
        entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'old' })],
      });
      const r = buildReport(s, opts());
      expect(r.groups[0]?.label).toBe('Old job (archived)');
      expect(r.totals.ms).toBe(H);
    });

    test('deleted and dangling projects keep their hours', () => {
      const s = source({
        projects: [project({ id: 'gone', name: 'Gone', deleted: true })],
        entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'gone' }), entry({ startMs: at(2025, 3, 10, 11), projectId: 'missing' })],
      });
      const labels = buildReport(s, opts()).groups.map((g) => g.label).sort();
      expect(labels).toEqual(['(Unknown project)', 'Gone (deleted)']);
    });

    test('a project whose client is missing reports the unknown client', () => {
      const s = source({
        projects: [project({ id: 'p', clientId: 'nope' })],
        entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'p' })],
      });
      expect(buildReport(s, opts({ groupBy: 'client' })).groups[0]?.label).toBe('(Unknown client)');
    });
  });

  describe('filters', () => {
    const run = (filters: Filters) => buildReport(base(), opts({ filters })).totals.ms;

    test('by client', () => {
      expect(run(f({ client: 'personal/c1' }))).toBe(2 * H);
      expect(run(f({ client: NONE }))).toBe(1 * H + 1 * H); // Internal has no client, nor does the entry without project
    });

    test('by project, including none', () => {
      expect(run(f({ project: 'personal/p2' }))).toBe(1.5 * H);
      expect(run(f({ project: NONE }))).toBe(1 * H);
    });

    test('by tag, including none', () => {
      expect(run(f({ tag: 'review' }))).toBe(2 * H);
      expect(run(f({ tag: NONE }))).toBe(1.5 * H + 1 * H);
    });

    test('billable and non-billable', () => {
      expect(run(f({ billable: 'billable' }))).toBe(3.5 * H);
      expect(run(f({ billable: 'non-billable' }))).toBe(2 * H);
    });

    test('description text is a case-insensitive substring', () => {
      expect(run(f({ text: 'DESIGN' }))).toBe(3 * H);
      expect(run(f({ text: '  audit ' }))).toBe(1.5 * H);
      expect(run(f({ text: 'zzz' }))).toBe(0);
    });

    test('filters combine', () => {
      expect(run(f({ text: 'design', billable: 'billable' }))).toBe(2 * H);
      expect(run(f({ client: 'personal/c1', billable: 'non-billable' }))).toBe(0);
    });

    test('applyFilters does not mutate its input', () => {
      const entries = resolveEntries(base(), { now: NOW() });
      const copy = [...entries];
      applyFilters(entries, f({ tag: 'ui' }));
      expect(entries).toEqual(copy);
    });
  });

  describe('same project name', () => {
    test('shows "Project · Client" only when two projects share a name', () => {
      const s = source({
        clients: [client({ id: 'c1', name: 'Acme' }), client({ id: 'c2', name: 'Globex' })],
        projects: [project({ id: 'p1', name: 'Website', clientId: 'c1' }), project({ id: 'p2', name: 'Website', clientId: 'c2' }), project({ id: 'p3', name: 'Admin', clientId: 'c1' })],
        entries: ['p1', 'p2', 'p3'].map((id) => entry({ startMs: NOW() - H, projectId: id })),
      });
      const labels = resolveEntries(s, { now: NOW() }).map((e) => e.projectLabel);
      expect(labels).toEqual(['Website · Acme', 'Website · Globex', 'Admin']);
    });
  });

  describe('grouping', () => {
    test('by project sorts by duration and carries colour and amounts', () => {
      const g = buildReport(base(), opts()).groups;
      expect(g.map((x) => x.label)).toEqual(['Website', 'Audit', '(No project)', 'Internal']);
      expect(g[0]?.color).toBe('#336699');
      expect(g[0]?.amounts).toEqual({ USD: 200 });
      expect(g[1]?.amounts).toEqual({ EUR: 120 });
    });

    test('by client', () => {
      const g = buildReport(base(), opts({ groupBy: 'client' })).groups;
      expect(g.map((x) => [x.label, x.ms / H])).toEqual([
        ['Acme', 2],
        ['Globex', 1.5],
        ['(No client)', 2],
      ].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
    });

    test('by tag counts an entry with several tags toward each tag', () => {
      const r = buildReport(base(), opts({ groupBy: 'tag' }));
      const by = Object.fromEntries(r.groups.map((x) => [x.label, x.ms / H]));
      expect(by).toEqual({ ui: 2, review: 2, ops: 1, '(No tags)': 2.5 });
      const sum = r.groups.reduce((a, x) => a + x.ms, 0);
      expect(sum).toBeGreaterThan(r.totals.ms - 1); // overlaps make the sum larger than or equal to the total
      expect(sum).toBe(7.5 * H);
      expect(r.totals.ms).toBe(5.5 * H);
    });

    test('duplicate tags on one entry count once', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 9), tags: ['a', 'a'] })] });
      expect(buildReport(s, opts({ groupBy: 'tag' })).groups[0]?.ms).toBe(H);
    });

    test('by description merges case and surrounding spaces', () => {
      const g = buildReport(base(), opts({ groupBy: 'description' })).groups;
      const design = g.find((x) => x.key === 'design');
      expect(design?.ms).toBe(3 * H);
      expect(['Design', 'design']).toContain(design?.label);
    });

    test('blank descriptions are grouped as no description', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 9), description: '  ' })] });
      expect(buildReport(s, opts({ groupBy: 'description' })).groups[0]?.label).toBe('(No description)');
    });

    test('by day is in date order', () => {
      const g = buildReport(base(), opts({ groupBy: 'day' })).groups;
      expect(g.map((x) => x.key)).toEqual(['2025-03-10', '2025-03-11', '2025-03-12']);
      expect(g[0]?.label).toBe('Mon 2025-03-10');
    });

    test('sub-groups: project then description', () => {
      const s = source({
        projects: [project({ id: 'p1', name: 'Website' })],
        entries: [
          entry({ startMs: at(2025, 3, 10, 9), endMs: at(2025, 3, 10, 10), projectId: 'p1', description: 'Design' }),
          entry({ startMs: at(2025, 3, 10, 10), endMs: at(2025, 3, 10, 13), projectId: 'p1', description: 'Build' }),
          entry({ startMs: at(2025, 3, 11, 10), endMs: at(2025, 3, 11, 11), projectId: 'p1', description: 'design' }),
        ],
      });
      const g = buildReport(s, opts({ thenBy: 'description' })).groups;
      expect(g).toHaveLength(1);
      expect(g[0]?.children.map((c) => [c.label, c.ms / H])).toEqual([['Build', 3], ['Design', 2]]);
      expect(g[0]?.children.reduce((a, c) => a + c.ms, 0)).toBe(g[0]?.ms);
    });

    test('a sub-grouping equal to the grouping is ignored', () => {
      const g = buildReport(base(), opts({ thenBy: 'project' })).groups;
      expect(g.every((x) => x.children.length === 0)).toBe(true);
    });

    test('empty data gives empty groups and zero totals', () => {
      const r = buildReport(source({}), opts());
      expect(r.groups).toEqual([]);
      expect(r.totals).toEqual({ ms: 0, billableMs: 0, amounts: {} });
    });
  });

  describe('chart buckets', () => {
    test('one bucket per day, empty days included', () => {
      const { granularity, buckets } = buildReport(base(), opts()).chart;
      expect(granularity).toBe('day');
      expect(buckets.map((b) => b.ms / H)).toEqual([2, 2.5, 1, 0, 0, 0, 0]);
      expect(buckets[0]?.billableMs).toBe(2 * H);
      expect(buckets[0]?.label).toBe('Mon 2025-03-10');
    });

    test('long ranges are grouped by week, then by month', () => {
      expect(granularityFor(62)).toBe('day');
      expect(granularityFor(63)).toBe('week');
      expect(granularityFor(211)).toBe('month');
      const year = resolveRange('this_year', NOW(), 'monday');
      const { granularity, buckets } = timeBuckets([], year, 'monday');
      expect(granularity).toBe('month');
      expect(buckets).toHaveLength(12);
      const quarter = { from: at(2025, 1, 1), to: at(2025, 4, 1) };
      const w = timeBuckets([], quarter, 'monday');
      expect(w.granularity).toBe('week');
      expect(w.buckets[0]?.key).toBe('2024-12-30');
    });

    test('week buckets sum to the total', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 1, 6, 9) }), entry({ startMs: at(2025, 2, 20, 9) }), entry({ startMs: at(2025, 3, 28, 9) })] });
      const r = buildReport(s, opts({ range: { from: at(2025, 1, 1), to: at(2025, 4, 1) } }));
      expect(r.chart.buckets.reduce((a, b) => a + b.ms, 0)).toBe(3 * H);
    });
  });

  describe('group cells', () => {
    test('groups carry hours per day, aligned with the chart buckets', () => {
      const r = buildReport(base(), opts());
      const website = r.groups.find((x) => x.label === 'Website');
      expect(r.chart.buckets).toHaveLength(7);
      expect(website?.cells.map((c) => c / H)).toEqual([2, 0, 0, 0, 0, 0, 0]);
      expect(r.chart.buckets.map((c) => c.ms / H)).toEqual([2, 2.5, 1, 0, 0, 0, 0]);
    });

    test('cells add up to the group total', () => {
      for (const g of buildReport(base(), opts()).groups) expect(g.cells.reduce((a, c) => a + c, 0)).toBe(g.ms);
    });

    test('splits midnight-crossing entries between columns', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 23), endMs: at(2025, 3, 11, 1) })] });
      const r = buildReport(s, opts());
      expect(r.groups[0]?.cells.slice(0, 2).map((c) => c / H)).toEqual([1, 1]);
    });

    test('long ranges use week columns and children carry cells too', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 1, 6, 9) }), entry({ startMs: at(2025, 2, 20, 9) })] });
      const r = buildReport(s, opts({ range: { from: at(2025, 1, 1), to: at(2025, 6, 1) }, thenBy: 'description' }));
      expect(r.chart.granularity).toBe('week');
      const g = r.groups[0];
      expect(g?.cells).toHaveLength(r.chart.buckets.length);
      expect(g?.cells.reduce((a, c) => a + c, 0)).toBe(2 * H);
      expect(g?.children[0]?.cells).toHaveLength(r.chart.buckets.length);
    });
  });

  describe('detailed rows and sorting', () => {
    const rows = () => buildReport(base(), opts()).rows;

    test('one row per entry, rows add up to the total', () => {
      expect(rows()).toHaveLength(4);
      expect(rows().reduce((a, r) => a + r.ms, 0)).toBe(5.5 * H);
    });

    test('row amounts and currencies', () => {
      const audit = rows().find((r) => r.description === 'Audit work');
      expect(audit?.amount).toBeCloseTo(120, 10);
      expect(audit?.currency).toBe('EUR');
      expect(rows().find((r) => r.description === 'Admin')?.amount).toBeNull();
    });

    test('sorts by date, duration, project and amount in both directions', () => {
      const d = (key: Parameters<typeof sortDetailRows>[1], dir: 'asc' | 'desc') => sortDetailRows(rows(), key, dir).map((r) => r.description);
      expect(d('date', 'asc')).toEqual(['Design', 'Audit work', 'Admin', 'design']);
      expect(d('date', 'desc')).toEqual(['design', 'Admin', 'Audit work', 'Design']);
      expect(d('duration', 'desc')[0]).toBe('Design');
      expect(d('duration', 'asc')[0]).toBe('Admin');
      expect(d('duration', 'asc').slice(-1)).toEqual(['Design']);
      expect(d('project', 'asc')[0]).toBe('design'); // "(No project)" sorts before letters
    });

    test('rows without an amount sort last whichever way the amount sorts', () => {
      const asc = sortDetailRows(rows(), 'amount', 'asc');
      const desc = sortDetailRows(rows(), 'amount', 'desc');
      expect(asc.slice(0, 2).map((r) => r.amount)).toEqual([expect.any(Number), expect.any(Number)]);
      expect(asc.slice(2).every((r) => r.amount === null)).toBe(true);
      expect(desc.slice(2).every((r) => r.amount === null)).toBe(true);
      expect(asc[0]?.amount).toBeLessThanOrEqual(asc[1]?.amount ?? 0);
      expect(desc[0]?.amount).toBeGreaterThanOrEqual(desc[1]?.amount ?? 0);
    });

    test('sorting does not mutate the input', () => {
      const input = rows();
      const copy = [...input];
      sortDetailRows(input, 'duration', 'desc');
      expect(input).toEqual(copy);
    });

    test('detailRows merges the slices of one entry', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 22), endMs: at(2025, 3, 12, 2) })] });
      const segs = toSegments(resolveEntries(s, { now: NOW() }), opts().range);
      expect(segs.length).toBe(3);
      expect(detailRows(segs)).toHaveLength(1);
    });
  });

  describe('spaces', () => {
    test('project labels carry the space name in all-spaces mode, and same ids in two spaces stay apart', () => {
      const s = source({
        projects: [project({ id: 'p', name: 'Site', spaceId: 'personal' }), project({ id: 'p', name: 'Site', spaceId: 'work' })],
        entries: [entry({ startMs: at(2025, 3, 10, 9), projectId: 'p', spaceId: 'personal' }), entry({ startMs: at(2025, 3, 10, 9), projectId: 'p', spaceId: 'work' })],
      });
      const g = buildReport(s, opts({ multiSpace: true })).groups;
      expect(g.map((x) => x.label).sort()).toEqual(['Site · Personal', 'Site · Work']);
      expect(buildReport(s, opts()).groups.map((x) => x.label)).toEqual(['Site', 'Site']);
    });
  });

  test('filterChoices lists live clients, projects and used tags, sorted', () => {
    const s = base();
    s.projects.push(project({ id: 'dead', name: 'Dead', deleted: true }));
    s.entries.push(entry({ startMs: at(2025, 3, 10, 9), tags: ['zeta'], deleted: true }));
    const c = filterChoices(s, false);
    expect(c.clients.map((x) => x.label)).toEqual(['Acme', 'Globex']);
    expect(c.projects.map((x) => x.label)).toEqual(['Audit', 'Internal', 'Website']);
    expect(c.tags).toEqual(['ops', 'review', 'ui']);
  });
});

describe('daylight saving in a report', () => {
  useTimeZone('Europe/Berlin');

  test('a week with the spring change totals real elapsed time', () => {
    const range = { from: at(2025, 3, 24), to: at(2025, 3, 31) };
    const s = source({
      entries: [
        entry({ startMs: at(2025, 3, 29, 22), endMs: at(2025, 3, 30, 6) }), // 7 real hours
        entry({ startMs: at(2025, 3, 30, 12), endMs: at(2025, 3, 30, 13) }),
      ],
    });
    const r = buildReport(s, opts({ range }));
    expect(r.totals.ms).toBe(8 * H);
    expect(r.chart.buckets.map((b) => b.ms / H)).toEqual([0, 0, 0, 0, 0, 2, 6]);
  });

  test('a week with the autumn change counts the extra hour', () => {
    const range = { from: at(2025, 10, 20), to: at(2025, 10, 27) };
    const s = source({ entries: [entry({ startMs: at(2025, 10, 25, 22), endMs: at(2025, 10, 26, 6) })] }); // 9 real hours
    expect(buildReport(s, opts({ range })).totals.ms).toBe(9 * H);
  });

  test('a day total over 24 hours is impossible for one tracked entry on a normal day', () => {
    const range = { from: at(2025, 3, 10), to: at(2025, 3, 11) };
    const s = source({ entries: [entry({ startMs: at(2025, 3, 9, 0), endMs: at(2025, 3, 12, 0) })] });
    expect(buildReport(s, opts({ range })).totals.ms).toBe(24 * H);
  });
});

describe('time zone independence of the pipeline', () => {
  describe.each(['America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland'])('%s', (tz) => {
    useTimeZone(tz);
    test('days follow the local calendar', () => {
      const s = source({ entries: [entry({ startMs: at(2025, 3, 10, 23, 30), endMs: at(2025, 3, 11, 0, 30) })] });
      const r = buildReport(s, opts());
      expect(r.chart.buckets.slice(0, 2).map((b) => b.ms / H)).toEqual([0.5, 0.5]);
    });
  });
});
