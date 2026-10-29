import { type ComponentChildren, createContext } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useNow } from '../app/hooks';
import { Button, Field, IconBillable, IconButton, IconMore, IconPlay, MenuButton, Pill, Sheet, SHEET_MEDIA, toast, useMedia } from '../app/ui';
import { ensureTag } from './catalog';
import { dayKey, fromLocalInput, isoToMs, toLocalInput } from './dates';
import { parseDuration } from './duration';
import {
  addManualEntry,
  deleteEntry,
  editEntry,
  type EntryFields,
  type EntryRecord,
  entryDuration,
  entryFields,
  isRunning,
  RESTORE_WINDOW_TEXT,
  restoreEntry,
  splitEntry,
  startMs,
} from './entries';
import { formatClock, formatDayLabel, formatHours, formatTimeOfDay } from './format';
import { groupRepeats, type RepeatGroup } from './grouping';
import { type SpaceCatalog, type TimeData, useSpaceName } from './hooks';
import { ProjectPicker, TagPicker } from './pickers';
import type { DayGroup } from './stats';
import { useMoveEntries } from './move-entries';
import { useEntrySelection, useRowPress } from './EntrySelection';
import { DescriptionField, ProjectChip, Total } from './widgets';

type Values = Pick<EntryFields, 'description' | 'project_id' | 'tags' | 'billable'>;

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Lists that mix spaces provide each space's data here, so a row edits the space its entry lives in,
 * and say whether rows carry a space label.
 */
export const RowSpaces = createContext<{ slices: ReadonlyMap<string, TimeData>; label: boolean } | null>(null);

/** The data of the space an entry lives in (the list's own data when the list is of one space). */
function useRowData(entry: EntryRecord, base: TimeData): TimeData {
  const rows = useContext(RowSpaces);
  return (entry.spaceId && rows?.slices.get(entry.spaceId)) || base;
}

function SpaceLabel({ spaceId }: { spaceId: string | undefined }) {
  const rows = useContext(RowSpaces);
  const name = useSpaceName();
  return rows?.label && spaceId ? <Pill class="te-space" tone="outline">{name(spaceId)}</Pill> : null;
}

/** The active space's catalog, from the data the time views already read. */
function catalogOf(data: TimeData, name: string): SpaceCatalog {
  return {
    spaceId: data.spaceId,
    name,
    doc: data.doc,
    projects: data.projects,
    clients: data.clients,
    projectById: data.projectById,
    clientById: data.clientById,
    tagNames: data.tagNames,
  };
}

/** Clicks on the row's background open the editor; clicks on its controls do their own thing. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('button, input, select, textarea, a, label, .popover');
}

interface FieldsFormProps {
  value: Values;
  data: TimeData;
  onPatch(patch: Partial<Values>): void;
  /** Prefix for accessible names when several forms are on one page. */
  idPrefix?: string;
}

/** Description, project, tags and billable of an existing entry, in its editor. Projects stay in the entry's space. */
function FieldsForm({ value, data, onPatch, idPrefix = '' }: FieldsFormProps) {
  const space = catalogOf(data, '');
  return (
    <div class="fields">
      <DescriptionField
        value={value.description}
        label={`${idPrefix}Description`}
        onCommit={(t) => onPatch({ description: t })}
        onPick={(e) => onPatch({ description: e.description, tags: e.tags, billable: e.billable, ...(e.project_id && (e.spaceId ?? data.spaceId) === data.spaceId ? { project_id: e.project_id } : {}) })}
      />
      <ProjectPicker
        spaces={[space]}
        spaceId={data.spaceId}
        projectId={value.project_id}
        label={`${idPrefix}Project`}
        onChange={(_, id) => {
          const project = id ? data.projectById.get(id) : undefined;
          onPatch(project ? { project_id: id, billable: project.billable } : { project_id: id });
        }}
      />
      <TagPicker value={value.tags} known={data.tagNames} label={`${idPrefix}Tags`} onChange={(tags) => onPatch({ tags })} onCreate={(n) => ensureTag(data.doc, n)} />
      <label class="check">
        <input type="checkbox" aria-label={`${idPrefix}Billable`} checked={value.billable} onChange={(e) => onPatch({ billable: (e.target as HTMLInputElement).checked })} />
        <span>Billable</span>
      </label>
    </div>
  );
}

