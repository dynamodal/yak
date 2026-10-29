import type { RefObject } from 'preact';
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, IconBillable, Popover } from '../app/ui';
import { ensureTag } from './catalog';
import { editEntry, entryFields, type RunningRef } from './entries';
import { type SpaceCatalog, useCatalogs, useController, useRecents, useSpaceName } from './hooks';
import { ProjectPicker, TagPicker } from './pickers';
import { type RecentItem, relativeAgo } from './recents';
import { EMPTY_DRAFT, type Draft, setDraft, useDraft } from './timer-draft';
import { startFromDraft, timerSpace } from './timer-start';
import { Swatch } from './widgets';

type Fields = Pick<Draft, 'description' | 'project_id' | 'tags' | 'billable'>;

export interface TimerPopoverProps {
  id?: string;
  anchor: RefObject<HTMLElement | null>;
  /** The running entry, when there is one: the popover then edits it ("Update") instead of the draft ("Start"). */
  current: RunningRef | undefined;
  onClose(): void;
  /** Called on Escape, before `onClose`, so the pill can send focus back to where it was. */
  onEscape(): void;
}

/**
 * The pill's details: a description, the recent work to pick from, project, tags and billable. Stopped, it edits the shared
 * draft (so half a description survives navigation, H-21) and Start begins a timer with it; running, it edits the running
 * entry. Enter starts or updates; Esc closes (the Popover does that). Deleting an entry is done from the entries list.
 */
export function TimerPopover({ id, anchor, current, onClose, onEscape }: TimerPopoverProps) {
  const { spaceId, setSpaceId, spaceDocs, privateDocs } = useApp();
  const controller = useController();
  const catalogs = useCatalogs();
  const spaceName = useSpaceName();
  const draft = useDraft();
  const recents = useRecents(current);
  const [error, setError] = useState('');
  const [text, setText] = useState(() => (current ? current.entry.description : draft.description));
  const descRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingId = useId();
  const multi = catalogs.length > 1;

  // Focus starts in the description, with the caret at the end, whether it opened by click or by Alt+S.
  useLayoutEffect(() => {
    const input = descRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

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

  const done = (): void => {
    onClose();
    anchor.current?.focus();
  };
  const primary = (): void => {
    if (current) {
      if (text !== current.entry.description && !patchRunning({ description: text })) return;
      done();
    } else {
      startFromDraft(controller, spaceId, spaceDocs, setSpaceId);
      done();
    }
  };
  const pick = (item: RecentItem): void => {
    const f = entryFields(item.entry);
    if (current) {
      const same = item.spaceId === current.spaceId;
      const ok = patchRunning({ description: f.description, billable: f.billable, tags: f.tags, ...(same ? { project_id: f.project_id } : {}) });
      if (!ok) return;
      setText(f.description);
    } else {
      controller.continueFrom(item.spaceId, f);
      setDraft(EMPTY_DRAFT);
    }
    done();
  };

  const rows: { item: RecentItem; continues: boolean }[] = [
    ...(recents.last ? [{ item: recents.last, continues: !current }] : []),
    ...recents.others.map((item) => ({ item, continues: false })),
  ];
  const now = Date.now();
  const moveInList = (e: KeyboardEvent): void => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.tp-recent-row') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' && at < buttons.length - 1) buttons[at + 1]?.focus();
    else if (e.key === 'ArrowUp') (at > 0 ? buttons[at - 1] : descRef.current)?.focus();
    else if (e.key === 'Home') buttons[0]?.focus();
    else if (e.key === 'End') buttons[buttons.length - 1]?.focus();
    else return;
    e.preventDefault();
  };

  return (
    <Popover
      open
      id={id}
      anchor={anchor}
      onClose={onClose}
      label="Timer details"
      class="tp-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onEscape();
      }}
    >
      <form
        class="tp-form"
        onSubmit={(e) => {
          e.preventDefault();
          primary();
        }}
      >
        <input
          ref={descRef}
          type="text"
          class="tp-description"
          aria-label="Description"
          placeholder="What are you working on?"
          autocomplete="off"
          value={text}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setText(v);
            if (!current) setDraft((d) => ({ ...d, description: v }));
          }}
          onChange={(e) => {
            if (current) patchRunning({ description: (e.target as HTMLInputElement).value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && rows.length > 0) {
              e.preventDefault();
              listRef.current?.querySelector<HTMLButtonElement>('button.tp-recent-row')?.focus();
            }
          }}
        />
        {rows.length > 0 && (
          <>
            <p class="tp-heading" id={headingId}>
              Recent
            </p>
            <ul class="tp-recent" aria-labelledby={headingId} ref={listRef} onKeyDown={moveInList}>
              {rows.map(({ item, continues }) => {
                const e = item.entry;
                const project = e.project_id ? catalogs.find((c) => c.spaceId === item.spaceId)?.projectById.get(e.project_id) : undefined;
                return (
                  <li key={`${item.spaceId}:${e.id}`}>
                    <button type="button" class={continues ? 'tp-recent-row tp-continue' : 'tp-recent-row'} onClick={() => pick(item)}>
                      {continues && <span class="tp-continue-label">Continue:</span>}
                      <span class="tp-r-desc">{e.description || '(no description)'}</span>
                      {project && (
                        <span class="tp-r-meta">
                          · <Swatch color={project.color} /> {project.name}
                        </span>
                      )}
                      {e.tags.length > 0 && <span class="tp-r-meta">· {e.tags.join(', ')}</span>}
                      {multi && <span class="tp-r-meta">· {spaceName(item.spaceId)}</span>}
                      {continues && <span class="tp-r-meta">· stopped {relativeAgo(item.stoppedAt, now)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {multi && !current && (
          <label class="tp-space">
            <span>Space</span>
            <select
              aria-label="Space for this entry"
              value={targetSpace}
              onChange={(e) => {
                const sid = (e.target as HTMLSelectElement).value;
                // A project belongs to one space: changing space drops it.
                patch({ spaceId: sid, project_id: sid === targetSpace ? draft.project_id : null });
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
          <ProjectPicker spaces={offered} spaceId={targetSpace} projectId={value.project_id} onChange={setProject} showSpace={multi} />
          <TagPicker value={value.tags} known={space?.tagNames ?? []} onChange={(tags) => patch({ tags })} onCreate={(n) => (space ? ensureTag(space.doc, n) : n)} />
          <button type="button" class={value.billable ? 'tp-billable on' : 'tp-billable'} aria-pressed={value.billable} title={value.billable ? 'Billable' : 'Not billable'} onClick={() => patch({ billable: !value.billable })}>
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
  );
}
