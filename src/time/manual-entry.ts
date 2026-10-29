import { addDays, dayKey } from './dates';

const pad = (n: number): string => String(n).padStart(2, '0');
const timeOf = (ms: number): string => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** The past hour, rounded to the minute, as the "Add entry" form's starting values. */
export function manualDefaults(now: number = Date.now()): { date: string; from: string; to: string } {
  const to = Math.floor(now / 60000) * 60000;
  const from = to - 3600_000;
  return { date: dayKey(from), from: timeOf(from), to: timeOf(to) };
}

/** Date and two times to a range; a stop before the start is on the next day; equal times are rejected. Null when a value is missing, malformed or equal. */
export function manualRange(date: string, from: string, to: string): { start: number; stop: number } | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const f = /^(\d{1,2}):(\d{2})$/.exec(from);
  const t = /^(\d{1,2}):(\d{2})$/.exec(to);
  if (!d || !f || !t) return null;
  const [y, mo, day] = [Number(d[1]), Number(d[2]) - 1, Number(d[3])];
  const start = new Date(y, mo, day, Number(f[1]), Number(f[2])).getTime();
  let stop = new Date(y, mo, day, Number(t[1]), Number(t[2])).getTime();
  if (stop === start) return null;
  if (stop < start) stop = addDays(stop, 1);
  return Number.isFinite(start) && Number.isFinite(stop) ? { start, stop } : null;
}

/** Why `manualRange` gave nothing, for the "Add entry" form. */
export function manualProblem(from: string, to: string): string {
  return from !== '' && from === to ? 'From and To are the same time. Change one, or pick a To after midnight for an entry that ends the next day.' : 'Enter a date and a start and stop time.';
}

/** True when the stop is before the start on the clock, so the entry ends the next day. */
export function endsNextDay(from: string, to: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(from) && /^\d{1,2}:\d{2}$/.test(to) && to.padStart(5, '0') < from.padStart(5, '0');
}
