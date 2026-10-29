import { type ComponentChildren, Fragment, type RefObject } from 'preact';
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Button, IconCheck, IconFolder, IconPlus, IconTag, Popover } from '../app/ui';
import { createClient, createProject, type ProjectRecord } from './catalog';
import type { SpaceCatalog } from './hooks';
import { Swatch } from './widgets';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function useOpenFocus(open: boolean): { input: RefObject<HTMLInputElement | null> } {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  return { input };
}

interface Option {
  key: string;
  spaceId: string;
  project: ProjectRecord | null;
  /** Shown above the option: a space, or a client inside a space. */
  heading?: string;
  subheading?: string;
  /** Under a client heading. */
  indent?: boolean;
  /** An entry that makes a new record instead of picking one. */
  create?: 'project' | 'client';
  text?: string;
}

export interface ProjectPickerProps {
  /** Spaces offered; the first is where "No project" goes when the value has no space yet. */
  spaces: readonly SpaceCatalog[];
  spaceId: string;
  projectId: string | null;
  onChange(spaceId: string, projectId: string | null): void;
  /** Show the space beside the project name on the button (when it differs from the page's space). */
  showSpace?: boolean;
  /** Accessible name prefix, e.g. "Project" or "Project of Standup". */
  label?: string;
  class?: string;
  /** Text shown when there is no project. */
  placeholder?: ComponentChildren;
}

/**
 * A project picker: a button showing the project, opening a searchable list grouped by space and
 * client. Keyboard: type to filter, arrows to move, Enter to pick, Escape to close.
 */
export function ProjectPicker({ spaces, spaceId, projectId, onChange, showSpace, label = 'Project', class: extra, placeholder }: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const { input } = useOpenFocus(open);
  const listId = useId();
  const multi = spaces.length > 1;

  const space = spaces.find((s) => s.spaceId === spaceId);
  const project = projectId ? space?.projectById.get(projectId) : undefined;
  const client = project?.client_id ? space?.clientById.get(project.client_id) : undefined;

  const q = query.trim().toLowerCase();
  const options: Option[] = !q || 'no project'.includes(q) ? [{ key: 'none', spaceId, project: null }] : [];
  for (const s of spaces) {
    const clientName = (p: ProjectRecord): string => (p.client_id ? (s.clientById.get(p.client_id)?.name ?? '') : '');
    const visible = s.projects
      .filter((p) => p.active || (p.id === projectId && s.spaceId === spaceId))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || clientName(p).toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => clientName(a).localeCompare(clientName(b)) || a.name.localeCompare(b.name));
    let lastClient: string | null = null;
    visible.forEach((p, i) => {
      const c = clientName(p);
      options.push({
        key: `${s.spaceId}:${p.id}`,
        spaceId: s.spaceId,
        project: p,
        heading: i === 0 && multi ? s.name : undefined,
        subheading: c !== lastClient && c ? c : undefined,
        indent: !!c,
      });
      lastClient = c;
    });
  }

  // Typing a name that does not exist offers to create it here: "Project", or "Client / Project".
  const target = spaces.find((s) => s.spaceId === spaceId) ?? spaces[0];
  const raw = query.trim();
  const slash = raw.indexOf('/');
  const clientPart = slash >= 0 ? raw.slice(0, slash).trim() : '';
  const projectPart = slash >= 0 ? raw.slice(slash + 1).trim() : raw;
  const lower = (t: string): string => t.toLowerCase();
  const inTarget = target ? ` in ${target.name}` : '';
  if (target && projectPart && !target.projects.some((p) => lower(p.name) === lower(projectPart) && (!clientPart || lower(target.clientById.get(p.client_id ?? '')?.name ?? '') === lower(clientPart)))) {
    const text = clientPart ? `Create project “${projectPart}” for client “${clientPart}”` : `Create project “${projectPart}”`;
    options.push({ key: 'create-project', spaceId, project: null, create: 'project', text: multi ? `${text}${inTarget}` : text });
  }
  if (target && raw && slash < 0 && !target.clients.some((c) => lower(c.name) === lower(raw))) {
    options.push({ key: 'create-client', spaceId, project: null, create: 'client', text: `Create client “${raw}”` });
  }
  const at = Math.max(0, Math.min(active, options.length - 1));

  const make = (kind: 'project' | 'client'): void => {
    if (!target) return;
    if (kind === 'client') {
      createClient(target.doc, raw);
      setQuery(`${raw} / `);
      setActive(0);
      return;
    }
    const existing = clientPart ? target.clients.find((c) => lower(c.name) === lower(clientPart)) : undefined;
    const clientId = clientPart ? (existing?.id ?? createClient(target.doc, clientPart)) : null;
    const id = createProject(target.doc, { name: projectPart, client_id: clientId });
    if (!id) return;
    close();
    anchor.current?.focus();
    onChange(target.spaceId, id);
  };

  const close = (): void => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const pick = (o: Option): void => {
    if (o.create) return make(o.create);
    close();
    anchor.current?.focus();
    onChange(o.spaceId, o.project?.id ?? null);
  };

  const name = project ? project.name : 'none';
  const where = project && multi ? ` in ${space?.name ?? spaceId}` : '';
  return (
    <>
      <Button
        buttonRef={anchor}
        class={cx('picker-btn project-btn', !project && 'empty', extra)}
        aria-label={`${label}: ${name}${where}`}
        title={project ? `${project.name}${client ? ` (${client.name})` : ''}${multi ? ` · ${space?.name ?? spaceId}` : ''}` : 'Choose a project'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {project ? <Swatch color={project.color} /> : <IconFolder />}
        <span class="picker-text">{project ? project.name : (placeholder ?? 'Project')}</span>
        {client && <span class="picker-client picker-text">{client.name}</span>}
        {project && showSpace && <span class="picker-space">{space?.name ?? spaceId}</span>}
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} label={`Choose ${label.toLowerCase()}`} class="picker">
        <input
          ref={input}
          type="text"
          class="picker-search"
          role="combobox"
          aria-label="Find a project"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={`${listId}-${at}`}
          placeholder="Find or create (Client / Project)"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length > 0) {
              e.preventDefault();
              setActive((at + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const o = options[at];
              if (o) pick(o);
            }
          }}
        />
        <ul class="picker-list" role="listbox" id={listId} aria-label="Projects">
          {options.map((o, i) => {
            if (o.create)
              return (
                <li
                  key={o.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected="false"
                  class={cx('picker-option', 'picker-new', i === at && 'active')}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onPointerEnter={() => setActive(i)}
                >
                  <IconPlus />
                  <span class="picker-text">{o.text}</span>
                </li>
              );
            const selected = o.project ? o.project.id === projectId && o.spaceId === spaceId : projectId === null;
            return (
              <Fragment key={o.key}>
                {o.heading && (
                  <li role="presentation" class="picker-heading">
                    {o.heading}
                  </li>
                )}
                {o.subheading && (
                  <li role="presentation" class="picker-sub">
                    {o.subheading}
                  </li>
                )}
                <li
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  class={cx('picker-option', i === at && 'active', o.indent && 'indent')}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onPointerEnter={() => setActive(i)}
                >
                  {o.project ? <Swatch color={o.project.color} /> : <span class="swatch none" aria-hidden="true" />}
                  <span class="picker-text">
                    {o.project ? o.project.name : 'No project'}
                    {o.project && !o.project.active ? ' (archived)' : ''}
                  </span>
                  {selected && <IconCheck />}
                </li>
              </Fragment>
            );
          })}
        </ul>
        <a class="picker-edit" href="#/settings/organize">Edit…</a>
      </Popover>
    </>
  );
}

