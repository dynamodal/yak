import {
  MONTHS,
  type DateRange,
  type WeekStart,
  dayKey,
  dayLabel,
  parseDayKey,
  rangeDays,
  splitByDay,
  startOfMonth,
  startOfWeek,
} from './dates';

/**
 * Report aggregation: plain functions over plain data, no Yjs and no DOM, so every rule here is
 * covered by unit tests. The pipeline is
 * `resolveEntries` -> `applyFilters` -> `toSegments` -> `groupSegments` / `dayBuckets` / `weeklyGrid` / `detailRows`.
 */

// ---------------------------------------------------------------- source data

export interface SourceEntry {
  id: string;
  spaceId: string;
  start: string;
  /** `null` while the timer runs. */
  stop: string | null;
  description: string;
  projectId: string | null;
  tags: string[];
  billable: boolean;
  deleted: boolean;
}

export interface SourceProject {
  id: string;
  spaceId: string;
  name: string;
  clientId: string | null;
  color: string;
  rate: number | null;
  currency: string;
  /** `false` for an archived project. */
  active: boolean;
  deleted: boolean;
}

export interface SourceClient {
  id: string;
  spaceId: string;
  name: string;
  archived: boolean;
  deleted: boolean;
}

export interface ReportSource {
  entries: SourceEntry[];
  projects: SourceProject[];
  clients: SourceClient[];
  /** Display names of the spaces in this source, by space id. */
  spaceNames: Record<string, string>;
}

// ---------------------------------------------------------------- resolved entries

export const NO_PROJECT = '(No project)';
const NO_CLIENT = '(No client)';
const NO_TAGS = '(No tags)';
export const NO_DESCRIPTION = '(No description)';

export interface ResolvedEntry {
  id: string;
  spaceId: string;
  startMs: number;
  /** The stop time, or `now` while the entry runs. Never before `startMs`. */
  endMs: number;
  running: boolean;
  description: string;
  /** `spaceId/projectId`, or `null` without a project. */
  projectKey: string | null;
  projectLabel: string;
  /** The space name already appended to `projectLabel`, when the report spans several spaces. */
  projectSpace?: string;
  projectColor: string | null;
  clientKey: string | null;
  clientLabel: string;
  clientSpace?: string;
  tags: string[];
  billable: boolean;
  rate: number | null;
  currency: string;
}

export interface ResolveOptions {
  now: number;
  /** Add the space name to project and client labels; for reports over several spaces. */
  multiSpace?: boolean;
}

const spaceOf = (spaceId: string, source: ReportSource): string => source.spaceNames[spaceId] ?? spaceId;

/** Lower-cased project names used by more than one project; their labels get the client, so the rows can be told apart. */
function sharedProjectNames(source: ReportSource): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const p of source.projects) {
    const n = (p.name || '').trim().toLowerCase();
    if (seen.has(n)) shared.add(n);
    seen.add(n);
  }
  return shared;
}

function projectDisplay(p: SourceProject, source: ReportSource, multi: boolean, clientName?: string): string {
  let label = p.name || '(Unnamed project)';
  if (clientName !== undefined) label += ` · ${clientName || '(Unnamed client)'}`;
  if (p.deleted) label += ' (deleted)';
  else if (!p.active) label += ' (archived)';
  if (multi) label += ` · ${spaceOf(p.spaceId, source)}`;
  return label;
}

function clientDisplay(c: SourceClient, source: ReportSource, multi: boolean): string {
  let label = c.name || '(Unnamed client)';
  if (c.deleted) label += ' (deleted)';
  else if (c.archived) label += ' (archived)';
  if (multi) label += ` · ${spaceOf(c.spaceId, source)}`;
  return label;
}

/**
 * Join entries with their project and client and drop what must not be reported: deleted entries
 * and entries whose start is not a valid date. A running entry ends at `now`. Archived and deleted
 * projects keep their entries (the hours were worked), labelled as such.
 */
