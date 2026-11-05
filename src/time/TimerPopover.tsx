import type { RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, IconBillable, Popover } from '../app/ui';
import { ensureTag } from './catalog';
import { editEntry, entryFields, type EntryRecord, type RunningRef, startMs } from './entries';
import { matchCandidates } from './fuzzy';
import { type SpaceCatalog, useCandidates, useCatalogs, useController, useRecents, useSpaceName } from './hooks';
import { ProjectPicker, TagPicker } from './pickers';
import { relativeAgo } from './recents';
import { EMPTY_DRAFT, type Draft, setDraft, useDraft } from './timer-draft';
import { startFromDraft, timerSpace } from './timer-start';
import { LiveClock, Swatch } from './widgets';

type Fields = Pick<Draft, 'description' | 'project_id' | 'tags' | 'billable'>;

export interface TimerPopoverProps {
  id?: string;
  /** The pill: the panel sits under it, and a click on it does not count as outside. */
  anchor: RefObject<HTMLElement | null>;
  /** The running entry, when there is one: the popover then edits it ("Update") instead of the draft ("Start"). */
  current: RunningRef | undefined;
  /** The running entry's project colour, shown in the pill beside the description. */
  color?: string;
  /** `focusPill`: the details closed through the popover's own action (a pick, Start, Update), so focus goes back to the pill. */
  onClose(focusPill?: boolean): void;
  /** Called on Escape, before `onClose`, so the pill can send focus back to where it was. */
  onEscape(): void;
}

/** One row of the list: a recent entry (the first may be "Continue") or a match for what was typed. */
interface Row {
  key: string;
  spaceId: string;
  entry: EntryRecord;
  continues: boolean;
  stoppedAt?: number;
}

/**
 * The pill's details (F-33j, X-160). The description is typed in the pill itself, where the description is shown; the panel
 * under it holds one list, then project, tags, billable and Start/Update. The list is Recent while the description is as it
 * was, and the past work matching it once something is typed (fuzzy, `matchCandidates`), in place: nothing floats over it.
 * A pick uses the row at once: stopped, it starts a timer with its fields; running, it fills the running entry. Arrow keys
 * move through the list with focus kept in the input (`aria-activedescendant`), Enter picks the active row or else starts or
 * updates, Esc closes and drops a description typed for the running entry. Stopped, it edits the shared draft (so half a
 * description survives navigation, H-21).
 */
