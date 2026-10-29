import { useEffect, useState } from 'preact/hooks';
import { Dialog } from '../../app/ui';
import type { NoteInfo } from '../note-store';
import { switcherMatches } from '../search';

export interface QuickSwitcherProps {
  notes: readonly NoteInfo[];
  /** Names the space of a note, when several spaces are on show. */
  spaceOf?(id: string): string;
  onOpen(id: string): void;
  onCreate(name: string): void;
  onClose(): void;
}

/** A modal list of notes filtered by a fuzzy query. Enter opens; with no match, Enter creates. */
export function QuickSwitcher(p: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const matches = switcherMatches(p.notes, query);

  useEffect(() => setActive(0), [query]);

  const choose = (i: number): void => {
    const m = matches[i];
    if (m) p.onOpen(m.id);
    else if (query.trim()) p.onCreate(query.trim());
    else return;
    p.onClose();
  };

  return (
    <Dialog class="switcher" label="Open a note" onClose={p.onClose}>
      <input
        class="switcher-input"
        aria-label="Find a note"
        role="combobox"
        aria-expanded="true"
        aria-controls="switcher-list"
        aria-activedescendant={matches[active] ? `sw-${matches[active].id}` : undefined}
        placeholder="Find or create a note…"
        value={query}
        autoFocus
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey && query.trim()) {
              p.onCreate(query.trim());
              p.onClose();
            } else choose(active);
          }
        }}
      />
      <ul id="switcher-list" role="listbox" class="switcher-list">
        {matches.map((m, i) => (
          <li
            key={m.id}
            id={`sw-${m.id}`}
            role="option"
            aria-selected={i === active}
            class={i === active ? 'active' : ''}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(i);
            }}
          >
            <span class="switcher-title">{m.title}</span>
            <span class="switcher-path">{p.spaceOf ? `${p.spaceOf(m.id)} · ${m.path}` : m.path}</span>
          </li>
        ))}
        {matches.length === 0 && query.trim() && (
          <li class="switcher-create" role="option" aria-selected="true">
            Create “{query.trim()}”
          </li>
        )}
      </ul>
      <p class="hint">↑ ↓ to choose, Enter to open, Shift+Enter to create, Esc to close</p>
    </Dialog>
  );
}
