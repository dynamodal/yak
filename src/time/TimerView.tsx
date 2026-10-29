import { useState } from 'preact/hooks';
import { Button, IconPlus, Page } from '../app/ui';
import { addDays, startOfDay } from './dates';
import { BulkEntries } from './EntrySelection';
import { DayList, RecentlyDeleted, RowSpaces } from './entry-ui';
import { WeekEntries } from './EntriesView';
import { recentlyDeleted, startMs } from './entries';
import { savedTimerView } from '../app/timer-views';
import type { ViewProps } from '../app/registry';
import { useAllTime } from './hooks';
import { ManualEntryDialog } from './ManualEntryDialog';
import { entriesInRange, groupByDay } from './stats';
import { TimerPageHeader } from '../app/views/TimerPageHeader';

const PAGE_DAYS = 7;

type Mode = 'list' | 'week';

/** The view shown: the one in the address, else the last used (X24; a remembered Reports opens through the shell); storage may be unavailable. */
function modeFor(picked: Mode | undefined): Mode {
  return picked ?? (savedTimerView() === 'week' ? 'week' : 'list');
}

export function TimerView({ params }: ViewProps) {
  const all = useAllTime();
  const { data } = all;
  const [days, setDays] = useState(PAGE_DAYS);
  const [adding, setAdding] = useState(false);
  const picked: Mode | undefined = params[0] === 'week' || params[0] === 'list' ? params[0] : undefined;
  const mode = modeFor(picked);
  const now = Date.now();
  const todayStart = startOfDay(now);
  const range = { from: addDays(todayStart, -(days - 1)), to: addDays(todayStart, 1) };
  const shown = entriesInRange(all.entries, range);
  const older = all.entries.some((e) => startMs(e) < range.from);
  const deleted = [...all.slices.values()]
    .filter((s) => all.filter === 'all' || s.spaceId === all.filter)
    .flatMap((s) => recentlyDeleted(s.privateDoc, now).map((e) => ({ ...e, spaceId: s.spaceId })));
  return (
    <RowSpaces.Provider value={{ slices: all.slices, label: all.multi }}>
      <Page width="list" class="timer-page">
        <TimerPageHeader
          title="Time"
          active={mode}
          primary={
            <Button variant="primary" class="add-entry" onClick={() => setAdding(true)}>
              <IconPlus /> <span class="add-entry-label">Add entry</span>
            </Button>
          }
        />
        {adding && <ManualEntryDialog data={data} entries={all.entries} onClose={() => setAdding(false)} />}
        {mode === 'week' ? (
          <WeekEntries all={all} />
        ) : (
          <div class="tl-list">
            {shown.length === 0 ? (
              <p class="empty">{days === PAGE_DAYS ? 'Nothing tracked in the last 7 days.' : `Nothing tracked in the last ${days} days.`}</p>
            ) : (
              <BulkEntries entries={shown} slices={all.slices}>
                <DayList groups={groupByDay(shown, now)} data={data} group level={2} />
              </BulkEntries>
            )}
            {older && (
              <div class="row tl-more">
                <Button onClick={() => setDays(days + PAGE_DAYS)}>Show earlier days</Button>
              </div>
            )}
            <RecentlyDeleted entries={deleted} data={data} />
          </div>
        )}
      </Page>
    </RowSpaces.Provider>
  );
}
