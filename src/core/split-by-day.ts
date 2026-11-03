/** A half-open range of instants in milliseconds: `from` is included, `to` is not. */
export interface SpanRange {
  from: number;
  to: number;
}

export interface DaySlice {
  day: string;
  ms: number;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight `n` calendar days after the day containing `ms`; the platform handles 23 and 25 hour days. */
function nextMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * Clip `[start, end)` to the range and cut it at local midnights. The pieces add up to the clipped
 * length, so an entry that crosses midnight, a range edge or a daylight-saving change is counted
 * exactly once for the time that really passed. Day keys are `YYYY-MM-DD` in local time.
 */
export function splitByDay(start: number, end: number, range: SpanRange): DaySlice[] {
  const s = Math.max(start, range.from);
  const e = Math.min(end, range.to);
  const out: DaySlice[] = [];
  let cursor = s;
  while (cursor < e) {
    const next = nextMidnight(cursor);
    const sliceEnd = Math.min(e, next);
    out.push({ day: dayKeyOf(cursor), ms: sliceEnd - cursor });
    cursor = sliceEnd;
  }
  return out;
}
