import { useRef, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { Popover } from '../app/ui';
import { useYVersion } from '../app/hooks';
import { navigate } from '../app/router';
import { collection } from '../core/schema';
import { entryFields, startMs } from './entries';
import { useCatalogs, useController, useLastStopped, useRecentEntries, useRunning, useSpaceName } from './hooks';
import { LiveClock, Swatch } from './widgets';
import { EMPTY_DRAFT, getDraft, setDraft } from './timer-draft';

// Our own glyphs, drawn on a 16-unit grid; move to the shared icon module when it exists.
function PlayIcon() {
  return (
    <svg class="ht-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg class="ht-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function useProjectColor(doc: Y.Doc | undefined, projectId: string | null | undefined): string | undefined {
  const projects = doc ? collection(doc, 'projects') : undefined;
  useYVersion(projects as Y.AbstractType<unknown> | undefined);
  if (!projects || !projectId) return undefined;
  const p = projects.get(projectId);
  return p && p.get('deleted') !== true ? (p.get('color') as string | undefined) : undefined;
}

const RECENT = 6;
const PROJECTS = 6;

/**
 * Opened from the status area: switch to a recent entry, start on a project, or start empty. Starting
 * stops whatever runs (one running timer across spaces). The Time page is one click away.
 */
function Switcher({ anchor, onClose }: { anchor: { current: HTMLElement | null }; onClose(): void }) {
  const { spaces, setSpaceId, spaceId } = useApp();
  const controller = useController();
  const recent = useRecentEntries(RECENT);
  const catalogs = useCatalogs();
  const spaceName = useSpaceName();
  const label = (id: string | undefined): string | null => (id && spaces.length > 1 ? spaceName(id) : null);
  const projects = catalogs.flatMap((c) => c.projects.filter((p) => p.active !== false).map((p) => ({ p, c }))).slice(0, PROJECTS);
  const run = (sid: string, fields: Parameters<typeof controller.start>[1]): void => {
    controller.start(sid, fields);
    setSpaceId(sid);
    onClose();
  };
  return (
    <Popover open anchor={anchor} onClose={onClose} label="Switch timer" class="ht-switcher">
      <button type="button" class="ht-opt ht-new" onClick={() => run(spaceId, {})}>
        Start a new timer
      </button>
      {recent.length > 0 && <p class="picker-heading">Recent</p>}
      {recent.map((e) => (
        <button key={e.id} type="button" class="ht-opt" onClick={() => run(e.spaceId as string, entryFields(e))}>
          <span class="ht-text">{e.description || '(no description)'}</span>
          {label(e.spaceId) && <span class="picker-space">{label(e.spaceId)}</span>}
        </button>
      ))}
      {projects.length > 0 && <p class="picker-heading">Projects</p>}
      {projects.map(({ p, c }) => (
        <button key={`${c.spaceId}:${p.id}`} type="button" class="ht-opt" onClick={() => run(c.spaceId, { project_id: p.id, billable: p.billable })}>
          <Swatch color={p.color} />
          <span class="ht-text">{p.name}</span>
          {label(c.spaceId) && <span class="picker-space">{label(c.spaceId)}</span>}
        </button>
      ))}
      <button
        type="button"
        class="ht-opt ht-open"
        onClick={() => {
          onClose();
          navigate('time');
        }}
      >
        Open the Time page
      </button>
    </Popover>
  );
}

/**
 * The running timer in the app header, on every view: description, project colour and elapsed
 * time with a stop button; when nothing runs, start and "Continue" the last entry. Clicking the
 * status area (the running entry, or "Not tracking") opens the switcher. The rule of one running
 * timer across spaces lives in the controller, as on the Time page.
 */
export function HeaderTimer() {
  const { spaceDocs, spaceId } = useApp();
  const controller = useController();
  const running = useRunning();
  const last = useLastStopped();
  const current = running[running.length - 1];
  const shown = current ?? last;
  const color = useProjectColor(shown ? spaceDocs.get(shown.spaceId) : undefined, shown?.entry.project_id);
  const [open, setOpen] = useState(false);
  const statusRef = useRef<HTMLButtonElement>(null);
  const toggle = (): void => setOpen(!open);
  /** Starts with what is typed in the Time page's bar (description, project, tags), then clears it, as the bar's own start does. */
  const startTyped = (): void => {
    const d = getDraft();
    const sid = d.project_id && d.spaceId ? d.spaceId : spaceId;
    controller.start(sid, { description: d.description, project_id: d.project_id, tags: d.tags, billable: d.billable });
    setDraft(EMPTY_DRAFT);
  };

  if (current) {
    const text = current.entry.description || '(no description)';
    return (
      <div class="header-timer running" role="group" aria-label="Running timer">
        <button type="button" ref={statusRef} class="ht-desc" aria-haspopup="dialog" aria-expanded={open} onClick={toggle} title={`${text}: switch timer`}>
          {color && <Swatch color={color} />}
          <span class="ht-text">{text}</span>
        </button>
        <LiveClock since={startMs(current.entry)} />
        <button type="button" class="ht-btn ht-stop" aria-label="Stop timer" title="Stop timer" onClick={() => controller.stop(current)}>
          <StopIcon />
        </button>
        {open && <Switcher anchor={statusRef} onClose={() => setOpen(false)} />}
      </div>
    );
  }

  const lastText = last ? last.entry.description || '(no description)' : '';
  return (
    <div class="header-timer" role="group" aria-label="Timer stopped">
      <button type="button" class="ht-btn ht-start" aria-label="Start timer" title="Start a new timer" onClick={startTyped}>
        <PlayIcon />
      </button>
      <button type="button" ref={statusRef} class="ht-desc ht-status" aria-haspopup="dialog" aria-expanded={open} onClick={toggle} title="Switch timer">
        <span class="ht-idle muted">Not tracking</span>
      </button>
      {last && (
        <button
          type="button"
          class="ht-btn ht-continue"
          aria-label={`Continue: ${lastText}`}
          title={`Continue “${lastText}”`}
          onClick={() => controller.continueFrom(last.spaceId, entryFields(last.entry))}
        >
          <PlayIcon />
          <span class="ht-continue-label">Continue:</span>
          {color && <Swatch color={color} />}
          <span class="ht-text">{lastText}</span>
        </button>
      )}
      {open && <Switcher anchor={statusRef} onClose={() => setOpen(false)} />}
    </div>
  );
}