export function resolveEntries(source: ReportSource, opts: ResolveOptions): ResolvedEntry[] {
  const multi = opts.multiSpace === true;
  const projects = new Map(source.projects.map((p) => [`${p.spaceId}/${p.id}`, p]));
  const clients = new Map(source.clients.map((c) => [`${c.spaceId}/${c.id}`, c]));
  const shared = sharedProjectNames(source);
  const out: ResolvedEntry[] = [];
  for (const e of source.entries) {
    if (e.deleted) continue;
    const startMs = Date.parse(e.start);
    if (!Number.isFinite(startMs)) continue;
    const running = e.stop === null;
    let endMs = running ? opts.now : Date.parse(e.stop as string);
    if (!Number.isFinite(endMs)) continue;
    if (endMs < startMs) endMs = startMs;

    let projectKey: string | null = null;
    let projectLabel = NO_PROJECT;
    let projectSpace: string | undefined;
    let clientSpace: string | undefined;
    let projectColor: string | null = null;
    let clientKey: string | null = null;
    let clientLabel = NO_CLIENT;
    let rate: number | null = null;
    let currency = 'USD';
    if (e.projectId) {
      projectKey = `${e.spaceId}/${e.projectId}`;
      const p = projects.get(projectKey);
      if (p) {
        const withClient = shared.has((p.name || '').trim().toLowerCase()) && p.clientId ? clients.get(`${e.spaceId}/${p.clientId}`) : undefined;
        projectLabel = projectDisplay(p, source, multi, withClient ? withClient.name : undefined);
        if (multi) projectSpace = spaceOf(p.spaceId, source);
        projectColor = p.color || null;
        rate = typeof p.rate === 'number' && Number.isFinite(p.rate) ? p.rate : null;
        currency = p.currency || 'USD';
        if (p.clientId) {
          clientKey = `${e.spaceId}/${p.clientId}`;
          const c = clients.get(clientKey);
          clientLabel = c ? clientDisplay(c, source, multi) : '(Unknown client)';
          if (c && multi) clientSpace = spaceOf(c.spaceId, source);
        }
      } else {
        projectLabel = '(Unknown project)';
      }
    }
    out.push({
      id: e.id,
      spaceId: e.spaceId,
      startMs,
      endMs,
      running,
      description: e.description,
      projectKey,
      projectLabel,
      projectSpace,
      projectColor,
      clientKey,
      clientLabel,
      clientSpace,
      tags: e.tags,
      billable: e.billable,
      rate,
      currency,
    });
  }
  return out;
}

// ---------------------------------------------------------------- filters

/** Filter value meaning "entries without a client / project / tag". */
export const NONE = '__none__';

export interface Filters {
  /** Client key, `NONE`, or `null` for any. */
  client: string | null;
  /** Project key, `NONE`, or `null` for any. */
  project: string | null;
  /** Tag name, `NONE`, or `null` for any. */
  tag: string | null;
  billable: 'all' | 'billable' | 'non-billable';
  /** Case-insensitive substring of the description. */
  text: string;
}

export const NO_FILTERS: Filters = { client: null, project: null, tag: null, billable: 'all', text: '' };

export function hasFilters(f: Filters): boolean {
  return f.client !== null || f.project !== null || f.tag !== null || f.billable !== 'all' || f.text.trim() !== '';
}

export function applyFilters(entries: ResolvedEntry[], f: Filters): ResolvedEntry[] {
  const text = f.text.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.client !== null && (f.client === NONE ? e.clientKey !== null : e.clientKey !== f.client)) return false;
    if (f.project !== null && (f.project === NONE ? e.projectKey !== null : e.projectKey !== f.project)) return false;
    if (f.tag !== null && (f.tag === NONE ? e.tags.length > 0 : !e.tags.includes(f.tag))) return false;
    if (f.billable === 'billable' && !e.billable) return false;
    if (f.billable === 'non-billable' && e.billable) return false;
    if (text && !e.description.toLowerCase().includes(text)) return false;
    return true;
  });
}

// ---------------------------------------------------------------- segments and totals

/** Money by currency code. A currency is present only when some billable entry had a rate. */
export type Amounts = Record<string, number>;

export interface Segment {
  entry: ResolvedEntry;
  /** Local day key. */
  day: string;
  ms: number;
}

const HOUR = 3_600_000;

