import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { allCommands, formatShortcut, shortcutsOf } from '../app/commands';
import { effectiveHidden, useHiddenModules } from '../app/features';
import { useYVersion } from '../app/hooks';
import { IconPlay, IconStop } from '../app/ui';
import { useOverrides } from '../app/views/CommandHost';
import { collection } from '../core/schema';
import { startMs } from './entries';
import { useController, useRunning } from './hooks';
import { onTimerPopoverRequest } from './pill-events';
import { startFromDraft } from './timer-start';
import { TimerPopover } from './TimerPopover';
import { LiveClock, Swatch } from './widgets';

function useProjectColor(doc: Y.Doc | undefined, projectId: string | null | undefined): string | undefined {
  const projects = doc ? collection(doc, 'projects') : undefined;
  useYVersion(projects as Y.AbstractType<unknown> | undefined);
  if (!projects || !projectId) return undefined;
  const p = projects.get(projectId);
  return p && p.get('deleted') !== true ? (p.get('color') as string | undefined) : undefined;
}

/** What a screen reader hears when a timer starts or stops here (local actions only: the controller emits on the bus). */
function useAnnouncement(): string {
  const { bus, privateDocs } = useApp();
  const [text, setText] = useState('');
  useEffect(() => {
    const offStart = bus.on('timer:started', (e) => {
      const doc = privateDocs.get(e.spaceId);
      const description = doc ? (collection(doc, 'time_entries').get(e.entryId)?.get('description') as string | undefined) : undefined;
      setText(description ? `Timer started: ${description}` : 'Timer started');
    });
    const offStop = bus.on('timer:stopped', () => setText('Timer stopped'));
    return () => {
      offStart();
      offStop();
    };
  }, [bus, privateDocs]);
  return text;
}

/**
 * The timer pill in the app header, on every page while the Time feature is on (F-33j). Idle: "Start" with the shortcut
 * and a round play button. Running: project colour, description, elapsed time and a round stop button. Two hit areas:
 * the round button starts or stops at once and never opens anything; the label opens the details popover. Alt+S starts
 * the timer and opens the popover with focus in the description (`pill-events.ts`); when it stops the timer it opens nothing.
 */
export function HeaderTimer() {
  const hidden = effectiveHidden(useHiddenModules()).has('time');
  return hidden ? null : <Pill />;
}

function Pill() {
  const { spaceDocs, spaceId, setSpaceId } = useApp();
  const controller = useController();
  const running = useRunning();
  const current = running[running.length - 1];
  const color = useProjectColor(current ? spaceDocs.get(current.spaceId) : undefined, current?.entry.project_id);
  const overrides = useOverrides();
  const command = allCommands().find((c) => c.id === 'timer.toggle');
  const keys = command ? shortcutsOf(command, overrides)[0] : undefined;
  const [open, setOpen] = useState(false);
  const labelRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const escaped = useRef(false);
  const popoverId = useId();
  const announcement = useAnnouncement();

  // Alt+S: the command has started the timer; open the details with focus in the description.
  useEffect(
    () =>
      onTimerPopoverRequest((req) => {
        returnTo.current = req.returnTo;
        setOpen(true);
      }),
    [],
  );
  // The timer stopped (from anywhere) while the details of the running entry were open: nothing is left to edit.
  const hadCurrent = useRef(false);
  useEffect(() => {
    if (hadCurrent.current && !current) setOpen(false);
    hadCurrent.current = !!current;
  }, [current?.id]);

  const close = (): void => {
    setOpen(false);
    const back = returnTo.current;
    returnTo.current = null;
    // Escape returns focus to where Alt+S was pressed (the popover itself focuses the label first, so wait a tick).
    if (escaped.current && back && back.isConnected) setTimeout(() => back.focus(), 0);
    escaped.current = false;
  };

  const text = current ? current.entry.description || '(no description)' : '';
  const shortcutName = keys ? ` (${formatShortcut(keys)})` : '';
  return (
    <div class={current ? 'timer-pill running' : 'timer-pill'} role="group" aria-label="Timer">
      <button
        type="button"
        ref={labelRef}
        class="tp-label"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={current ? undefined : 'Start, timer details'}
        title={current ? `${text}: timer details` : 'Timer details'}
        onClick={() => {
          returnTo.current = null;
          setOpen(!open);
        }}
      >
        {current ? (
          <>
            {color && <Swatch color={color} />}
            <span class="tp-desc">{text}</span>
            <LiveClock since={startMs(current.entry)} />
          </>
        ) : (
          <>
            <span class="tp-start-text">Start</span>
            {keys && (
              <kbd class="tp-chip" aria-hidden="true">
                {formatShortcut(keys)}
              </kbd>
            )}
          </>
        )}
      </button>
      <button
        type="button"
        class="tp-round"
        aria-label={current ? 'Stop timer' : 'Start timer'}
        aria-keyshortcuts={keys}
        title={`${current ? 'Stop timer' : 'Start timer'}${shortcutName}`}
        onClick={() => {
          if (current) controller.stop(current);
          else startFromDraft(controller, spaceId, spaceDocs, setSpaceId);
        }}
      >
        {current ? <IconStop /> : <IconPlay />}
      </button>
      <span class="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
      {open && <TimerPopover id={popoverId} anchor={labelRef} current={current} onClose={close} onEscape={() => (escaped.current = true)} />}
    </div>
  );
}
