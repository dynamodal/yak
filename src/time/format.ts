import { dayKey, startOfDay } from './dates';

export type HoursFormat = 'decimal' | 'decimal1' | 'decimal0' | 'hm';

/** Decimal hours (`1.25 h` by default; `decimal1` and `decimal0` show one place or none) or `h:mm`, rounded to the nearest minute. */
export function formatHours(seconds: number, format: HoursFormat = 'decimal'): string {
  const s = Math.max(0, Math.round(seconds));
  if (format === 'hm') {
    const minutes = Math.round(s / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return `${(s / 3600).toFixed(format === 'decimal0' ? 0 : format === 'decimal1' ? 1 : 2)} h`;
}

/** `H:MM:SS` for the running timer. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `Today`, `Yesterday`, or a short weekday and date. */
export function formatDayLabel(dayStartMs: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  if (dayKey(dayStartMs) === dayKey(today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(dayStartMs) === dayKey(yesterday.getTime())) return 'Yesterday';
  return new Date(dayStartMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A short span such as `12 min` or `1 h 05 min`, for the idle banner. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
