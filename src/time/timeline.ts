import { addDays, dayKey, isoToMs, startOfDay } from './dates';
import { type EntryRecord, isRunning, startMs } from './entries';

/**
 * The day timeline (#68): pure functions behind the calendar view. Findings and durations use real
 * time (epoch milliseconds); only the drawing uses the wall clock, so the columns of a week stay
 * aligned across a daylight-saving change (T-68).
 */

const MINUTE = 60_000;
/** Two entries must share at least this long to count as an overlap; shorter ones come from the sync chain. */
export const MIN_OVERLAP_MS = MINUTE;
/** A gap is at least this long (T-68). */
export const MIN_GAP_MS = 15 * MINUTE;

/** One thing on the grid. Only the `entries` layer counts toward gaps and overlaps; later layers add their own blocks. */
export interface TimelineBlock {
  id: string;
  layer: 'entries' | 'events' | 'planned';
  start: number;
  end: number;
  title: string;
  color: string | null;
  editable: boolean;
  /** The project name, shown when the block is tall enough. */
  subtitle?: string;
  running?: boolean;
}

/** A span of real time, `[start, end)`. */
export interface Span {
  id: string;
  start: number;
  end: number;
}

export interface DayRange {
  from: number;
  to: number;
}

/** The span of an entry; a running one ends at `now`. `undefined` when it has no length (or a broken date). */
export function entrySpan(e: EntryRecord, now: number): Span | undefined {
  const start = startMs(e);
  const end = isRunning(e) ? now : isoToMs(e.stop);
  return Number.isFinite(end) && end > start ? { id: e.id, start, end } : undefined;
}

/** Entries that touch the range, including ones that started before it (last night's entry has a morning part). */
export function spansTouching(entries: readonly EntryRecord[], range: DayRange, now: number): Span[] {
  const out: Span[] = [];
  for (const e of entries) {
    const s = entrySpan(e, now);
    if (s && s.end > range.from && s.start < range.to) out.push(s);
  }
  return out;
}

export interface Piece<T = Span> {
  day: string;
  dayStart: number;
  /** Real time of the piece, cut at local midnight and clipped to the range. */
  start: number;
  end: number;
  source: T;
}

/** Cut spans at local midnight and clip them to the range; the pieces add up to the clipped real time. */
export function cutByDay<T extends { start: number; end: number }>(items: readonly T[], range: DayRange): Piece<T>[] {
  const out: Piece<T>[] = [];
  for (const source of items) {
    let cursor = Math.max(source.start, range.from);
    const end = Math.min(source.end, range.to);
    while (cursor < end) {
      const dayStart = startOfDay(cursor);
      const next = addDays(dayStart, 1);
      out.push({ day: dayKey(dayStart), dayStart, start: cursor, end: Math.min(end, next), source });
      cursor = Math.min(end, next);
    }
  }
  return out;
}

export interface Overlap {
  /** The entry that started first, and the one that started inside it. */
  firstId: string;
  secondId: string;
  start: number;
  end: number;
}

/** Pairs of spans that share at least a minute of real time, in start order. */
export function findOverlaps(spans: readonly Span[]): Overlap[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : 1));
  const out: Overlap[] = [];
  let active: Span[] = [];
  for (const s of sorted) {
    active = active.filter((a) => a.end > s.start);
    for (const a of active) {
      const start = s.start;
      const end = Math.min(a.end, s.end);
      if (end - start >= MIN_OVERLAP_MS) out.push({ firstId: a.id, secondId: s.id, start, end });
    }
    active.push(s);
  }
  return out;
}

export interface Gap {
  day: string;
  dayStart: number;
  start: number;
  end: number;
}

/**
 * Empty stretches of at least 15 minutes between the first entry's start and the last entry's stop of each
 * local day, never after `now` (T-68). Real time, so the hour a spring-forward day skips is not a gap.
 */
