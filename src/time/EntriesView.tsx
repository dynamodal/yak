import { useEffect, useState } from 'preact/hooks';
import { useSearchTarget } from '../app/search-sources';
import { Button, IconChevronLeft, IconChevronRight } from '../app/ui';
import { addDays, startOfWeek } from './dates';
import { BulkEntries } from './EntrySelection';
import { DayList } from './entry-ui';
import type { AllTime } from './hooks';
import { entriesInRange, groupByDay, weekRange } from './stats';
import { Total } from './widgets';

function rangeLabel(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(addDays(to, -1));
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${f.toLocaleDateString(undefined, opts)} – ${t.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}

/** The Week view of the Time page: one week, every entry listed separately, empty days shown. */
/** Days that have not happened yet and hold nothing are left out, so a week does not end in a column of "No entries."; a week wholly in the future keeps them. */
function upToToday<T extends { dayStart: number; entries: readonly unknown[] }>(groups: readonly T[], now: number): readonly T[] {
  const shown = groups.filter((g) => g.entries.length > 0 || g.dayStart <= now);
  return shown.length ? shown : groups;
}

export function WeekEntries({ all }: { all: AllTime }) {
  const { data } = all;
  const [anchor, setAnchor] = useState(() => Date.now());
  const [hit, setHit] = useState<string | null>(null);
  useSearchTarget(['entry'], (t) => {
    setAnchor(t.at ?? Date.now());
    setHit(t.id);
  });
  // The row found by the search: scroll to it and flash it once the week it is in has rendered.
  useEffect(() => {
    if (!hit) return;
    const row = document.querySelector(`[data-entry="${hit}"]`);
    if (!row) return;
    row.scrollIntoView?.({ block: 'center' });
    row.classList.add('search-hit-flash');
    const timer = setTimeout(() => row.classList.remove('search-hit-flash'), 3000);
    return () => clearTimeout(timer);
  }, [hit, anchor]);
  const now = Date.now();
  const range = weekRange(anchor, data.weekStart);
  const inWeek = entriesInRange(all.entries, range);
  const isThisWeek = startOfWeek(now, data.weekStart) === range.from;
  return (
    <>
      <div class="row week-nav" role="group" aria-label="Week">
        <Button aria-label="Previous week" onClick={() => setAnchor(addDays(range.from, -7))}>
          <IconChevronLeft /> Previous
        </Button>
        <strong class="week-label" aria-live="polite">
          {rangeLabel(range.from, range.to)}
        </strong>
        <Button aria-label="Next week" onClick={() => setAnchor(addDays(range.from, 7))}>
          Next <IconChevronRight />
        </Button>
        <Button disabled={isThisWeek} onClick={() => setAnchor(Date.now())}>
          This week
        </Button>
      </div>
      <h2 class="section-head">
        <span>Week total</span>
        <Total entries={inWeek} format={data.hoursFormat} />
      </h2>
      <BulkEntries entries={inWeek} slices={all.slices}>
        <DayList groups={upToToday(groupByDay(inWeek, now, range), now)} data={data} />
      </BulkEntries>
    </>
  );
}
