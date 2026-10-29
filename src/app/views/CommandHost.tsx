import type * as Y from 'yjs';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { allCommands, paletteCommands, type CommandDef, registerCommand, eventShortcut, findByShortcut, formatShortcut, readOverrides, shortcutsOf } from '../commands';
import { useApp } from '../context';
import { useYVersion } from '../hooks';
import { registerGlobal, registerHeaderItem } from '../registry';
import { Button, Dialog, IconCommand } from '../ui';

const OPEN_EVENT = 'app:command-palette';

const PALETTE_COMMAND: CommandDef = { id: 'palette.open', title: 'Show all commands', shortcuts: ['Alt+P'], run: () => openPalette() };
registerCommand(PALETTE_COMMAND);

function openPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The overrides of the default shortcuts, re-read when the account document's `shortcuts` map changes. */
export function useOverrides(): Readonly<Record<string, string>> {
  const { account } = useApp();
  const v = useYVersion(account.getMap('shortcuts') as Y.AbstractType<unknown>);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readOverrides(account), [account, v]);
}

/** Matches words of the query, in any order, anywhere in the title or the keywords ("go ti" finds "Go to Timer"). */
function matches(c: Pick<CommandDef, 'title' | 'keywords'>, query: string): boolean {
  const t = [c.title, ...(c.keywords ?? [])].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w));
}

function Palette({ commands, onRun, onClose }: { commands: readonly CommandDef[]; onRun(c: CommandDef): void; onClose(): void }) {
  const overrides = useOverrides();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // A title that holds every word comes before one found only through its keywords.
  const inTitle = (c: CommandDef): boolean => matches({ title: c.title }, query);
  const found = commands.filter((c) => matches(c, query));
  const shown = [...found.filter(inTitle), ...found.filter((c) => !inTitle(c))];
  useEffect(() => setActive(0), [query]);
  const choose = (i: number): void => {
    const c = shown[i];
    if (!c) return;
    onClose();
    // After the dialog has closed, so a command that moves focus (an editor) keeps it.
    setTimeout(() => onRun(c), 0);
  };
  return (
    <Dialog class="palette" label="Commands" onClose={onClose}>
      <input
        class="palette-input"
        aria-label="Find a command"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={shown[active] ? `cmd-${shown[active].id}` : undefined}
        placeholder="Type a command…"
        value={query}
        autoFocus
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(shown.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
          }
        }}
      />
      <ul id="palette-list" role="listbox" class="palette-list">
        {shown.map((c, i) => (
          <li
            key={c.id}
            id={`cmd-${c.id}`}
            role="option"
            aria-selected={i === active}
            class={i === active ? 'active' : ''}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(i);
            }}
          >
            <span>{c.title}</span>
            <span class="palette-keys">
              {shortcutsOf(c, overrides).map((s) => (
                <kbd key={s}>{formatShortcut(s)}</kbd>
              ))}
            </span>
          </li>
        ))}
        {shown.length === 0 && <li class="palette-empty">No command matches.</li>}
      </ul>
      <p class="hint palette-help">↑ ↓ to choose, Enter to run, Esc to close. Shortcuts can be changed in Help › Keyboard shortcuts.</p>
    </Dialog>
  );
}

/** The one place keys are handled: runs the command bound to a pressed shortcut, and shows the palette. */
export function CommandHost() {
  const app = useApp();
  const overrides = useOverrides();
  const [open, setOpen] = useState(false);
  const latest = useRef({ app, overrides });
  latest.current = { app, overrides };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // An editor or dialog that handled the key itself (Ctrl+K is "link" inside a note, as decided in NE16) keeps it.
      if (e.defaultPrevented || e.isComposing) return;
      const shortcut = eventShortcut(e);
      if (!shortcut) return;
      const cmd = findByShortcut(allCommands(), latest.current.overrides, shortcut);
      if (!cmd) return;
      e.preventDefault();
      cmd.run({ app: latest.current.app });
    };
    const onOpen = (): void => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  return open ? <Palette commands={paletteCommands()} onRun={(c) => c.run({ app: latest.current.app })} onClose={() => setOpen(false)} /> : null;
}

/** The header's command button: the command icon and, on a wide screen with a keyboard, a chip with the bound shortcut. */
export function PaletteButton() {
  const overrides = useOverrides();
  const keys = shortcutsOf(PALETTE_COMMAND, overrides)[0];
  return (
    <Button class="palette-btn" aria-label="Command palette" aria-keyshortcuts={keys} title="Search, go to, run a command" onClick={openPalette}>
      <IconCommand />
      {keys ? <kbd class="palette-chip" aria-hidden="true">{formatShortcut(keys)}</kbd> : null}
    </Button>
  );
}

registerGlobal({ id: 'commands', component: CommandHost });
registerHeaderItem({ id: 'palette', order: 90, component: PaletteButton });