/** Start and stop pickers with a draft: nothing is saved until Save, so half-typed times never break an entry. */
function TimeRange({ start, stop, onSave }: { start: number; stop: number | null; onSave(start: number, stop: number | null): string | null }) {
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [draftStop, setDraftStop] = useState<string | null>(null);
  const [error, setError] = useState('');
  const dirty = draftStart !== null || draftStop !== null;
  const save = (): void => {
    const s = draftStart === null ? start : fromLocalInput(draftStart);
    const e = stop === null ? null : draftStop === null ? stop : fromLocalInput(draftStop);
    if (s === null || (stop !== null && e === null)) {
      setError('Enter a valid date and time.');
      return;
    }
    const problem = onSave(s, e);
    setError(problem ?? '');
    if (!problem) {
      setDraftStart(null);
      setDraftStop(null);
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter' && dirty) {
      ev.preventDefault();
      save();
    }
  };
  return (
    <div class="time-range">
      <Field label="Start" layout="inline">
        <input type="datetime-local" aria-label="Start time" value={draftStart ?? toLocalInput(start)} onInput={(e) => setDraftStart((e.target as HTMLInputElement).value)} onKeyDown={onKey} />
      </Field>
      {stop === null ? (
        <span class="muted">running</span>
      ) : (
        <Field label="Stop" layout="inline">
          <input type="datetime-local" aria-label="Stop time" value={draftStop ?? toLocalInput(stop)} onInput={(e) => setDraftStop((e.target as HTMLInputElement).value)} onKeyDown={onKey} />
        </Field>
      )}
      {dirty && (
        <>
          <Button variant="primary" onClick={save}>
            Save times
          </Button>
          <Button
            onClick={() => {
              setDraftStart(null);
              setDraftStop(null);
              setError('');
            }}
          >
            Reset
          </Button>
        </>
      )}
      {error ? (
        <p class="error full" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SplitControl({ entry, onSplit }: { entry: EntryRecord; onSplit(at: number): string | null }) {
  const start = startMs(entry);
  const end = isRunning(entry) ? Date.now() : isoToMs(entry.stop);
  // Until the user types, the suggestion follows the entry (its times may have just changed).
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? toLocalInput(Math.round((start + end) / 2 / 60000) * 60000);
  const [error, setError] = useState('');
  return (
    <div class="split">
      <Field label="Split at" layout="inline">
        <input type="datetime-local" aria-label="Split at" value={text} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
      </Field>
      <Button
        onClick={() => {
          const at = fromLocalInput(text);
          const problem = at === null ? 'Enter a valid date and time.' : onSplit(at);
          setError(problem ?? '');
        }}
      >
        Split
      </Button>
      {error ? (
        <p class="error full" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function EntryEditPanel({ entry, data, onClose }: { entry: EntryRecord; data: TimeData; onClose(): void }) {
  const [error, setError] = useState('');
  const patch = (p: Partial<Values>): void => {
    const r = editEntry(data.privateDoc, entry.id, p);
    setError(r.ok ? '' : r.error);
  };
  return (
    <div class="edit-panel" role="group" aria-label={`Edit ${entry.description || 'entry'}`}>
      <FieldsForm value={entry} data={data} onPatch={patch} idPrefix="Entry " />
      <TimeRange
        start={startMs(entry)}
        stop={isRunning(entry) ? null : isoToMs(entry.stop)}
        onSave={(s, e) => {
          const r = editEntry(data.privateDoc, entry.id, e === null ? { start: s } : { start: s, stop: e });
          return r.ok ? null : r.error;
        }}
      />
      <SplitControl
        entry={entry}
        onSplit={(at) => {
          const r = splitEntry(data.privateDoc, data.deviceId, entry.id, at);
          return r.ok ? null : r.error;
        }}
      />
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
      <div class="row">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

/** Text that turns into an input on click: Enter or leaving the field saves, Escape cancels. */
function InlineEdit({
  text,
  shown,
  label,
  class: extra,
  inputClass,
  onSave,
}: {
  text: string;
  shown: ComponentChildren;
  label: string;
  class?: string;
  inputClass?: string;
  onSave(text: string): string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  // Layout effect: focus lands before the next key press can arrive.
  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  const begin = (): void => {
    // Armed here, synchronously, not in an effect: a fast Enter after the click must still save.
    done.current = false;
    setEditing(true);
  };
  const finish = (save: boolean): void => {
    if (done.current) return;
    if (save && input.current && input.current.value !== text) {
      const problem = onSave(input.current.value);
      if (problem) {
        setError(problem);
        return;
      }
    }
    done.current = true;
    setError('');
    setEditing(false);
  };
  if (!editing) {
    return (
      <button type="button" class={cx('inline-edit', extra)} aria-label={`${label}: ${text}`} title={label} onClick={begin}>
        {shown}
      </button>
    );
  }
  return (
    <span class={cx('inline-editing', extra)}>
      <input
        ref={input}
        type="text"
        class={inputClass}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        defaultValue={text}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
      {error ? (
        <span class="error inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Duration, ticking while it runs, as `H:MM:SS` running and in the chosen hours format otherwise. */
function durationText(entry: EntryRecord, now: number, data: TimeData): string {
  return isRunning(entry) ? formatClock((now - startMs(entry)) / 1000) : formatHours(entryDuration(entry, now), data.hoursFormat);
}

function Tags({ tags }: { tags: readonly string[] }) {
  return (
    <>
      {tags.map((t) => (
        <Pill key={t} tone="neutral" class="tag-chip">
          {t}
        </Pill>
      ))}
    </>
  );
}

function BillableMark() {
  return (
    <span class="billable" title="Billable" role="img" aria-label="Billable">
      <IconBillable />
    </span>
  );
}

function EntryRow({ entry, data: base, child }: { entry: EntryRecord; data: TimeData; child?: boolean }) {
  const data = useRowData(entry, base);
  const moveTo = useMoveEntries();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  // Phones: the whole row opens the editor in a sheet; no inline edits (X27).
  const phone = useMedia(SHEET_MEDIA);
  const project = entry.project_id ? data.projectById.get(entry.project_id) : undefined;
  const running = isRunning(entry);
  const sel = useEntrySelection();
  const press = useRowPress([entry.id]);
  const picked = !running && !!sel?.has(entry.id);
  const now = useNow(running ? 1000 : 3_600_000);
  const start = startMs(entry);
  const stop = running ? null : isoToMs(entry.stop);
  const label = entry.description || 'entry';
  const nextDay = stop !== null && dayKey(stop) !== dayKey(start);
  const edit = (p: Parameters<typeof editEntry>[2]): string | null => {
    const r = editEntry(data.privateDoc, entry.id, p);
    setError(r.ok ? '' : r.error);
    return r.ok ? null : r.error;
  };
  const setDuration = (text: string): string | null => {
    const secs = parseDuration(text);
    if (secs === null) return 'Type a duration such as 1:30, 90m or 1.5h.';
    return running ? edit({ start: Date.now() - secs * 1000 }) : edit({ stop: start + secs * 1000 });
  };
  const remove = (): void => {
    const doc = data.privateDoc;
    deleteEntry(doc, entry.id);
    toast(`Deleted “${label}”. You can restore it for ${RESTORE_WINDOW_TEXT}.`, { action: { label: 'Undo', run: () => void restoreEntry(doc, entry.id) } });
  };
  const duplicate = (): void => {
    if (stop === null) return;
    const r = addManualEntry(data.privateDoc, data.deviceId, { start, stop, ...entryFields(entry) }, data.doc);
    setError(r.ok ? '' : r.error);
  };

  return (
    <li class={cx('entry te-row', running && 'running', child && 'te-child', open && 'open', picked && 'selected')} data-entry={entry.id}>
      <div
        class="te-line"
        {...press.handlers}
        onClick={(e) => {
          if (press.suppressClick()) return;
          if (sel && !running && (sel.active || e.ctrlKey || e.metaKey || e.shiftKey)) {
            if (!isControl(e.target)) sel.click([entry.id], e);
            return;
          }
          if (!isControl(e.target)) setOpen(!open);
        }}
      >
        {sel?.active && !running && <input type="checkbox" class="te-check" aria-label={`Select ${label}`} checked={picked} onClick={(e) => sel.click([entry.id], e)} />}
        <div class="te-main">
          {phone ? (
            <span class="te-desc static">{entry.description || <span class="muted">(no description)</span>}</span>
          ) : (
            <InlineEdit
              class="te-desc"
              inputClass="te-desc-input"
              text={entry.description}
              shown={entry.description || <span class="muted">(no description)</span>}
              label={`Description of ${label}`}
              onSave={(t) => edit({ description: t })}
            />
          )}
          <div class="te-meta">
            {phone ? (
              <ProjectChip project={project} client={project?.client_id ? data.clientById.get(project.client_id) : undefined} />
            ) : (
              <ProjectPicker
                class="te-project"
                spaces={[catalogOf(data, '')]}
                spaceId={data.spaceId}
                projectId={entry.project_id}
                label={`Project of ${label}`}
                placeholder="Add project"
                onChange={(_, id) => {
                  const project = id ? data.projectById.get(id) : undefined;
                  edit(project ? { project_id: id, billable: project.billable } : { project_id: id });
                }}
              />
            )}
            <Tags tags={entry.tags} />
            {entry.billable && <BillableMark />}
            <SpaceLabel spaceId={entry.spaceId} />
          </div>
        </div>
        <span class="te-range">
          {formatTimeOfDay(start)} – {stop === null ? 'now' : formatTimeOfDay(stop)}
          {nextDay ? ' (+1)' : ''}
        </span>
        {phone ? (
          <span class="te-dur duration">{durationText(entry, now, data)}</span>
        ) : (
          <InlineEdit class="te-dur duration" inputClass="te-dur-input" text={durationText(entry, now, data)} shown={durationText(entry, now, data)} label={`Duration of ${label}`} onSave={setDuration} />
        )}
        <div class="te-actions">
          <IconButton class="te-continue" label={`Continue: ${label}`} icon={<IconPlay />} disabled={running} onClick={() => data.controller.continueFrom(data.spaceId, entryFields(entry))} />
          <MenuButton
            class="te-more"
            label={`More actions: ${label}`}
            icon={<IconMore />}
            items={[
              { label: open ? 'Close editor' : 'Edit', onSelect: () => setOpen(!open) },
              { label: 'Duplicate', onSelect: duplicate, disabled: running },
              ...(running ? [] : moveTo.to([entry]).map((d) => ({ label: `Move to ${d.name}`, onSelect: () => moveTo.move([entry], d.id) }))),
              { label: 'Delete', onSelect: remove, danger: true },
            ]}
          />
        </div>
      </div>
      {error ? !open && (
        <p class="error te-error" role="alert">
          {error}
        </p>
      ) : null}
      {open &&
        (phone ? (
          <Sheet label={`Edit ${label}`} onClose={() => setOpen(false)}>
            <EntryEditPanel entry={entry} data={data} onClose={() => setOpen(false)} />
          </Sheet>
        ) : (
          <EntryEditPanel entry={entry} data={data} onClose={() => setOpen(false)} />
        ))}
    </li>
  );
}

/** Recently deleted entries, with Restore; after the restore window a delete is permanent. */
export function RecentlyDeleted({ entries, data }: { entries: readonly EntryRecord[]; data: TimeData }) {
  const [error, setError] = useState('');
  const rows = useContext(RowSpaces);
  if (entries.length === 0) return null;
  return (
    <details class="tl-deleted">
      <summary>Recently deleted ({entries.length})</summary>
      <ul class="entries">
        {entries.map((e) => {
          const own = (e.spaceId && rows?.slices.get(e.spaceId)) || data;
          const project = e.project_id ? own.projectById.get(e.project_id) : undefined;
          const label = e.description || 'entry';
          return (
            <li key={e.id} class="te-deleted" data-entry={e.id}>
              <div class="te-line">
                <div class="te-main">
                  <span class="te-desc static">{e.description || <span class="muted">(no description)</span>}</span>
                  <div class="te-meta">
                    <ProjectChip project={project} client={undefined} />
                    <SpaceLabel spaceId={e.spaceId} />
                  </div>
                </div>
                <span class="te-range">
                  {formatDayLabel(startMs(e))}, {formatTimeOfDay(startMs(e))}
                </span>
                <span class="te-dur duration">{formatHours(entryDuration(e, Date.now()), data.hoursFormat)}</span>
                <Button
                  class="te-restore"
                  aria-label={`Restore ${label}`}
                  onClick={() => {
                    const r = restoreEntry(own.privateDoc, e.id);
                    setError(r.ok ? '' : r.error);
                  }}
                >
                  Restore
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p class="error te-error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}

/** Repeated entries of a day as one row with a count; expands to the single entries. */
function GroupRow({ group, data: base }: { group: RepeatGroup; data: TimeData }) {
  const [expanded, setExpanded] = useState(false);
  const newest = group.entries[0]!;
  const data = useRowData(newest, base);
  const oldest = group.entries[group.entries.length - 1]!;
  const label = newest.description || 'entry';
  const project = newest.project_id ? data.projectById.get(newest.project_id) : undefined;
  const client = project?.client_id ? data.clientById.get(project.client_id) : undefined;
  const lastStop = Math.max(...group.entries.map((e) => (isRunning(e) ? Date.now() : isoToMs(e.stop))));
  const toggle = (): void => setExpanded(!expanded);
  const sel = useEntrySelection();
  const ids = group.entries.filter((e) => !isRunning(e)).map((e) => e.id);
  const press = useRowPress(ids);
  const moveTo = useMoveEntries();
  const destinations = moveTo.to(group.entries);
  const picked = ids.length > 0 ? (sel?.state(ids) ?? 'none') : 'none';
  return (
    <li class={cx('te-group', expanded && 'expanded', picked === 'all' && 'selected')} data-group={group.key} data-ids={ids.join(',')}>
      <div
        class="te-line"
        {...press.handlers}
        onClick={(e) => {
          if (press.suppressClick()) return;
          if (sel && ids.length > 0 && (sel.active || e.ctrlKey || e.metaKey || e.shiftKey)) {
            if (!isControl(e.target)) sel.click(ids, e);
            return;
          }
          if (!isControl(e.target)) toggle();
        }}
      >
        {sel?.active && ids.length > 0 && (
          <input
            type="checkbox"
            class="te-check"
            aria-label={`Select ${group.entries.length} entries: ${label}`}
            checked={picked === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = picked === 'some';
            }}
            onClick={(e) => sel.click(ids, e)}
          />
        )}
        <Button class="te-count" aria-expanded={expanded} aria-label={`${group.entries.length} entries: ${label}. ${expanded ? 'Hide' : 'Show'} them`} onClick={toggle}>
          {group.entries.length}
        </Button>
        <div class="te-main">
          <span class="te-desc static">{newest.description || <span class="muted">(no description)</span>}</span>
          <div class="te-meta">
            <ProjectChip project={project} client={client} />
            <Tags tags={newest.tags} />
            {newest.billable && <BillableMark />}
            <SpaceLabel spaceId={newest.spaceId} />
          </div>
        </div>
        <span class="te-range">
          {formatTimeOfDay(startMs(oldest))} – {formatTimeOfDay(lastStop)}
        </span>
        <Total entries={group.entries} format={data.hoursFormat} />
        <div class="te-actions">
          <IconButton class="te-continue" label={`Continue: ${label}`} icon={<IconPlay />} onClick={() => data.controller.continueFrom(data.spaceId, entryFields(newest))} />
          {destinations.length > 0 ? (
            <MenuButton
              class="te-more"
              label={`More actions: ${label} (${group.entries.length} entries)`}
              icon={<IconMore />}
              items={destinations.map((d) => ({ label: `Move all to ${d.name}`, onSelect: () => moveTo.move(group.entries, d.id) }))}
            />
          ) : (
            <span class="te-more-spacer" aria-hidden="true" />
          )}
        </div>
      </div>
      {expanded && (
        <ul class="entries te-children">
          {group.entries.map((e) => (
            <EntryRow key={e.id} entry={e} data={data} child />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface DayListProps {
  groups: readonly DayGroup[];
  data: TimeData;
  hideEmpty?: boolean;
  /** Collapse repeated entries of a day into one row with a count. */
  group?: boolean;
  /** Level of the day headings: 2 on a page with no heading of its own above the days, else 3. */
  level?: 2 | 3;
}

/** Entries grouped by day, each day with its total. */
export function DayList({ groups, data, hideEmpty, group, level = 3 }: DayListProps) {
  const Head = `h${level}` as const;
  const sel = useEntrySelection();
  const shown = hideEmpty ? groups.filter((g) => g.entries.length > 0) : groups;
  return (
    <>
      {shown.map((g) => {
        const rows = g.entries;
        return (
          <section key={g.key} class="day" aria-label={formatDayLabel(g.dayStart)}>
            <Head class="day-head">
              <span class="day-title">
                {sel?.active && rows.some((e) => !isRunning(e)) && (
                  <DayCheck label={formatDayLabel(g.dayStart)} ids={rows.filter((e) => !isRunning(e)).map((e) => e.id)} />
                )}
                {formatDayLabel(g.dayStart)}
              </span>
              <Total entries={g.entries} format={data.hoursFormat} />
            </Head>
            {rows.length === 0 ? (
              <p class="empty">{'No entries.'}</p>
            ) : (
              <ul class="entries">
                {group
                  ? groupRepeats(rows).map((r) => (r.entries.length > 1 ? <GroupRow key={r.key} group={r} data={data} /> : <EntryRow key={r.entries[0]!.id} entry={r.entries[0]!} data={data} />))
                  : rows.map((e) => <EntryRow key={e.id} entry={e} data={data} />)}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

/** Selects every finished entry of a day. */
function DayCheck({ label, ids }: { label: string; ids: string[] }) {
  const sel = useEntrySelection();
  const state = sel?.state(ids) ?? 'none';
  return (
    <input
      type="checkbox"
      class="te-check"
      aria-label={`Select ${label}`}
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      onClick={() => sel?.set(ids, state !== 'all')}
    />
  );
}
