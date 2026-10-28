import { type LocalParts, localToUtcCandidates } from './zone';

/**
 * Reading rows of a Toggl Track "Detailed report" CSV export. Columns are found by header name
 * (case-insensitive), extra columns are ignored and most missing ones are tolerated.
 * Nothing here touches Yjs or the DOM.
 */

export interface ColumnMap {
  description?: number;
  project?: number;
  client?: number;
  task?: number;
  billable?: number;
  tags?: number;
  startDate?: number;
  startTime?: number;
  start?: number;
  endDate?: number;
  endTime?: number;
  end?: number;
  duration?: number;
  durationDecimal?: number;
  user?: number;
  email?: number;
}

/** Header names (normalised: lower case, single spaces) for each field. The first column found wins. */
const HEADER_NAMES: Record<keyof ColumnMap, string[]> = {
  description: ['description'],
  project: ['project', 'project name'],
  client: ['client', 'client name'],
  task: ['task', 'task name'],
  billable: ['billable'],
  tags: ['tags', 'tag'],
  startDate: ['start date'],
  startTime: ['start time'],
  start: ['start', 'start datetime', 'start date time', 'start timestamp'],
  endDate: ['end date'],
  endTime: ['end time'],
  end: ['end', 'end datetime', 'end date time', 'end timestamp', 'stop'],
  duration: ['duration'],
  durationDecimal: ['duration (decimal)', 'duration decimal', 'duration (hours)', 'duration hours'],
  user: ['user', 'member', 'user name', 'username'],
  email: ['email', 'user email'],
};

