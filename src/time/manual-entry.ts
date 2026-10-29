import { addDays, dayKey } from './dates';

const pad = (n: number): string => String(n).padStart(2, '0');
const timeOf = (ms: number): string => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** The past hour, rounded to the minute, as the "Add entry" form's starting values. */
export function manualDefaults(now: number = Date.now()): { date: string; from: string; to: string } {
  const to = Math.floor(now / 60000) * 60000;
  const from = to - 3600_000;
  return { date: dayKey(from), from: timeOf(from), to: timeOf(to) };
}

/** Date and two times to a range; a stop at or before the start is on the next day. Null when a value is missing or malformed. */
export function manualRange(date: string, from: string, to: string): { start: number; stop: number } | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const f = /^(\d{1,2}):(\d{2})$/.exec(from);
  const t = /^(\d{1,2}):(\d{2})$/.exec(to);
  if (!d || !f || !t) return null;
  const [y, mo, day] = [Number(d[1]), Number(d[2]) - 1, Number(d[3])];
  const start = new Date(y, mo, day, Number(f[1]), Number(f[2])).getTime();
  let stop = new Date(y, mo, day, Number(t[1]), Number(t[2])).getTime();
  if (stop <= start) stop = addDays(stop, 1);
  return Number.isFinite(start) && Number.isFinite(stop) ? { start, stop } : null;
}