/** The amount for `ms` of this entry, or `null` when it is not billable or its project has no rate. */
function entryAmount(e: ResolvedEntry, ms: number): number | null {
  if (!e.billable || e.rate === null) return null;
  return (ms / HOUR) * e.rate;
}

/** Cut entries at midnights and at the range edges. Entries outside the range produce nothing. */
export function toSegments(entries: ResolvedEntry[], range: DateRange): Segment[] {
  const out: Segment[] = [];
  for (const entry of entries) {
    if (entry.endMs <= range.from || entry.startMs >= range.to) continue;
    for (const slice of splitByDay(entry.startMs, entry.endMs, range)) {
      out.push({ entry, day: slice.day, ms: slice.ms });
    }
  }
  return out;
}

export interface Totals {
  ms: number;
  billableMs: number;
  amounts: Amounts;
}

function addAmount(amounts: Amounts, seg: Segment): void {
  const a = entryAmount(seg.entry, seg.ms);
  if (a !== null) amounts[seg.entry.currency] = (amounts[seg.entry.currency] ?? 0) + a;
}

function totalsOf(segments: Segment[]): Totals {
  const t: Totals = { ms: 0, billableMs: 0, amounts: {} };
  for (const s of segments) {
    t.ms += s.ms;
    if (s.entry.billable) t.billableMs += s.ms;
    addAmount(t.amounts, s);
  }
  return t;
}

// ---------------------------------------------------------------- grouping

export type GroupBy = 'project' | 'client' | 'tag' | 'description' | 'day';

export const GROUP_BY_OPTIONS: readonly { id: GroupBy; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'client', label: 'Client' },
  { id: 'tag', label: 'Tag' },
  { id: 'description', label: 'Description' },
  { id: 'day', label: 'Day' },
];

export interface Group extends Totals {
  key: string;
  label: string;
  /** Space name that ends `label` (" · space"); the table shows it on a second line. */
  space?: string;
  /** Project colour for project groups. */
  color: string | null;
  /** Milliseconds per report column (day, week or month), aligned with `Report.columns`. */
  cells: number[];
  children: Group[];
}

interface Bucket {
  key: string;
  label: string;
  space?: string;
  color: string | null;
}

/** The groups a segment belongs to. Only `tag` can return several: the entry counts toward each tag. */
function bucketsOf(seg: Segment, by: GroupBy): Bucket[] {
  const e = seg.entry;
  switch (by) {
    case 'project':
      return [{ key: e.projectKey ?? NONE, label: e.projectLabel, space: e.projectSpace, color: e.projectColor }];
    case 'client':
      return [{ key: e.clientKey ?? NONE, label: e.clientLabel, space: e.clientSpace, color: null }];
    case 'tag': {
      const tags = [...new Set(e.tags)];
      if (tags.length === 0) return [{ key: NONE, label: NO_TAGS, color: null }];
      return tags.map((t) => ({ key: t, label: t, color: null }));
    }
    case 'description': {
      const d = e.description.trim();
      return [{ key: d.toLowerCase(), label: d || NO_DESCRIPTION, color: null }];
    }
    case 'day':
      return [{ key: seg.day, label: dayLabel(seg.day), color: null }];
  }
}

