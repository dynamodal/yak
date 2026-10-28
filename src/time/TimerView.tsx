import { useState } from 'preact/hooks';
import { Button, IconBillable, IconButton, IconClock, IconPlay, IconStop, Page } from '../app/ui';
import { ensureTag } from './catalog';
import { addDays, dayKey, startOfDay } from './dates';
import { BulkEntries } from './EntrySelection';
import { DayList, RecentlyDeleted, RowSpaces } from './entry-ui';
import { WeekEntries } from './EntriesView';
import { addManualEntry, editEntry, type EntryFields, type EntryRecord, isRunning, recentlyDeleted, startMs } from './entries';
import { useApp } from '../app/context';
import { savedTimerView } from '../app/timer-views';
import type { ViewProps } from '../app/registry';
import { type SpaceCatalog, type TimeData, useAllTime, useCatalogs, useRunning } from './hooks';
import { ProjectPicker, TagPicker } from './pickers';
import { entriesInRange, groupByDay, todayRange, weekRange } from './stats';
import { TimerPageHeader } from '../app/views/TimerPageHeader';
import { DescriptionField, LiveClock, Total } from './widgets';
import { type Draft, EMPTY_DRAFT, setDraft, useDraft } from './timer-draft';

type Fields = Pick<EntryFields, 'description' | 'project_id' | 'tags' | 'billable'>;
const EMPTY = EMPTY_DRAFT;

const pad = (n: number): string => String(n).padStart(2, '0');
const timeOf = (ms: number): string => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** The past hour, rounded to the minute, as the manual mode's starting values. */
function manualDefaults(): { date: string; from: string; to: string } {
  const to = Math.floor(Date.now() / 60000) * 60000;
  const from = to - 3600_000;
  return { date: dayKey(from), from: timeOf(from), to: timeOf(to) };
}