export function findGaps(spans: readonly Span[], range: DayRange, now: number): Gap[] {
  const byDay = new Map<string, Piece[]>();
  for (const p of cutByDay(spans, range)) {
    const end = Math.min(p.end, now);
    if (end <= p.start) continue;
    const list = byDay.get(p.day) ?? [];
    list.push({ ...p, end });
    byDay.set(p.day, list);
  }
  const out: Gap[] = [];
  for (const pieces of byDay.values()) {
    pieces.sort((a, b) => a.start - b.start);
    let reach = (pieces[0] as Piece).end;
    for (const p of pieces.slice(1)) {
      if (p.start - reach >= MIN_GAP_MS) out.push({ day: p.day, dayStart: p.dayStart, start: reach, end: p.start });
      reach = Math.max(reach, p.end);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ drawing

export const DAY_MINUTES = 24 * 60;

/** Minutes on the wall clock since local midnight of `dayStart`; the day's own end (next midnight) is 1440. */
export function wallMinutes(ms: number, dayStart: number): number {
  if (ms >= addDays(dayStart, 1)) return DAY_MINUTES;
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000;
}

export interface Drawn {
  /** Minutes from the top of the day, 0..1440. */
  top: number;
  bottom: number;
}

/**
 * Where a piece of a day is drawn. The repeated hour of a 25-hour day lands on one row, so an end that reads
 * earlier than its start (it crossed the change) is drawn to the end of the row it started in. A 23-hour day
 * has a blank row where the skipped hour is.
 */
export function drawnPosition(start: number, end: number, dayStart: number): Drawn {
  const top = wallMinutes(start, dayStart);
  let bottom = wallMinutes(end, dayStart);
  if (bottom < top) bottom = Math.min(DAY_MINUTES, Math.ceil(top / 60) * 60);
  return { top, bottom: Math.max(bottom, top) };
}

export interface Placed<T> {
  item: T;
  top: number;
  bottom: number;
  /** Column among the items that share this stretch of the day, and how many columns it has. */
  lane: number;
  lanes: number;
}

/** Side-by-side lanes for items drawn at the same time, worked out from the drawn position (not from real time). */
export function layoutLanes<T extends { start: number; end: number }>(items: readonly T[], dayStart: number): Placed<T>[] {
  const placed: Placed<T>[] = items
    .map((item) => ({ item, ...drawnPosition(item.start, item.end, dayStart), lane: 0, lanes: 1 }))
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const close = (): void => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const p of placed) {
    if (p.top >= clusterEnd) {
      close();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= p.top);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = p.bottom;
    p.lane = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.bottom);
  }
  close();
  return placed;
}

// ------------------------------------------------------------------ blocks and text

/** Blocks for the `entries` layer; `describe` gives the title, project name and colour of an entry. */
export function entryBlocks(entries: readonly EntryRecord[], range: DayRange, now: number, describe: (e: EntryRecord) => { title: string; subtitle?: string; color: string | null }): TimelineBlock[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: TimelineBlock[] = [];
  for (const p of cutByDay(spansTouching(entries, range, now), range)) {
    const e = byId.get(p.source.id) as EntryRecord;
    out.push({ id: e.id, layer: 'entries', start: p.start, end: p.end, editable: false, running: isRunning(e), ...describe(e) });
  }
  return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

/** `1 h 5 min`, `50 min`, `1 min`: whole minutes of real time, at least one. */
export function minutesText(ms: number): string {
  const total = Math.max(1, Math.round(ms / MINUTE));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** `09:05` on the 24-hour wall clock. */
export function clockText(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ scale

/** Pixels per hour the Calendar can show, smallest first (T-68d). Every pixel conversion below takes one of these. */
export const ZOOM_LEVELS = [30, 60, 120, 240] as const;
/** The scale of T-68b: a minute is a pixel. */
export const DEFAULT_HOUR_PX = 60;

/** A stored or typed scale as one of the levels; anything else reads as the default. */
export function zoomLevel(value: unknown): number {
  return (ZOOM_LEVELS as readonly number[]).includes(value as number) ? (value as number) : DEFAULT_HOUR_PX;
}

/** The next level in or out (`1` is in, `-1` out); at the end of the list it stays where it is. */
export function zoomStep(hourPx: number, direction: 1 | -1): number {
  const i = (ZOOM_LEVELS as readonly number[]).indexOf(zoomLevel(hourPx));
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + direction))] as number;
}

export const minutesToPx = (minutes: number, hourPx: number): number => (minutes / 60) * hourPx;
export const pxToMinutes = (px: number, hourPx: number): number => (px / hourPx) * 60;

/** Blocks and overlaps never get shorter than this, so a one-minute entry can still be seen and hit. */
export const MIN_BLOCK_PX = 4;

export interface Box {
  top: number;
  height: number;
}

/** A drawn position in pixels at a scale; `minHeight` keeps a thin piece visible. */
export function drawnBox(pos: Drawn, hourPx: number, minHeight = 0): Box {
  return { top: minutesToPx(pos.top, hourPx), height: Math.max(minutesToPx(pos.bottom - pos.top, hourPx), minHeight) };
}

/** Where the grid opens: `LEAD_MINUTES` before the first entry, or 08:00 when there is none. */
export function openingScrollTop(firstMinute: number | undefined, hourPx: number): number {
  const minute = firstMinute === undefined ? DEFAULT_TOP_HOUR * 60 : firstMinute - LEAD_MINUTES;
  return Math.max(0, minutesToPx(minute, hourPx));
}
const DEFAULT_TOP_HOUR = 8;
const LEAD_MINUTES = 30;

/**
 * The scroll position that keeps the time at the middle of the visible grid where it was when the scale changes.
 * `visibleHeight` is the scroller's height without the sticky day header.
 */
export function scrollForZoom(scrollTop: number, visibleHeight: number, fromHourPx: number, toHourPx: number): number {
  return Math.max(0, ((scrollTop + visibleHeight / 2) * toHourPx) / fromHourPx - visibleHeight / 2);
}

/** What text a block of this height can hold without clipping a line in half. */
export function blockText(heightPx: number): { title: boolean; subtitle: boolean } {
  return { title: heightPx >= 14, subtitle: heightPx >= 30 };
}

/** Whether a gap of this height has room for its "50 min gap" label. */
export function gapLabelFits(heightPx: number): boolean {
  return heightPx >= 15;
}