function compareGroups(by: GroupBy): (a: Group, b: Group) => number {
  if (by === 'day') return (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return (a, b) => b.ms - a.ms || a.label.localeCompare(b.label);
}

/**
 * Group segments, optionally with a second level. Totals of a group are the sum over its segments;
 * with `tag` the groups overlap, so they can add up to more than the report total.
 */
export function groupSegments(segments: Segment[], by: GroupBy, then: GroupBy | null = null, columns?: ColumnIndex): Group[] {
  const map = new Map<string, { group: Group; segs: Segment[] }>();
  for (const seg of segments) {
    for (const b of bucketsOf(seg, by)) {
      let slot = map.get(b.key);
      if (!slot) {
        slot = { group: { key: b.key, label: b.label, space: b.space, color: b.color, ms: 0, billableMs: 0, amounts: {}, cells: columns ? columns.keys.map(() => 0) : [], children: [] }, segs: [] };
        map.set(b.key, slot);
      }
      slot.group.ms += seg.ms;
      const col = columns?.indexOf(seg.day) ?? -1;
      if (col >= 0) slot.group.cells[col] = (slot.group.cells[col] ?? 0) + seg.ms;
      if (seg.entry.billable) slot.group.billableMs += seg.ms;
      addAmount(slot.group.amounts, seg);
      slot.segs.push(seg);
    }
  }
  const groups = [...map.values()].map(({ group, segs }) => {
    if (then && then !== by) group.children = groupSegments(segs, then, null, columns);
    return group;
  });
  return groups.sort(compareGroups(by));
}

// ---------------------------------------------------------------- per-day buckets (chart)

export type Granularity = 'day' | 'week' | 'month';

export interface TimeBucket {
  key: string;
  /** Long label for tooltips and the data table. */
  label: string;
  /** Short label for the axis. */
  short: string;
  ms: number;
  billableMs: number;
}

/** Days up to about two months, weeks up to about seven months, otherwise months. */
export function granularityFor(dayCount: number): Granularity {
  if (dayCount <= 62) return 'day';
  if (dayCount <= 210) return 'week';
  return 'month';
}

/** Totals per day (or week or month for long ranges), including empty ones, in order. */
export function timeBuckets(segments: Segment[], range: DateRange, weekStart: WeekStart): { granularity: Granularity; buckets: TimeBucket[] } {
  const days = rangeDays(range);
  const granularity = granularityFor(days.length);
  const order: string[] = [];
  const map = new Map<string, TimeBucket>();
  const bucketFor = (day: string): TimeBucket => {
    const ms = parseDayKey(day) ?? 0;
    let key = day;
    let label = dayLabel(day);
    let short = String(new Date(ms).getDate());
    if (granularity === 'week') {
      const first = startOfWeek(ms, weekStart);
      key = dayKey(first);
      label = `Week of ${dayLabel(key)}`;
      short = `${new Date(first).getDate()} ${MONTHS[new Date(first).getMonth()]}`;
    } else if (granularity === 'month') {
      const first = startOfMonth(ms);
      key = dayKey(first);
      const d = new Date(first);
      label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      short = MONTHS[d.getMonth()] ?? key;
    }
    let b = map.get(key);
    if (!b) {
      b = { key, label, short, ms: 0, billableMs: 0 };
      map.set(key, b);
      order.push(key);
    }
    return b;
  };
  for (const d of days) bucketFor(d);
  for (const s of segments) {
    const b = bucketFor(s.day);
    b.ms += s.ms;
    if (s.entry.billable) b.billableMs += s.ms;
  }
  return { granularity, buckets: order.map((k) => map.get(k) as TimeBucket) };
}

// ---------------------------------------------------------------- columns

/** Maps a day to its column (a day, week or month, as in the chart); keys are the buckets' keys. */
export interface ColumnIndex {
  keys: string[];
  indexOf(day: string): number;
}

function columnIndex(buckets: TimeBucket[], granularity: Granularity, weekStart: WeekStart): ColumnIndex {
  const keys = buckets.map((b) => b.key);
  const at = new Map(keys.map((k, i) => [k, i]));
  const indexOf = (day: string): number => {
    const ms = parseDayKey(day);
    if (ms === undefined) return -1;
    const key = granularity === 'day' ? day : dayKey(granularity === 'week' ? startOfWeek(ms, weekStart) : startOfMonth(ms));
    return at.get(key) ?? -1;
  };
  return { keys, indexOf };
}

// ---------------------------------------------------------------- detailed rows

export interface DetailRow {
  id: string;
  spaceId: string;
  /** Local day of the start. */
  day: string;
  startMs: number;
  endMs: number;
  running: boolean;
  description: string;
  projectLabel: string;
  clientLabel: string;
  tags: string[];
  billable: boolean;
  /** Time inside the report range; the whole entry unless the range cuts it. */
  ms: number;
  amount: number | null;
  currency: string;
}

/** One row per entry, with the duration that falls inside the range, so rows add up to the summary total. */
export function detailRows(segments: Segment[]): DetailRow[] {
  const map = new Map<string, DetailRow>();
  for (const s of segments) {
    const e = s.entry;
    const id = `${e.spaceId}/${e.id}`;
    let row = map.get(id);
    if (!row) {
      row = {
        id: e.id,
        spaceId: e.spaceId,
        day: dayKey(e.startMs),
        startMs: e.startMs,
        endMs: e.endMs,
        running: e.running,
        description: e.description,
        projectLabel: e.projectLabel,
        clientLabel: e.clientLabel,
        tags: e.tags,
        billable: e.billable,
        ms: 0,
        amount: null,
        currency: e.currency,
      };
      map.set(id, row);
    }
    row.ms += s.ms;
    const a = entryAmount(e, s.ms);
    if (a !== null) row.amount = (row.amount ?? 0) + a;
  }
  return [...map.values()];
}

export type DetailSortKey = 'date' | 'description' | 'project' | 'tags' | 'duration' | 'amount';

export function sortDetailRows(rows: DetailRow[], key: DetailSortKey, dir: 'asc' | 'desc'): DetailRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const text = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const cmp = (a: DetailRow, b: DetailRow): number => {
    switch (key) {
      case 'date':
        return a.startMs - b.startMs;
      case 'description':
        return text(a.description, b.description);
      case 'project':
        return text(a.projectLabel, b.projectLabel);
      case 'tags':
        return text(a.tags.join(', '), b.tags.join(', '));
      case 'duration':
        return a.ms - b.ms;
      case 'amount':
        // Rows without an amount sort below every row with one, in both directions.
        if (a.amount === null || b.amount === null) return a.amount === b.amount ? 0 : a.amount === null ? sign : -sign;
        return a.amount - b.amount;
    }
  };
  // Ties fall back to the start time and the id so the order is stable across renders.
  return [...rows].sort((a, b) => sign * cmp(a, b) || sign * (a.startMs - b.startMs) || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- the whole report

export interface ReportOptions {
  now: number;
  range: DateRange;
  weekStart: WeekStart;
  filters: Filters;
  groupBy: GroupBy;
  thenBy: GroupBy | null;
  multiSpace: boolean;
}

export interface Report {
  range: DateRange;
  days: string[];
  segments: Segment[];
  totals: Totals;
  groups: Group[];
  chart: { granularity: Granularity; buckets: TimeBucket[] };
  rows: DetailRow[];
  hasRunning: boolean;
}

export function buildReport(source: ReportSource, o: ReportOptions): Report {
  const entries = applyFilters(resolveEntries(source, { now: o.now, multiSpace: o.multiSpace }), o.filters);
  const segments = toSegments(entries, o.range);
  const chart = timeBuckets(segments, o.range, o.weekStart);
  const columns = columnIndex(chart.buckets, chart.granularity, o.weekStart);
  return {
    range: o.range,
    days: rangeDays(o.range),
    segments,
    totals: totalsOf(segments),
    groups: groupSegments(segments, o.groupBy, o.thenBy, columns),
    chart,
    rows: detailRows(segments),
    hasRunning: segments.some((s) => s.entry.running),
  };
}

/** Distinct filter choices present in the data (before filtering), for the filter drop-downs. */
export interface FilterChoices {
  clients: { key: string; label: string }[];
  projects: { key: string; label: string }[];
  tags: string[];
}

export function filterChoices(source: ReportSource, multiSpace: boolean): FilterChoices {
  const clients = source.clients
    .filter((c) => !c.deleted)
    .map((c) => ({ key: `${c.spaceId}/${c.id}`, label: clientDisplay(c, source, multiSpace) }));
  const projects = source.projects
    .filter((p) => !p.deleted)
    .map((p) => ({ key: `${p.spaceId}/${p.id}`, label: projectDisplay(p, source, multiSpace) }));
  const tags = new Set<string>();
  for (const e of source.entries) if (!e.deleted) for (const t of e.tags) tags.add(t);
  const byLabel = (a: { label: string }, b: { label: string }): number => a.label.localeCompare(b.label);
  return { clients: clients.sort(byLabel), projects: projects.sort(byLabel), tags: [...tags].sort((a, b) => a.localeCompare(b)) };
}
