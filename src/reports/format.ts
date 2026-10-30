import { type DateRange, dayKey } from './dates';
import type { Amounts } from './aggregate';

export type HoursFormat = 'decimal' | 'decimal1' | 'decimal0' | 'hm';

/** The shared setting `settings.hours_format` stores `decimal`, `decimal1`, `decimal0` or `hm` (`h:mm` reads as `hm`); anything else means `decimal`. */
export function parseHoursFormat(value: unknown): HoursFormat {
  if (value === 'h:mm' || value === 'hm') return 'hm';
  return value === 'decimal1' || value === 'decimal0' ? value : 'decimal';
}

const HOUR = 3_600_000;

/** `1.25 h` or `1:15`. The h:mm form rounds to the nearest minute. */
export function formatDuration(ms: number, format: HoursFormat): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (format === 'hm') {
    const minutes = Math.round(safe / 60_000);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return `${(safe / HOUR).toFixed(format === 'decimal0' ? 0 : format === 'decimal1' ? 1 : 2)} h`;
}

/** Decimal hours without the unit, for CSV. */
export function decimalHours(ms: number): string {
  return (Math.max(0, ms) / HOUR).toFixed(4);
}

/** `h:mm:ss` for CSV. */
export function clockDuration(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPercent(part: number, total: number): string {
  if (total <= 0 || part <= 0) return '0%';
  const p = (part / total) * 100;
  return p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/** Currency codes are free text in the data, so an unknown one falls back to `12.50 XYZ`. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** All currencies of a total, for example `$120.00, €80.00`; an em dash when nothing has a rate. */
export function formatAmounts(amounts: Amounts, locale?: string): string {
  const codes = Object.keys(amounts).sort();
  if (codes.length === 0) return '—';
  return codes.map((c) => formatMoney(amounts[c] ?? 0, c, locale)).join(', ');
}

/** `2025-03-03 to 2025-03-09`, or a single day. */
export function rangeLabel(range: DateRange): string {
  const a = dayKey(range.from);
  const b = dayKey(range.to - 1);
  return a === b ? a : `${a} to ${b}`;
}

/** Local `HH:mm` for an instant. */
export function clockTime(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}${withSeconds ? ':' + p(d.getSeconds()) : ''}`;
}

/** Duration without a unit, for narrow table cells: `1.25` or `1:15`. */
export function formatCompact(ms: number, format: HoursFormat): string {
  const full = formatDuration(ms, format);
  return format !== 'hm' ? full.replace(/ h$/, '') : full;
}
