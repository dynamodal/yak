import { useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { effectiveHidden, useHiddenModules } from '../app/features';
import { parseHash } from '../app/router';
import { Button, Dialog, Popover, toast } from '../app/ui';
import { buildIndex, createNote } from './note-store';
import { EMPTY_FIELDS, mergeFields, parseLine, PRIORITIES, quickTask, without, type Fields, type TokenKind } from './quick-add';
import { taskHref } from './task-route';
import { localDate } from './tasks';
import './quick-add.css';

const LAST_KEY = 'quick-add-space';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The page's space, except on Tasks and Notes while they show every space: then the last one used here (same rule as #101). */
function startSpace(spaceId: string, spaceIds: readonly string[]): string {
  const page = parseHash(location.hash)[0] ?? '';
  const showingAll = (page === 'tasks' || page === 'notes') && spaceIds.length > 1 && read(`app-${page}-all-spaces`) === '1';
  const last = read(LAST_KEY);
  return showingAll && last && spaceIds.includes(last) ? last : spaceId;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayText(iso: string): string {
  const d = new Date(`${iso}T00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${DAYS[d.getDay()]} ${iso}`;
}

interface ChipProps {
  label: string;
  value: string;
  onClear(): void;
  children(close: () => void): preact.ComponentChildren;
}

/** A chip: its label (and value when set) opens a picker; ✕ clears it. */
function Chip({ label, value, onClear, children }: ChipProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <span class={`qa-chip${value ? ' set' : ''}`}>
      <button type="button" ref={anchor} class="qa-chip-main" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="qa-chip-label">{label}</span>
        {value && <span class="qa-chip-value">{value}</span>}
      </button>
      {value && (
        <button type="button" class="qa-chip-clear" aria-label={`Clear ${label.toLowerCase()}`} title={`Clear ${label.toLowerCase()}`} onClick={onClear}>
          ✕
        </button>
      )}
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={`Pick ${label.toLowerCase()}`} class="qa-popover">
        {children(() => setOpen(false))}
      </Popover>
    </span>
  );
}

function DatePicker({ label, value, onPick, close }: { label: string; value: string; onPick(v: string): void; close(): void }) {
  const day = (offset: number): string => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + offset));
  const set = (v: string): void => {
    onPick(v);
    close();
  };
  return (
    <div class="qa-pick">
      <input type="date" aria-label={label} value={value} autoFocus onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), close())} onChange={(e) => (e.target as HTMLInputElement).value && set((e.target as HTMLInputElement).value)} />
      <div class="row">
        <Button onClick={() => set(day(0))}>Today</Button>
        <Button onClick={() => set(day(1))}>Tomorrow</Button>
        <Button onClick={() => set(day(7))}>In a week</Button>
      </div>
    </div>
  );
}

function ListPicker({ label, values, suggestions, onChange, close }: { label: string; values: readonly string[]; suggestions: readonly string[]; onChange(v: string[]): void; close(): void }) {
  const [text, setText] = useState('');
  const id = useMemo(() => `qa-list-${label.toLowerCase()}`, [label]);
  const add = (): void => {
    const v = text.trim().replace(/^[#@+]/, '');
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setText('');
  };
  return (
    <div class="qa-pick">
      <input
        aria-label={`Add ${label.toLowerCase()}`}
        list={id}
        value={text}
        placeholder={`Add ${label.toLowerCase()}…`}
        autoFocus
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.stopPropagation();
          if (text.trim()) add();
          else close();
        }}
      />
      <datalist id={id}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div class="row">
        {values.map((v) => (
          <Button key={v} variant="quiet" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            {v} ✕
          </Button>
        ))}
      </div>
      <Button onClick={() => (text.trim() ? add() : close())}>{text.trim() ? 'Add' : 'Done'}</Button>
    </div>
  );
}