export interface TagPickerProps {
  value: readonly string[];
  /** Tag names of the entry's space. */
  known: readonly string[];
  onChange(tags: string[]): void;
  /** Make sure a tag record exists; returns the stored spelling. */
  onCreate(name: string): string | null;
  label?: string;
  class?: string;
  /** Show the tag names on the button, not only the icon and count. */
  showNames?: boolean;
}

/** A tag picker: a button with the tags, opening a searchable checklist; Enter adds a new tag. */
export function TagPicker({ value, known, onChange, onCreate, label = 'Tags', class: extra, showNames = true }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const { input } = useOpenFocus(open);
  const has = (t: string): boolean => value.some((v) => v.toLowerCase() === t.toLowerCase());
  const all = [...value.filter((v) => !known.some((k) => k.toLowerCase() === v.toLowerCase())), ...known];
  const q = query.trim();
  const shown = all.filter((t) => t.toLowerCase().includes(q.toLowerCase()));
  const exact = all.find((t) => t.toLowerCase() === q.toLowerCase());

  const toggle = (t: string): void => onChange(has(t) ? value.filter((v) => v.toLowerCase() !== t.toLowerCase()) : [...value, t]);
  const add = (): void => {
    if (!q) return;
    if (exact) toggle(exact);
    else {
      const stored = onCreate(q);
      if (stored && !has(stored)) onChange([...value, stored]);
    }
    setQuery('');
  };
  const close = (): void => {
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Button
        buttonRef={anchor}
        class={cx('picker-btn tag-btn', value.length === 0 && 'empty', extra)}
        aria-label={`${label}: ${value.length ? value.join(', ') : 'none'}`}
        title={value.length ? value.join(', ') : 'Add tags'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <IconTag />
        {value.length > 0 && <span class="picker-text">{showNames ? value.join(', ') : value.length}</span>}
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} label={`Choose ${label.toLowerCase()}`} class="picker">
        <input
          ref={input}
          type="text"
          class="picker-search"
          aria-label="Find or add a tag"
          placeholder="Find or add a tag"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <div class="picker-list" role="group" aria-label="Tags">
          {shown.map((t) => (
            <label key={t} class="picker-option">
              <input type="checkbox" checked={has(t)} onChange={() => toggle(t)} />
              <span class="picker-text">{t}</span>
            </label>
          ))}
          {q && !exact && (
            <Button class="picker-option picker-create" onClick={add}>
              Add tag “{q}”
            </Button>
          )}
          {!q && shown.length === 0 && <p class="picker-empty">No tags yet. Type a name and press Enter.</p>}
        </div>
        <a class="picker-edit" href="#/settings/organize">Edit…</a>
      </Popover>
    </>
  );
}
