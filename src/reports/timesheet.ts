import { type Group, type GroupBy, type Report, type Segment, NONE, groupSegments } from './aggregate';
import { parseDayKey } from './dates';

/**
 * The Timesheet layout (#180): per row and day, hours rounded to the nearest 0.1 h and that day's
 * descriptions joined. Pure functions; the view only draws what they return.
 */

const TENTH_MS = 360_000;
export const NOTE_SEPARATOR = '; ';

/** Rows follow Group by when it is project or client; anything else falls back to project. */
export function timesheetBy(groupBy: GroupBy): 'project' | 'client' {
  return groupBy === 'client' ? 'client' : 'project';
}

/** Milliseconds to whole tenths of an hour, half up. Integer arithmetic, so no float artifacts. */
export function roundTenths(ms: number): number {
  return Math.floor((ms + TENTH_MS / 2) / TENTH_MS);
}

/** `12` → `"1.2"`; always one decimal. */
export function formatTenths(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export interface TimesheetDay {
  day: string;
  /** Tracked milliseconds of the day (0 when nothing was tracked). */
  ms: number;
  /** Rounded hours of the day in tenths. */
  tenths: number;
  note: string;
}

export interface TimesheetRow {
  key: string;
  label: string;
  space?: string;
  color: string | null;
  days: TimesheetDay[];
  /** Sum of the rounded days, in tenths. */
  totalTenths: number;
}

export interface Timesheet {
  days: string[];
  rows: TimesheetRow[];
  /** Sum of the rows' rounded totals, in tenths. */
  totalTenths: number;
}

/** The distinct descriptions of a day's segments (case and outer spaces ignored), in order of first start. */
export function dayNote(segments: Segment[]): string {
  const sorted = segments
    .map((s) => ({ text: s.entry.description.trim(), start: Math.max(s.entry.startMs, parseDayKey(s.day) ?? 0) }))
    .filter((s) => s.text !== '')
    .sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sorted) {
    const k = s.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.text);
  }
  return out.join(NOTE_SEPARATOR);
}

export function buildTimesheet(report: Pick<Report, 'days' | 'segments'>, groupBy: GroupBy): Timesheet {
  const by = timesheetBy(groupBy);
  const keyOf = (s: Segment): string => (by === 'client' ? s.entry.clientKey : s.entry.projectKey) ?? NONE;
  const groups: Group[] = groupSegments(report.segments, by);
  const rows: TimesheetRow[] = groups.map((g) => {
    const mine = report.segments.filter((s) => keyOf(s) === g.key);
    const days = report.days.map((day): TimesheetDay => {
      const segs = mine.filter((s) => s.day === day);
      const ms = segs.reduce((n, s) => n + s.ms, 0);
      return { day, ms, tenths: roundTenths(ms), note: dayNote(segs) };
    });
    return { key: g.key, label: g.label, space: g.space, color: g.color, days, totalTenths: days.reduce((n, d) => n + d.tenths, 0) };
  });
  return { days: report.days, rows, totalTenths: rows.reduce((n, r) => n + r.totalTenths, 0) };
}

export interface InvoiceLine {
  day: string;
  /** `YYYY-MM-DD - note` (just the date when the note is empty). */
  text: string;
  hours: string;
}

/** One line per day with hours; days that round to 0.0 are left out. */
export function invoiceLines(row: TimesheetRow): InvoiceLine[] {
  return row.days
    .filter((d) => d.tenths > 0)
    .map((d) => ({ day: d.day, text: d.note ? `${d.day} - ${d.note}` : d.day, hours: formatTenths(d.tenths) }));
}

/** Tab-separated `description<TAB>hours` lines for pasting. */
export function copyAllText(lines: InvoiceLine[]): string {
  return lines.map((l) => `${l.text.replace(/[\t\r\n]+/g, ' ')}\t${l.hours}`).join('\n');
}