/** Date and two times to a range; a stop at or before the start is on the next day. */
function manualRange(date: string, from: string, to: string): { start: number; stop: number } | null {
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

/**
 * The timer bar: description, project (from every space, labelled by space), tags, billable and a
 * large start/stop button that shows the elapsed time. While a timer runs, in any space, the bar
 * shows and edits that entry. A clock button switches to adding a finished entry.
 */
function TimerBar({ data, entries }: { data: TimeData; entries: readonly EntryRecord[] }) {
  const { spaces, setSpaceId } = useApp();
  const catalogs = useCatalogs();
  const running = useRunning();
  const latest = running[running.length - 1];
  // The bar holds the running entry, in whichever space it runs (one running timer across spaces).
  const current = latest;
  const draft = useDraft();
  const [manual, setManual] = useState(false);
  const [times, setTimes] = useState(manualDefaults);
  const [error, setError] = useState('');

  const spaceId = current ? current.spaceId : (draft.spaceId ?? data.spaceId);
  const value: Fields = current
    ? { description: current.entry.description, project_id: current.entry.project_id, tags: current.entry.tags, billable: current.entry.billable }
    : draft;
  const space: SpaceCatalog | undefined = catalogs.find((c) => c.spaceId === spaceId);
  // A running entry stays in its space: moving it would mean moving it to another document.
  const offered = current ? catalogs.filter((c) => c.spaceId === current.spaceId) : catalogs;

  const patch = (p: Partial<Draft>): void => {
    if (current) {
      const doc = data.controller.privateDocs.get(current.spaceId);
      const { spaceId: _ignored, ...fields } = p;
      const r = doc ? editEntry(doc, current.id, fields) : { ok: false as const, error: 'That space is not on this device.' };
      setError(r.ok ? '' : r.error);
    } else setDraft((d) => ({ ...d, ...p }));
  };
  const setProject = (sid: string, id: string | null): void => {
    const project = id ? catalogs.find((c) => c.spaceId === sid)?.projectById.get(id) : undefined;
    // A project just made here is not in the catalogs yet; keep its id and only copy `billable` when it is known.
    patch({ spaceId: id ? sid : null, project_id: id, ...(project ? { billable: project.billable } : {}) });
  };
  /** Tags are names; make sure the target space has a record for each before an entry uses them there. */
  const tagsFor = (sid: string, tags: readonly string[]): string[] => {
    const doc = catalogs.find((c) => c.spaceId === sid)?.doc;
    return doc ? tags.map((t) => ensureTag(doc, t) ?? t) : [...tags];
  };
  const start = (): void => {
    data.controller.start(spaceId, { ...draft, tags: tagsFor(spaceId, draft.tags) });
    setSpaceId(spaceId);
    setDraft(EMPTY);
    setError('');
  };
  const stop = (): void => {
    if (latest) data.controller.stop(latest);
  };
  const addFinished = (): void => {
    const range = manualRange(times.date, times.from, times.to);
    const doc = data.controller.privateDocs.get(spaceId);
    if (!range || !doc || !space) {
      setError('Enter a date and a start and stop time.');
      return;
    }
    const r = addManualEntry(doc, data.deviceId, { ...range, ...draft, tags: tagsFor(spaceId, draft.tags) }, space.doc);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSpaceId(spaceId);
    setDraft(EMPTY);
    setTimes(manualDefaults());
    setError('');
  };
  const inManual = manual && !current;

  return (
    <div class={['card', 'timer-bar', 'tb', current ? 'running' : '', inManual ? 'manual' : ''].join(' ').trim()} role="group" aria-label="Timer">
      <div class="tb-desc">
        <DescriptionField
          value={value.description}
          entries={entries}
          placeholder={inManual ? 'What did you work on?' : 'What are you working on?'}
          onText={current ? undefined : (t) => patch({ description: t })}
          onCommit={(t) => patch({ description: t })}
          onEnter={current ? undefined : inManual ? addFinished : start}
          onPick={(e) =>
            current
              ? patch({ description: e.description, project_id: e.project_id, tags: e.tags, billable: e.billable })
              : patch({ spaceId: e.project_id ? (e.spaceId ?? data.spaceId) : null, description: e.description, project_id: e.project_id, tags: e.tags, billable: e.billable })
          }
        />
      </div>
      <div class="tb-fields">
        <ProjectPicker spaces={offered} spaceId={spaceId} projectId={value.project_id} onChange={setProject} showSpace={spaceId !== data.spaceId} />
        <TagPicker value={value.tags} known={space?.tagNames ?? data.tagNames} onChange={(tags) => patch({ tags })} onCreate={(n) => (space ? ensureTag(space.doc, n) : n)} />
        <label class={value.billable ? 'tb-billable on' : 'tb-billable'} title={value.billable ? 'Billable' : 'Not billable'}>
          <input type="checkbox" class="visually-hidden" aria-label="Billable" checked={value.billable} onChange={(e) => patch({ billable: (e.target as HTMLInputElement).checked })} />
          <IconBillable />
        </label>
        {!current && !value.project_id && spaces.length > 1 && (
          <select class="tb-space" aria-label="Space for the new entry" value={spaceId} onChange={(e) => patch({ spaceId: (e.target as HTMLSelectElement).value })}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {!current && (
          <IconButton
            class={inManual ? 'tb-mode on' : 'tb-mode'}
            label={inManual ? 'Back to the timer' : 'Add a finished entry'}
            aria-pressed={inManual}
            icon={<IconClock />}
            onClick={() => {
              setManual(!manual);
              setTimes(manualDefaults());
              setError('');
            }}
          />
        )}
      </div>
      {inManual ? (
        <div class="tb-manual" role="group" aria-label="Finished entry">
          <input type="date" aria-label="Date" value={times.date} onInput={(e) => setTimes((t) => ({ ...t, date: (e.target as HTMLInputElement).value }))} />
          <span class="tb-times">
            <input type="time" aria-label="From" value={times.from} onInput={(e) => setTimes((t) => ({ ...t, from: (e.target as HTMLInputElement).value }))} />
            <span class="muted" aria-hidden="true">–</span>
            <input type="time" aria-label="To" value={times.to} onInput={(e) => setTimes((t) => ({ ...t, to: (e.target as HTMLInputElement).value }))} />
          </span>
          <Button variant="primary" onClick={addFinished}>
            Add
          </Button>
        </div>
      ) : (
        <div class="tb-go">
          {current ? (
            <Button variant="primary" class="tb-start running" aria-label="Stop" title="Stop the timer" onClick={stop}>
              <LiveClock since={startMs(current.entry)} />
              <IconStop />
            </Button>
          ) : (
            <Button variant="primary" class="tb-start" aria-label="Start" title="Start the timer (Enter in the description)" onClick={start}>
              <span class="clock">0:00:00</span>
              <IconPlay />
            </Button>
          )}
        </div>
      )}
      {error ? (
        <p class="error tb-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

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
  const picked: Mode | undefined = params[0] === 'week' || params[0] === 'list' ? params[0] : undefined;
  const mode = modeFor(picked);
  const now = Date.now();
  const todayStart = startOfDay(now);
  const range = { from: addDays(todayStart, -(days - 1)), to: addDays(todayStart, 1) };
  const shown = entriesInRange(all.entries, range);
  const today = entriesInRange(all.entries, todayRange(now));
  const week = entriesInRange(all.entries, weekRange(now, data.weekStart));
  const older = all.entries.some((e) => startMs(e) < range.from);
  const onlyRunning = shown.length > 0 && shown.every(isRunning);
  const deleted = [...all.slices.values()]
    .filter((s) => all.filter === 'all' || s.spaceId === all.filter)
    .flatMap((s) => recentlyDeleted(s.privateDoc, now).map((e) => ({ ...e, spaceId: s.spaceId })));
  return (
    <RowSpaces.Provider value={{ slices: all.slices, label: all.multi }}>
      <Page width="list" class="timer-page">
        <TimerPageHeader title="Timer" active={mode} />
        <TimerBar data={data} entries={all.entries} />
        {mode === 'week' ? (
          <WeekEntries all={all} />
        ) : (
          <>
        <div class="tl-summary" aria-label="Totals">
          <div class="tl-stat">
            <span class="tl-stat-label">Today</span>
            <Total entries={today} format={data.hoursFormat} />
          </div>
          <div class="tl-stat">
            <span class="tl-stat-label">This week</span>
            <Total entries={week} format={data.hoursFormat} />
          </div>
        </div>
        {shown.length === 0 || onlyRunning ? (
          <p class="empty">{days === PAGE_DAYS ? 'Nothing tracked in the last 7 days.' : `Nothing tracked in the last ${days} days.`}</p>
        ) : (
          <BulkEntries entries={shown} slices={all.slices}>
            <DayList groups={groupByDay(shown, now)} data={data} group hideRunning level={2} />
          </BulkEntries>
        )}
        {older && (
          <div class="row tl-more">
            <Button onClick={() => setDays(days + PAGE_DAYS)}>Show earlier days</Button>
          </div>
        )}
        <RecentlyDeleted entries={deleted} data={data} />
          </>
        )}
      </Page>
    </RowSpaces.Provider>
  );
}