export function TimerPopover({ id, anchor, current, color, onClose, onEscape }: TimerPopoverProps) {
  const { spaceId, setSpaceId, spaceDocs, privateDocs } = useApp();
  const controller = useController();
  const catalogs = useCatalogs();
  const spaceName = useSpaceName();
  const draft = useDraft();
  const recents = useRecents(current);
  const candidates = useCandidates();
  const [error, setError] = useState('');
  const [text, setText] = useState(() => (current ? current.entry.description : draft.description));
  /** Typed since it opened: the list shows matches instead of Recent. */
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const descRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const headingId = useId();
  const multi = catalogs.length > 1;

  // Focus starts in the description, with the caret at the end, whether it opened by click or by Alt+S.
  useLayoutEffect(() => {
    const input = descRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  // The panel ends above the bottom of what is visible: the on-screen keyboard shrinks the visual viewport, not the layout one.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const fit = (): void => {
      const p = panelRef.current;
      const a = anchor.current;
      if (!p || !a) return;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      p.style.maxHeight = `${Math.max(176, Math.round(bottom - a.getBoundingClientRect().bottom - 12))}px`;
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    return () => {
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, [anchor]);

  const runSpace = current?.spaceId;
  const targetSpace = runSpace ?? draft.spaceId ?? timerSpace(privateDocs, spaceId);
  const value: Fields = current
    ? { description: text, project_id: current.entry.project_id, tags: current.entry.tags, billable: current.entry.billable }
    : { description: text, project_id: draft.project_id, tags: draft.tags, billable: draft.billable };
  const space: SpaceCatalog | undefined = catalogs.find((c) => c.spaceId === targetSpace);
  // A running entry stays in its space: moving it would mean moving it to another document.
  const offered = current ? catalogs.filter((c) => c.spaceId === current.spaceId) : catalogs;

  /** Tags are names; make sure the target space has a record for each before an entry uses them there. */
  const tagsFor = (sid: string, tags: readonly string[]): string[] => {
    const doc = spaceDocs.get(sid);
    return doc ? tags.map((t) => ensureTag(doc, t) ?? t) : [...tags];
  };
  const patchRunning = (p: Partial<Fields>): boolean => {
    if (!current) return false;
    const doc = privateDocs.get(current.spaceId);
    const r = doc ? editEntry(doc, current.id, p.tags ? { ...p, tags: tagsFor(current.spaceId, p.tags) } : p) : { ok: false as const, error: 'That space is not on this device.' };
    setError(r.ok ? '' : r.error);
    return r.ok;
  };
  const patch = (p: Partial<Draft>): void => {
    if (current) {
      const { spaceId: _ignored, ...fields } = p;
      patchRunning(fields);
    } else setDraft((d) => ({ ...d, ...p }));
  };
  const setProject = (sid: string, id: string | null): void => {
    const project = id ? catalogs.find((c) => c.spaceId === sid)?.projectById.get(id) : undefined;
    // A project just made here is not in the catalogs yet; keep its id and only copy `billable` when it is known.
    patch({ spaceId: sid, project_id: id, ...(project ? { billable: project.billable } : {}) });
  };

  // Closing by clicking outside or tabbing away keeps a description typed for the running entry; Esc and the actions
  // below settle it themselves. Refs, because the last render's values are what the close sees.
  const settled = useRef(false);
  const latest = useRef({ text, current, patchRunning });
  latest.current = { text, current, patchRunning };
  useEffect(
    () => () => {
      const l = latest.current;
      if (!settled.current && l.current && l.text !== l.current.entry.description) l.patchRunning({ description: l.text });
    },
    [],
  );
  const escape = (): void => {
    settled.current = true;
    onEscape();
  };

  const done = (): void => {
    settled.current = true;
    onClose(true);
  };
  const primary = (): void => {
    if (current) {
      if (text !== current.entry.description && !patchRunning({ description: text })) return;
    } else startFromDraft(controller, spaceId, spaceDocs, setSpaceId);
    done();
  };
  const use = (row: Row): void => {
    const f = entryFields(row.entry);
    if (current) {
      const same = row.spaceId === current.spaceId;
      if (!patchRunning({ description: f.description, billable: f.billable, tags: f.tags, ...(same ? { project_id: f.project_id } : {}) })) return;
    } else {
      controller.continueFrom(row.spaceId, f);
      setDraft(EMPTY_DRAFT);
    }
    done();
  };

  const query = typed ? text.trim() : '';
  const list = candidates();
  const matches = useMemo(() => (query ? matchCandidates(query, list) : []), [query, list]);
  const rows: Row[] = query
    ? matches.map((c) => ({ key: `${c.spaceId}:${c.entry.id}`, spaceId: c.spaceId, entry: c.entry, continues: false }))
    : [...(recents.last ? [{ ...recents.last, continues: !current }] : []), ...recents.others.map((item) => ({ ...item, continues: false }))].map((r) => ({
        key: `${r.spaceId}:${r.entry.id}`,
        spaceId: r.spaceId,
        entry: r.entry,
        continues: r.continues,
        stoppedAt: r.stoppedAt,
      }));
  const at = active < rows.length ? active : -1;
  const optionId = (i: number): string => `${listId}-${i}`;
  useLayoutEffect(() => {
    if (at >= 0) document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);
  const now = Date.now();

  const onKeyDown = (e: KeyboardEvent): void => {
    const n = rows.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n > 0) setActive(e.key === 'ArrowDown' ? (at + 1) % n : (at <= 0 ? n : at) - 1);
    else if (e.key === 'Enter') {
      const row = at >= 0 ? rows[at] : undefined;
      if (row) use(row);
      else primary();
    } else {
      if (e.key === 'Escape') escape();
      return;
    }
    e.preventDefault();
  };

  return (
    <>
      <div class="tp-edit">
        {current && color && <Swatch color={color} />}
        <input
          ref={descRef}
          type="text"
          class="tp-input"
          role="combobox"
          aria-label="Description"
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={at >= 0 ? optionId(at) : undefined}
          placeholder="What are you working on?"
          autocomplete="off"
          enterKeyHint={current ? 'done' : 'go'}
          value={text}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setText(v);
            setTyped(true);
            setActive(-1);
            if (!current) setDraft((d) => ({ ...d, description: v }));
          }}
          onKeyDown={onKeyDown}
        />
        {current && <LiveClock since={startMs(current.entry)} />}
      </div>
      <Popover
        open
        id={id}
        anchor={anchor}
        panelRef={panelRef}
        onClose={() => onClose(false)}
        label="Timer details"
        class="tp-popover"
        onKeyDown={(e) => {
          // Esc inside a picker opened from here closes only that picker.
          if (e.key === 'Escape' && (e.target as Element).closest?.('.popover') === panelRef.current) escape();
        }}
      >
        <form
          class="tp-form"
          onSubmit={(e) => {
            e.preventDefault();
            primary();
          }}
        >
          {(rows.length > 0 || query) && (
            <p class="tp-heading" id={headingId}>
              {query ? 'Matching past work' : 'Recent'}
            </p>
          )}
          {/* Always in the page, so the input's aria-controls never points at nothing. */}
          <ul id={listId} class="tp-list" role="listbox" aria-labelledby={headingId} hidden={rows.length === 0}>
            {rows.map((row, i) => {
              const e = row.entry;
              const cat = catalogs.find((c) => c.spaceId === row.spaceId);
              const project = e.project_id ? cat?.projectById.get(e.project_id) : undefined;
              const client = project?.client_id ? cat?.clientById.get(project.client_id) : undefined;
              const meta = [
                project && (
                  <span key="p">
                    <Swatch color={project.color} /> {project.name}
                    {client ? ` (${client.name})` : ''}
                  </span>
                ),
                e.tags.length > 0 && <span key="t">{e.tags.join(', ')}</span>,
                multi && <span key="s">{spaceName(row.spaceId)}</span>,
                row.continues && row.stoppedAt !== undefined && <span key="a">stopped {relativeAgo(row.stoppedAt, now)}</span>,
              ].filter(Boolean);
              return (
                <li
                  key={row.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === at}
                  class={['tp-row', i === at && 'active', row.continues && 'tp-continue'].filter(Boolean).join(' ')}
                  // Keep focus (and a phone's keyboard) in the description; the click picks.
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => use(row)}
                >
                  <span class="tp-r-desc">
                    {row.continues && <span class="tp-continue-label">Continue: </span>}
                    {e.description || '(no description)'}
                  </span>
                  {meta.length > 0 && <span class="tp-r-meta">{meta.flatMap((part, k) => (k === 0 ? [part] : [' · ', part]))}</span>}
                </li>
              );
            })}
          </ul>
          {query && rows.length === 0 && <p class="tp-empty muted">Nothing earlier matches. Enter {current ? 'saves it as the description' : 'starts with it'}.</p>}
          {multi && !current && (
            <label class="tp-space">
              <span>Space</span>
              <select
                aria-label="Space for this entry"
                value={targetSpace}
                onChange={(e) => {
                  const sid = (e.target as HTMLSelectElement).value;
                  // A project belongs to one space: changing space drops it.
                  patch({
                    spaceId: sid,
                    project_id: sid === targetSpace ? draft.project_id : null,
                  });
                }}
              >
                {catalogs.map((c) => (
                  <option key={c.spaceId} value={c.spaceId}>
                    {spaceName(c.spaceId)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div class="tp-fields">
            <ProjectPicker spaces={offered} spaceId={targetSpace} projectId={value.project_id} onChange={setProject} />
            <TagPicker value={value.tags} known={space?.tagNames ?? []} onChange={(tags) => patch({ tags })} onCreate={(n) => (space ? ensureTag(space.doc, n) : n)} emptyText="Tags" />
            <button
              type="button"
              class={value.billable ? 'tp-billable on' : 'tp-billable'}
              aria-pressed={value.billable}
              title={value.billable ? 'Billable' : 'Not billable'}
              onClick={() => patch({ billable: !value.billable })}
            >
              <IconBillable />
              <span>Billable</span>
            </button>
          </div>
          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}
          <div class="tp-footer">
            <Button variant="primary" type="submit" class="tp-go">
              {current ? 'Update' : 'Start'}
            </Button>
          </div>
        </form>
      </Popover>
    </>
  );
}