function normaliseHeader(h: string): string {
  return h.replace(/^﻿/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface HeaderInfo {
  map: ColumnMap;
  /** Original header texts that were recognised. */
  recognised: string[];
  /** Header texts that were not used. */
  ignored: string[];
  /** Plain-language descriptions of what is missing and stops the import; empty when importable. */
  problems: string[];
}

export function mapHeaders(header: readonly string[]): HeaderInfo {
  const map: ColumnMap = {};
  const recognised: string[] = [];
  const ignored: string[] = [];
  const normalised = header.map(normaliseHeader);
  const used = new Set<number>();
  for (const key of Object.keys(HEADER_NAMES) as (keyof ColumnMap)[]) {
    for (const name of HEADER_NAMES[key]) {
      const i = normalised.indexOf(name);
      if (i !== -1 && !used.has(i)) {
        map[key] = i;
        used.add(i);
        break;
      }
    }
  }
  header.forEach((h, i) => (used.has(i) ? recognised : ignored).push(h.replace(/^﻿/, '').trim()));
  const problems: string[] = [];
  if (map.startDate === undefined && map.start === undefined) problems.push('There is no "Start date" column (or a combined "Start" column).');
  else if (map.startDate !== undefined && map.startTime === undefined && map.start === undefined) problems.push('There is a "Start date" column but no "Start time" column.');
  if (map.endDate === undefined && map.endTime === undefined && map.end === undefined && map.duration === undefined && map.durationDecimal === undefined) {
    problems.push('There is no "End date"/"End time" and no "Duration" column, so the length of each entry is unknown.');
  }
  return { map, recognised, ignored, problems };
}

// ---- Cell parsing

interface Ymd {
  year: number;
  month: number;
  day: number;
}
interface Hms {
  hour: number;
  minute: number;
  second: number;
}

function validDate(year: number, month: number, day: number): Ymd | null {
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? { year, month, day } : null;
}

/** `YYYY-MM-DD`, `YYYY/MM/DD` or `DD.MM.YYYY`. Other orders are ambiguous and are refused. */
export function parseDate(text: string): Ymd | null {
  const s = text.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** `HH:MM`, `HH:MM:SS` (fractions ignored), with an optional AM or PM. */
export function parseTime(text: string): Hms | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([ap]\.?m\.?)?$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3] ?? 0);
  const meridiem = m[4]?.[0]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

interface Stamp {
  date: Ymd;
  time: Hms;
  /** Offset in ms when the text carried one (`Z`, `+02:00`); null for a plain wall-clock time. */
  offsetMs: number | null;
}

/** `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SS[.fff][Z|±hh[:mm]]`. */
export function parseStamp(text: string): Stamp | null {
  const m = /^(\S+?)[T\s]+(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*[ap]\.?m\.?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(text.trim());
  if (!m) return null;
  const date = parseDate(m[1] ?? '');
  const time = parseTime(m[2] ?? '');
  if (!date || !time) return null;
  let offsetMs: number | null = null;
  const z = m[3];
  if (z) {
    if (z.toUpperCase() === 'Z') offsetMs = 0;
    else {
      const sign = z.startsWith('-') ? -1 : 1;
      const digits = z.slice(1).replace(':', '');
      const h = Number(digits.slice(0, 2));
      const mi = Number(digits.slice(2) || '0');
      offsetMs = sign * (h * 60 + mi) * 60_000;
    }
  }
  return { date, time, offsetMs };
}

/** `H:MM:SS` (hours may exceed 24) or `H:MM`. Returns whole seconds, or null. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2})(?:[.,]\d+)?)?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

/** Decimal hours such as `1.5` or `1,5`, to whole seconds. */
export function parseDecimalHours(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 3600);
}

export function parseBillable(text: string): boolean {
  return /^(yes|y|true|1|billable)$/i.test(text.trim());
}

/** Comma separated names in one cell; empty names dropped; repeats ignoring case dropped. */
export function splitTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(',')) {
    const name = part.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

// ---- Rows

interface ParsedRow {
  /** Line of the file the row starts on. */
  line: number;
  start: number;
  stop: number;
  description: string;
  project: string;
  client: string;
  task: string;
  tags: string[];
  billable: boolean;
  /** Who tracked it (Email, else User/Member), when the file says. */
  person: string;
  /** Start and stop disagree with the Duration column by more than a minute. */
  durationMismatch: boolean;
}

export type RowResult = { ok: true; row: ParsedRow } | { ok: false; error: string };

const cell = (cells: readonly string[], i: number | undefined): string => (i === undefined ? '' : (cells[i] ?? '').trim());

interface Moment {
  date: Ymd | null;
  time: Hms | null;
  offsetMs: number | null;
}

function readMoment(cells: readonly string[], dateCol: number | undefined, timeCol: number | undefined, combinedCol: number | undefined, label: string): Moment | { error: string } {
  const combined = cell(cells, combinedCol);
  const dateText = cell(cells, dateCol);
  const timeText = cell(cells, timeCol);
  if (combined) {
    const s = parseStamp(combined);
    return s ? s : { error: `${label} "${combined}" is not a valid date and time.` };
  }
  if (dateText && timeText) {
    const date = parseDate(dateText);
    if (!date) return { error: `${label} date "${dateText}" is not a valid date.` };
    const time = parseTime(timeText);
    if (!time) return { error: `${label} time "${timeText}" is not in the form HH:MM:SS.` };
    return { date, time, offsetMs: null };
  }
  if (dateText) {
    // A date column that holds a whole timestamp, or a date without a time.
    const s = parseStamp(dateText);
    if (s) return s;
    const date = parseDate(dateText);
    if (!date) return { error: `${label} date "${dateText}" is not a valid date.` };
    return { date, time: null, offsetMs: null };
  }
  if (timeText) {
    const time = parseTime(timeText);
    if (!time) return { error: `${label} time "${timeText}" is not in the form HH:MM:SS.` };
    return { date: null, time, offsetMs: null };
  }
  return { date: null, time: null, offsetMs: null };
}

const toParts = (d: Ymd, t: Hms): LocalParts => ({ year: d.year, month: d.month, day: d.day, hour: t.hour, minute: t.minute, second: t.second });

function nextDay(d: Ymd): Ymd {
  const n = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
  return { year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: n.getUTCDate() };
}

/** Instants at which a moment can have happened, earliest first. */
function instants(m: { date: Ymd; time: Hms; offsetMs: number | null }, zone: string): number[] {
  if (m.offsetMs !== null) {
    const p = toParts(m.date, m.time);
    return [Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - m.offsetMs];
  }
  return localToUtcCandidates(zone, toParts(m.date, m.time));
}

/**
 * Turn one CSV record into an entry. Start and end are wall-clock times in `zone`. A clock that
 * repeats an hour or skips one is resolved with the Duration column when there is one, so the
 * stored length is what Toggl recorded.
 */
export function parseRow(cells: readonly string[], map: ColumnMap, zone: string, line: number): RowResult {
  const start = readMoment(cells, map.startDate, map.startTime, map.start, 'Start');
  if ('error' in start) return { ok: false, error: start.error };
  if (!start.date) return { ok: false, error: 'There is no start date.' };
  if (!start.time) return { ok: false, error: 'There is no start time.' };
  const end = readMoment(cells, map.endDate, map.endTime, map.end, 'End');
  if ('error' in end) return { ok: false, error: end.error };

  let seconds: number | null = null;
  const durText = cell(cells, map.duration);
  const decText = cell(cells, map.durationDecimal);
  if (durText) {
    // Some exports write Duration as decimal hours (0.13) instead of H:MM:SS.
    seconds = parseDuration(durText) ?? parseDecimalHours(durText);
    if (seconds === null) return { ok: false, error: `Duration "${durText}" is not in the form H:MM:SS or a number of hours (a running timer has no duration).` };
  } else if (decText) {
    seconds = parseDecimalHours(decText);
    if (seconds === null) return { ok: false, error: `Duration "${decText}" is not a number of hours.` };
  }

  const startCandidates = instants({ date: start.date, time: start.time, offsetMs: start.offsetMs }, zone);

  /** The stop for one possible start instant, or an error text. */
  const stopFor = (startMs: number): { stopMs: number; wanted: number | null } | string => {
    const wanted = seconds === null ? null : startMs + seconds * 1000;
    if (end.time) {
      let endDate = end.date;
      const derived = !endDate;
      if (!endDate) endDate = start.date as Ymd;
      const offset = end.offsetMs ?? start.offsetMs;
      let candidates = instants({ date: endDate, time: end.time, offsetMs: offset }, zone);
      if (derived && candidates.every((c) => c < startMs)) {
        // "End date" missing: the entry ran past midnight.
        candidates = instants({ date: nextDay(endDate), time: end.time, offsetMs: offset }, zone);
      }
      const stopMs =
        wanted !== null
          ? candidates.reduce((best, c) => (Math.abs(c - wanted) < Math.abs(best - wanted) ? c : best), candidates[0] ?? Number.NaN)
          : (candidates.find((c) => c >= startMs) ?? candidates[candidates.length - 1] ?? Number.NaN);
      if (stopMs < startMs) return 'The end is before the start.';
      return { stopMs, wanted };
    }
    if (wanted !== null) return { stopMs: wanted, wanted };
    return 'There is no end time and no duration.';
  };

  // A repeated hour gives two possible starts; keep the one that agrees best with Duration.
  let best: { startMs: number; stopMs: number; wanted: number | null } | undefined;
  let firstError = '';
  for (const startMs of startCandidates) {
    const r = stopFor(startMs);
    if (typeof r === 'string') {
      firstError ||= r;
      continue;
    }
    const gap = r.wanted === null ? 0 : Math.abs(r.stopMs - r.wanted);
    const bestGap = best === undefined || best.wanted === null ? 0 : Math.abs(best.stopMs - best.wanted);
    if (!best || gap < bestGap) best = { startMs, stopMs: r.stopMs, wanted: r.wanted };
  }
  if (!best) return { ok: false, error: firstError || 'The date or time could not be read.' };
  const { startMs, stopMs, wanted } = best;
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return { ok: false, error: 'The date or time could not be read.' };

  const durationMismatch = wanted !== null && Math.abs(stopMs - wanted) > 60_000;
  const project = cell(cells, map.project);
  return {
    ok: true,
    row: {
      line,
      start: startMs,
      stop: stopMs,
      description: cell(cells, map.description),
      project,
      // A client only exists through a project, so a client without a project is ignored.
      client: project ? cell(cells, map.client) : '',
      task: cell(cells, map.task),
      tags: splitTags(cell(cells, map.tags)),
      billable: parseBillable(cell(cells, map.billable)),
      person: cell(cells, map.email) || cell(cells, map.user),
      durationMismatch,
    },
  };
}

/** True for a record with no text in any cell. */
export function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((c) => c.trim() === '');
}