export function QuickAddDialog({ onClose }: { onClose(): void }) {
  const app = useApp();
  const { spaces, spaceDocs, doc, spaceId, setSpaceId } = app;
  const notesHidden = effectiveHidden(useHiddenModules()).has('notes');
  const [line, setLine] = useState('');
  const [picked, setPicked] = useState<Partial<Fields>>({});
  const [sid, setSid] = useState(() => startSpace(spaceId, spaces.map((s) => s.id)));
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseLine(line, new Date()), [line]);
  const fields = mergeFields(parsed.tokens, picked);
  const docOf = spaceDocs.get(sid) ?? doc;
  const index = useMemo(() => buildIndex(docOf), [docOf]);
  const suggest = useMemo(() => {
    const set = (get: (n: (typeof index.notes)[number]) => unknown): string[] => {
      const out = new Map<string, string>();
      for (const n of index.notes) for (const v of [get(n)].flat()) if (typeof v === 'string' && v.trim()) out.set(v.trim().toLowerCase(), v.trim());
      return [...out.values()].sort((a, b) => a.localeCompare(b));
    };
    return {
      projects: set((n) => n.parsed.properties.projects).map((p) => p.replace(/^!?\[\[([^\]|#]*).*$/, '$1')),
      contexts: set((n) => n.parsed.properties.contexts),
      tags: set((n) => n.tags).filter((t) => t.toLowerCase() !== 'task'),
    };
  }, [index]);

  /** Clear a field: the tokens of that kind leave the line, and the picked value goes. */
  const clear = (kind: TokenKind, key: keyof Fields): void => {
    setLine(without(line, parsed.tokens.filter((t) => t.kind === kind)));
    setPicked({ ...picked, [key]: Array.isArray(EMPTY_FIELDS[key]) ? [] : '' });
  };
  const pick = <K extends keyof Fields>(key: K, value: Fields[K], kind?: TokenKind): void => {
    // A list is edited as a whole, so what the line said joins it and leaves the line.
    if (kind) setLine(without(line, parsed.tokens.filter((t) => t.kind === kind)));
    setPicked({ ...picked, [key]: value });
  };

  const save = (andOpen: boolean): void => {
    if (!parsed.title) {
      setError('Type a title for the task.');
      return;
    }
    const target = spaceDocs.get(sid) ?? doc;
    const { path, text } = quickTask(parsed.title, fields, buildIndex(target).notes.map((n) => n.path), new Date());
    const id = createNote(target, path, text);
    try {
      localStorage.setItem(LAST_KEY, sid);
    } catch {
      // ignore
    }
    const open = (): void => {
      if (sid !== spaceId) setSpaceId(sid);
      location.hash = taskHref(id, notesHidden);
    };
    onClose();
    if (andOpen) open();
    else toast('Task added', { action: { label: 'Open', run: open } });
  };

  return (
    <Dialog label="New task" class="qa" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <h2 class="qa-title">New task</h2>
        <input
          class="qa-line"
          aria-label="Task title"
          aria-describedby="qa-help"
          placeholder="Call Bob tomorrow +Acme @phone #client !high"
          value={line}
          autoFocus
          onInput={(e) => {
            setLine((e.target as HTMLInputElement).value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            save(e.shiftKey);
          }}
        />
        <p id="qa-help" class="hint">
          Dates (tomorrow, fri, next week, 2026-11-02), +project, @context, #tag and !high fill the chips below. Enter adds, Shift+Enter adds and opens, Esc cancels.
        </p>
        <p class="error" role="alert">
          {error}
        </p>
        <div class="qa-chips" role="group" aria-label="Task fields">
          <Chip label="Due" value={fields.due && dayText(fields.due)} onClear={() => clear('due', 'due')}>
            {(close) => <DatePicker label="Due date" value={fields.due} onPick={(v) => pick('due', v, 'due')} close={close} />}
          </Chip>
          <Chip label="Scheduled" value={fields.scheduled && dayText(fields.scheduled)} onClear={() => clear('scheduled', 'scheduled')}>
            {(close) => <DatePicker label="Scheduled date" value={fields.scheduled} onPick={(v) => pick('scheduled', v, 'scheduled')} close={close} />}
          </Chip>
          <Chip label="Project" value={fields.projects.join(', ')} onClear={() => clear('project', 'projects')}>
            {(close) => <ListPicker label="Project" values={fields.projects} suggestions={suggest.projects} onChange={(v) => pick('projects', v, 'project')} close={close} />}
          </Chip>
          <Chip label="Tags" value={fields.tags.map((t) => `#${t}`).join(' ')} onClear={() => clear('tag', 'tags')}>
            {(close) => <ListPicker label="Tags" values={fields.tags} suggestions={suggest.tags} onChange={(v) => pick('tags', v, 'tag')} close={close} />}
          </Chip>
          <Chip label="Contexts" value={fields.contexts.map((c) => `@${c}`).join(' ')} onClear={() => clear('context', 'contexts')}>
            {(close) => <ListPicker label="Contexts" values={fields.contexts} suggestions={suggest.contexts} onChange={(v) => pick('contexts', v, 'context')} close={close} />}
          </Chip>
          <span class={`qa-chip${fields.priority ? ' set' : ''}`}>
            <select aria-label="Priority" value={fields.priority} onChange={(e) => pick('priority', (e.target as HTMLSelectElement).value, 'priority')}>
              <option value="">Priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {`Priority: ${p}`}
                </option>
              ))}
            </select>
            {fields.priority && (
              <button type="button" class="qa-chip-clear" aria-label="Clear priority" title="Clear priority" onClick={() => clear('priority', 'priority')}>
                ✕
              </button>
            )}
          </span>
          {spaces.length > 1 && (
            <span class="qa-chip set">
              <select aria-label="Space" value={sid} onChange={(e) => setSid((e.target as HTMLSelectElement).value)}>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {`Space: ${s.name}`}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
        <div class="row qa-actions">
          <Button type="submit" variant="primary">
            Add task
          </Button>
          <Button onClick={() => save(true)}>Add and open</Button>
        </div>
      </form>
    </Dialog>
  );
}
