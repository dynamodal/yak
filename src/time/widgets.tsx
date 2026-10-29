import type { RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useNow } from '../app/hooks';
import type { ClientRecord, ProjectRecord } from './catalog';
import { type EntryRecord, isRunning } from './entries';
import { type Candidate, matchCandidates } from './fuzzy';
import { useCandidates, useCatalogs, useSpaceName } from './hooks';
import { formatClock, formatHours, type HoursFormat } from './format';
import { totalSeconds } from './stats';

/** Colour swatch for a project; colour is validated before it reaches the style. */
export function Swatch({ color }: { color: string | undefined }) {
  const safe = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'transparent';
  return <span class="swatch" style={{ background: safe }} aria-hidden="true" />;
}

export function ProjectChip({ project, client }: { project: ProjectRecord | undefined; client: ClientRecord | undefined }) {
  if (!project) return null;
  return (
    <span class="project-chip" title={client ? `${project.name} (${client.name})` : project.name}>
      <Swatch color={project.color} />
      <span>{project.name}</span>
      {client && <span class="muted">{client.name}</span>}
    </span>
  );
}

export interface DescriptionFieldProps {
  value: string;
  placeholder?: string;
  /** Every keystroke. */
  onText?(text: string): void;
  /** Blur or Enter. */
  onCommit?(text: string): void;
  /** A suggestion (past work) was picked; the field already shows its description. */
  onPick?(entry: EntryRecord): void;
  onEnter?(text: string): void;
  /** Keys the list did not use (the list is closed or the key is not one of its own). */
  onKeyDown?(e: KeyboardEvent): void;
  label?: string;
  class?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * The description input with a combobox of past work under it (#60): fuzzy-matched on description and project, one row per
 * description + project, each with project and tags. ArrowDown/ArrowUp move, Enter picks, Esc closes (and is not passed on while
 * the list is open); Tab or blur leaves the typed text alone. Focus stays in the input; the list is announced through
 * `aria-activedescendant` and a polite count.
 */
export function DescriptionField({ value, placeholder, onText, onCommit, onPick, onEnter, onKeyDown, label = 'Description', class: cls = 'description', inputRef }: DescriptionFieldProps) {
  // Uncontrolled on purpose: the browser owns what is being typed, and the prop only replaces it
  // when it changes while the field is not being edited (another device, continue, stop).
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const id = useId();
  const catalogs = useCatalogs();
  const spaceName = useSpaceName();
  const candidates = useCandidates();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const input = ref.current;
    if (input && input.value !== value && document.activeElement !== input) input.value = value;
  }, [value, ref]);
  const hits = useMemo(() => (open && query.trim() ? matchCandidates(query, candidates()) : []), [open, query, candidates]);
  const shown = hits.length > 0;
  // The list floats (position: fixed under the input) so it neither scrolls nor clips inside a popover and never moves the controls below, which would swallow a click on them.
  const [place, setPlace] = useState<{ top: number; left: number; width: number; max: number }>();
  useLayoutEffect(() => {
    const input = ref.current;
    if (!shown || !input) return;
    const at = (): void => {
      const r = input.getBoundingClientRect();
      setPlace({ top: r.bottom + 4, left: r.left, width: r.width, max: Math.max(96, Math.min(208, window.innerHeight - r.bottom - 12)) });
    };
    at();
    window.addEventListener('scroll', at, true);
    window.addEventListener('resize', at);
    return () => {
      window.removeEventListener('scroll', at, true);
      window.removeEventListener('resize', at);
    };
  }, [shown, ref]);
  const pick = (c: Candidate): void => {
    if (ref.current) ref.current.value = c.entry.description;
    onText?.(c.entry.description);
    setOpen(false);
    setActive(-1);
    onPick?.(c.entry);
  };
  return (
    <div class="combo">
      <input
        ref={ref}
        type="text"
        class={cls}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        placeholder={placeholder ?? 'What are you working on?'}
        autocomplete="off"
        defaultValue={value}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          onText?.(v);
          setQuery(v);
          setActive(-1);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => onCommit?.((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          const n = hits.length;
          if (shown && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a <= 0 ? n : a) - 1));
          else if (shown && active >= 0 && e.key === 'Enter') pick(hits[active]!);
          else if (shown && e.key === 'Escape') setOpen(false);
          else if (e.key === 'Enter') {
            setOpen(false);
            const v = (e.target as HTMLInputElement).value;
            if (onEnter) onEnter(v);
            else onCommit?.(v);
            return onKeyDown?.(e);
          } else return onKeyDown?.(e);
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <ul id={`${id}-list`} class="combo-list" role="listbox" aria-label="Suggested past work" hidden={!shown} style={place ? { top: `${place.top}px`, left: `${place.left}px`, width: `${place.width}px`, maxHeight: `${place.max}px` } : undefined}>
        {hits.map((c, i) => {
          const e = c.entry;
          const cat = catalogs.find((k) => k.spaceId === c.spaceId);
          const project = e.project_id ? cat?.projectById.get(e.project_id) : undefined;
          const client = project?.client_id ? cat?.clientById.get(project.client_id) : undefined;
          return (
            <li key={`${c.spaceId}:${e.id}`} id={`${id}-${i}`} role="option" aria-selected={i === active} class={i === active ? 'combo-opt active' : 'combo-opt'} onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(c)}>
              <span class="tp-r-desc">{e.description}</span>
              {project && (
                <span class="tp-r-meta">
                  · <Swatch color={project.color} /> {project.name}
                  {client ? ` (${client.name})` : ''}
                </span>
              )}
              {e.tags.length > 0 && <span class="tp-r-meta">· {e.tags.join(', ')}</span>}
              {catalogs.length > 1 && <span class="tp-r-meta">· {spaceName(c.spaceId)}</span>}
            </li>
          );
        })}
      </ul>
      <span class="visually-hidden" role="status">
        {shown ? `${hits.length} suggestion${hits.length === 1 ? '' : 's'}` : ''}
      </span>
    </div>
  );
}

/** The running timer's clock; the only thing that re-renders every second. */
export function LiveClock({ since }: { since: number }) {
  const now = useNow(1000);
  return <time class="clock">{formatClock((now - since) / 1000)}</time>;
}

/** A total over entries; ticks while any is running. */
export function Total({ entries, format }: { entries: readonly EntryRecord[]; format: HoursFormat }) {
  const running = entries.some(isRunning);
  const now = useNow(running ? 1000 : 3_600_000);
  return <span class="total">{formatHours(totalSeconds(entries, now), format)}</span>;
}

