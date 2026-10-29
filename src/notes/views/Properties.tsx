import { useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { Button, IconButton, IconChevronDown, IconChevronRight, IconClose, IconPlus } from '../../app/ui';
import { STORAGE_PREFIX } from '../../constants';
import { formatValue, parseInput } from '../frontmatter';
import { setNoteProperty, type NoteInfo } from '../note-store';
import { DATE_PROPERTIES, formatDateValue, parseDateValue, type PropertyChoices } from '../property-choices';
import { CommitInput } from './common';

/**
 * How the YAML front matter shows in a note, per device, as Obsidian's "Properties in document":
 * a table above the text (visible), nowhere (hidden), or as YAML in the text (source).
 */
export type PropertiesDisplay = 'visible' | 'hidden' | 'source';

const DISPLAY_KEY = `${STORAGE_PREFIX}-notes-properties`;
const OPEN_KEY = `${STORAGE_PREFIX}-notes-properties-open`;

export function readDisplay(): PropertiesDisplay {
  try {
    const v = localStorage.getItem(DISPLAY_KEY);
    return v === 'hidden' || v === 'source' ? v : 'visible';
  } catch {
    return 'visible';
  }
}

export function writeDisplay(v: PropertiesDisplay): void {
  try {
    localStorage.setItem(DISPLAY_KEY, v);
  } catch {
    // device-only preference; ignore
  }
}

/** Open unless chosen otherwise on this device; on a phone the table starts closed so the text comes first. */
function readOpen(): boolean {
  try {
    const saved = localStorage.getItem(OPEN_KEY);
    if (saved !== null) return saved !== 'false';
  } catch {
    // fall through to the default
  }
  return !(typeof matchMedia === 'function' && matchMedia('(max-width: 48rem)').matches);
}

/** Properties that are lists, as Obsidian and TaskNotes use them; a new one starts as an empty list. */
const LIST_PROPERTIES = new Set(['tags', 'aliases', 'cssclasses', 'projects', 'contexts']);
const LINK = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

export interface PropertiesProps {
  doc: Y.Doc;
  note: NoteInfo;
  /** Tags already used in the space, offered when adding a tag. */
  tagSuggestions: readonly string[];
  /** Usual and already used values for status, priority, projects and contexts. */
  choices: PropertyChoices;
  onOpenLink(target: string): void;
  onTag(tag: string): void;
}

/** Front matter as a compact table. Each change rewrites only that property's lines in the text. */
export function Properties({ doc, note, tagSuggestions, choices, onOpenLink, onTag }: PropertiesProps) {
  const [open, setOpen] = useState(readOpen);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const { properties, error: yamlError } = note.parsed;
  const entries = Object.entries(properties);
  // The tag selector is always there; the `tags:` line is written when the first tag is picked and
  // removed with the last one. A `tags` value that is not a list is edited like any other property.
  const tagsValue = properties.tags;
  const tagsRow = tagsValue === undefined || Array.isArray(tagsValue);
  const tagItems = Array.isArray(tagsValue) ? tagsValue : [];
  const others = entries.filter(([key]) => !(tagsRow && key === 'tags'));

  const set = (key: string, value: unknown): void => {
    setError(setNoteProperty(doc, note.id, key, value) ? '' : 'The front matter is not valid YAML; switch to Source to fix it.');
  };
  const toggle = (): void => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, String(!open));
    } catch {
      // ignore
    }
  };
  const addKey = (): void => {
    const key = newKey.trim();
    if (!key) {
      setAdding(false);
      return;
    }
    if (/[:#\n]/.test(key) || key.startsWith('-')) {
      setError('Property names cannot contain : or # or start with -');
      return;
    }
    if (!(key in properties)) set(key, LIST_PROPERTIES.has(key.toLowerCase()) ? [] : '');
    setNewKey('');
    setAdding(false);
  };

  return (
    <section class="props" aria-label="Properties">
      <button type="button" class="props-head" aria-expanded={open} onClick={toggle}>
        {open ? <IconChevronDown /> : <IconChevronRight />}
        <span>Properties</span>
        {!open && entries.length > 0 && <span class="count">{entries.length}</span>}
      </button>
      {open && yamlError && <p class="error">The front matter is not valid YAML ({yamlError}). Switch to Source in the note's menu to fix it.</p>}
      {open && !yamlError && (
        <div class="props-table" role="group" aria-label="Properties">
          {tagsRow && (
            <div class="prop-row">
              <span class="prop-key" title="tags">
                tags
              </span>
              <div class="prop-value">
                <ListValue
                  name="tags"
                  items={tagItems}
                  suggestions={tagSuggestions}
                  onChange={(v) => set('tags', Array.isArray(v) && v.length > 0 ? v : undefined)}
                  onOpenLink={onOpenLink}
                  onTag={onTag}
                />
              </div>
              {tagsValue !== undefined ? (
                <IconButton class="prop-remove" icon={<IconClose />} label="Remove property tags" title="Remove property" onClick={() => set('tags', undefined)} />
              ) : (
                <span />
              )}
            </div>
          )}
          {others.map(([key, value]) => (
            <div class="prop-row" key={key}>
              <span class="prop-key" title={key}>
                {key}
              </span>
              <div class="prop-value">
                <PropValue name={key} value={value} choices={choices} onChange={(v) => set(key, v)} onOpenLink={onOpenLink} onTag={onTag} />
              </div>
              <IconButton class="prop-remove" icon={<IconClose />} label={`Remove property ${key}`} title="Remove property" onClick={() => set(key, undefined)} />
            </div>
          ))}
          {adding ? (
            <div class="prop-row prop-adding">
              <input
                class="prop-new-key"
                aria-label="New property name"
                placeholder="Property name"
                value={newKey}
                autoFocus
                onInput={(e) => setNewKey((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKey();
                  } else if (e.key === 'Escape') {
                    setNewKey('');
                    setAdding(false);
                  }
                }}
                onBlur={addKey}
              />
            </div>
          ) : (
            <Button variant="link" class="props-add-link" onClick={() => setAdding(true)}>
              <IconPlus /> Add property
            </Button>
          )}
        </div>
      )}
      {error ? <p class="error">{error}</p> : null}
    </section>
  );
}

interface PropValueProps {
  name: string;
  value: unknown;
  choices?: PropertyChoices;
  onChange(value: unknown): void;
  onOpenLink(target: string): void;
  onTag(tag: string): void;
}

/** One value, edited with a control that fits it: chips for lists, a date picker, a checkbox, or text. */
function PropValue({ name, value, choices, onChange, onOpenLink, onTag }: PropValueProps) {
  const key = name.toLowerCase();
  if (typeof value === 'boolean') {
    return <input type="checkbox" class="prop-check" aria-label={`Property ${name}`} checked={value} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />;
  }
  if (Array.isArray(value)) {
    return <ListValue name={name} items={value} known={key === 'projects' ? choices?.projects : key === 'contexts' ? choices?.contexts : undefined} onChange={onChange} onOpenLink={onOpenLink} onTag={onTag} />;
  }
  if (value !== null && typeof value === 'object') {
    return (
      <code class="prop-complex" title="Nested values are edited in Source">
        {formatValue(value)}
      </code>
    );
  }
  const known = key === 'status' ? choices?.status : key === 'priority' ? choices?.priority : undefined;
  if (known && (typeof value === 'string' || value === null || value === undefined)) {
    return <ChoiceValue name={name} value={value ?? ''} options={known} onChange={onChange} />;
  }
  const date = parseDateValue(value);
  if (date && (value ? true : DATE_PROPERTIES.has(key))) return <DateValue name={name} date={date.date} time={date.time} onChange={onChange} />;
  if (typeof value === 'string' && isoMoment(value)) return <MomentValue name={name} value={value} onChange={onChange} />;
  const link = typeof value === 'string' ? LINK.exec(value) : null;
  return (
    <span class="prop-text">
      <CommitInput class="prop-input" label={`Property ${name}`} value={formatValue(value)} placeholder="Empty" onCommit={(s) => onChange(parseInput(s, value) ?? null)} />
      {link?.[1] && (
        <Button variant="link" class="prop-open-link" onClick={() => onOpenLink(link[1] as string)}>
          Open
        </Button>
      )}
    </span>
  );
}

const MOMENT = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)$/;
/** A full timestamp with a zone (`dateCreated`), as a Date, or null for anything else. */
function isoMoment(value: string): Date | null {
  if (!MOMENT.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A timestamp read as "Oct 18, 2026, 2:30 PM" in this device's locale; a click shows the stored text to edit it. */
function MomentValue({ name, value, onChange }: { name: string; value: string; onChange(value: unknown): void }) {
  const [editing, setEditing] = useState(false);
  const date = isoMoment(value) as Date;
  if (editing) {
    return (
      <CommitInput
        class="prop-input"
        label={`Property ${name}`}
        value={value}
        autoFocus
        onCancel={() => setEditing(false)}
        onCommit={(s) => {
          setEditing(false);
          onChange(parseInput(s, value) ?? null);
        }}
      />
    );
  }
  const shown = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  return (
    // The name contains the visible text (WCAG 2.5.3).
    <button type="button" class="prop-input prop-moment" aria-label={`Property ${name}: ${shown}`} title={`${value} (click to edit)`} onClick={() => setEditing(true)}>
      <time dateTime={value}>{shown}</time>
    </button>
  );
}

/** A fixed set of usual values as a native select; a value outside the set stays selectable. */
function ChoiceValue({ name, value, options, onChange }: { name: string; value: string; options: readonly string[]; onChange(value: unknown): void }) {
  const has = options.some((o) => o.toLowerCase() === value.toLowerCase());
  return (
    <select class="prop-input prop-select" aria-label={`Property ${name}`} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}>
      {value === '' && <option value="">Not set</option>}
      {!has && value !== '' && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** A native date picker, with a time picker once there is a date; the value keeps TaskNotes' `YYYY-MM-DD[THH:mm]` form. */
function DateValue({ name, date, time, onChange }: { name: string; date: string; time: string; onChange(value: unknown): void }) {
  return (
    <span class="prop-date">
      <input type="date" class="prop-input" aria-label={`Property ${name}`} value={date} onChange={(e) => onChange(formatDateValue((e.target as HTMLInputElement).value, time))} />
      {date && <input type="time" class="prop-input prop-time" aria-label={`Time of ${name}`} value={time} onChange={(e) => onChange(formatDateValue(date, (e.target as HTMLInputElement).value))} />}
    </span>
  );
}

function ListValue({ name, items, suggestions, known, onChange, onOpenLink, onTag }: { name: string; items: unknown[]; suggestions?: readonly string[]; known?: readonly string[] } & Omit<PropValueProps, 'name' | 'value'>) {
  const [draft, setDraft] = useState('');
  const isTags = name === 'tags';
  const listId = `${name}-options`;
  const have = new Set(items.map((i) => formatValue(i).toLowerCase()));
  const add = (value = draft): void => {
    const text = value.trim().replace(/^#/, '');
    setDraft('');
    if (!text || have.has(text.toLowerCase())) return;
    onChange([...items, text]);
  };
  return (
    <div class="prop-chips">
      {items.map((item, i) => {
        const text = formatValue(item);
        const link = typeof item === 'string' ? LINK.exec(item) : null;
        const shown = link ? (link[2] ?? link[1]) : isTags ? `#${text}` : text;
        return (
          <span class="prop-chip" key={`${i}:${text}`}>
            {link || isTags ? (
              <button type="button" class="prop-chip-link" onClick={() => (link ? onOpenLink(link[1] as string) : onTag(text))}>
                {shown}
              </button>
            ) : (
              <span>{shown}</span>
            )}
            <button type="button" class="prop-chip-x" aria-label={`Remove ${shown} from ${name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <IconClose />
            </button>
          </span>
        );
      })}
      {(() => {
        const options = (suggestions ?? known ?? []).filter((s) => !have.has(s.toLowerCase()) && !have.has(s.replace(/^\[\[|\]\]$/g, '').toLowerCase()));
        return options.length > 0 ? (
          <select class="prop-choose" aria-label={`Choose ${name}`} value="" onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) onChange([...items, isTags ? v.replace(/^#/, '') : v]);
          }}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {isTags ? `#${o}` : o}
              </option>
            ))}
          </select>
        ) : null;
      })()}
      <input
        class="prop-chip-input"
        aria-label={`Add to ${name}`}
        placeholder={items.length ? '' : isTags ? 'Add tag…' : 'Add…'}
        value={draft}
        list={suggestions ? listId : undefined}
        onInput={(e) => {
          const value = (e.target as HTMLInputElement).value;
          setDraft(value);
          // Picking an option from the suggestion list adds it at once.
          if ((e as InputEvent).inputType === 'insertReplacementText') add(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && items.length) {
            onChange(items.slice(0, -1));
          }
        }}
        onBlur={() => add()}
      />
      {(isTags || name === 'projects') && (
        <a class="prop-edit" href="#/organize" title={isTags ? 'Rename, merge or remove tags' : 'Edit projects'}>
          Edit…
        </a>
      )}
      {suggestions && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !have.has(s.toLowerCase()))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}
