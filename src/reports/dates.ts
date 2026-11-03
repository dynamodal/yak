/**
 * Calendar helpers for reports. Everything uses the local time zone of the running JavaScript
 * environment and the local calendar (`new Date(y, m, d)`), so days that are 23 or 25 hours long
 * around a daylight-saving change are handled by the platform instead of by adding 24 hours.
 * Day keys are `YYYY-MM-DD` strings in local time.
 */

export type WeekStart = 'monday' | 'sunday';

export type RangePreset = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'custom';

export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'custom', label: 'Custom range' },
];

/** A half-open range of instants in milliseconds: `from` is included, `to` is not. */
export interface DateRange {
  from: number;
  to: number;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of a day key, or `undefined` for anything that is not a real date. */
export function parseDayKey(key: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return undefined;
  return date.getTime();
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight `n` calendar days after the day containing `ms`. */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

export function startOfWeek(ms: number, weekStart: WeekStart): number {
  const day = new Date(ms).getDay(); // 0 = Sunday
  const back = weekStart === 'monday' ? (day + 6) % 7 : day;
  return addDays(ms, -back);
}

export function startOfMonth(ms: number, monthOffset = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + monthOffset, 1).getTime();
}

function startOfYear(ms: number, yearOffset = 0): number {
  return new Date(new Date(ms).getFullYear() + yearOffset, 0, 1).getTime();
}

/** `Mon 2025-03-03`: a fixed English format, so exports and tests do not depend on the locale. */
export function dayLabel(key: string): string {
  const ms = parseDayKey(key);
  if (ms === undefined) return key;
  return `${WEEKDAYS[new Date(ms).getDay()]} ${key}`;
}

/** `Mon 3`: for narrow column headings. */
export function dayShortLabel(key: string): string {
  const ms = parseDayKey(key);
  if (ms === undefined) return key;
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

export interface CustomRange {
  /** Day keys, both included. */
  from: string;
  to: string;
}

/**
 * The instants covered by a preset. `custom` takes inclusive day keys; reversed or invalid input is
 * repaired (swapped, or replaced by today) instead of throwing, so a half-typed date never breaks the view.
 */
export function resolveRange(preset: RangePreset, now: number, weekStart: WeekStart, custom?: CustomRange): DateRange {
  const today = startOfDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'this_week': {
      const from = startOfWeek(today, weekStart);
      return { from, to: addDays(from, 7) };
    }
    case 'last_week': {
      const to = startOfWeek(today, weekStart);
      return { from: addDays(to, -7), to };
    }
    case 'this_month':
      return { from: startOfMonth(today), to: startOfMonth(today, 1) };
    case 'last_month':
      return { from: startOfMonth(today, -1), to: startOfMonth(today) };
    case 'this_year':
      return { from: startOfYear(today), to: startOfYear(today, 1) };
    case 'custom': {
      let a = custom ? parseDayKey(custom.from) : undefined;
      let b = custom ? parseDayKey(custom.to) : undefined;
      if (a === undefined && b === undefined) return { from: today, to: addDays(today, 1) };
      a ??= b as number;
      b ??= a;
      if (b < a) [a, b] = [b, a];
      return { from: a, to: addDays(b, 1) };
    }
  }
}

/** Day keys of every local calendar day the range touches, in order. */
export function rangeDays(range: DateRange): string[] {
  const days: string[] = [];
  for (let t = startOfDay(range.from); t < range.to; t = addDays(t, 1)) days.push(dayKey(t));
  return days;
}

/** The last day a range covers, as a day key. */
export function lastDayKey(range: DateRange): string {
  return dayKey(addDays(range.from, -1 + rangeDays(range).length));
}

/** A range as the inclusive day keys the custom fields hold. */
export function toCustom(range: DateRange): CustomRange {
  return { from: dayKey(range.from), to: lastDayKey(range) };
}

/**
 * The range one period before (`-1`) or after (`1`) `range` (#277). A whole calendar month steps to the neighbouring
 * month and a whole year to the neighbouring year, so month lengths and leap years follow the calendar; anything else
 * (a day, a week of either week start, a custom range) moves by its own length in calendar days, so it keeps the
 * week-start it began on and stays correct over daylight-saving changes.
 */
export function stepRange(range: DateRange, direction: -1 | 1): DateRange {
  if (range.from === startOfMonth(range.from)) {
    if (range.to === startOfMonth(range.from, 1)) {
      const from = startOfMonth(range.from, direction);
      return { from, to: startOfMonth(from, 1) };
    }
    if (new Date(range.from).getMonth() === 0 && range.to === startOfYear(range.from, 1)) {
      const from = startOfYear(range.from, direction);
      return { from, to: startOfYear(from, 1) };
    }
  }
  const days = rangeDays(range).length * direction;
  return { from: addDays(range.from, days), to: addDays(range.to, days) };
}

/**
 * Next is available only when the period ended before today. A period that contains today, or lies in the future,
 * cannot step forward: there is nothing to see past today, and the buttons never walk into empty weeks.
 */
export function canStepNext(range: DateRange, now: number): boolean {
  return range.to <= startOfDay(now);
}

const STEPPABLE_PRESETS: readonly RangePreset[] = ['today', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'];

/** The preset a range equals today, else `custom`: stepping back to the current week is "This week" again. */
export function presetFor(range: DateRange, now: number, weekStart: WeekStart): RangePreset {
  const same = (a: DateRange): boolean => a.from === range.from && a.to === range.to;
  return STEPPABLE_PRESETS.find((p) => same(resolveRange(p, now, weekStart))) ?? 'custom';
}
