import { useLayoutEffect, useState } from 'preact/hooks';
import { allCommands, commandUsing, eventShortcut, formatShortcut, isUsableShortcut, resetShortcut, setShortcut, shortcutsOf } from '../app/commands';
import { useApp } from '../app/context';
import { useOverrides } from '../app/views/CommandHost';
import { Button } from '../app/ui';

/** Key bindings: each command with its shortcut; "Change" listens for the next key combination. */
export function ShortcutsCard() {
  const { account } = useApp();
  const overrides = useOverrides();
  const commands = allCommands();
  const [capturing, setCapturing] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  // A layout effect, so the listener is in place the moment "Press the keys…" is on screen.
  useLayoutEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      const shortcut = eventShortcut(e);
      if (!shortcut) return;
      e.preventDefault();
      e.stopPropagation();
      if (shortcut === 'Escape') return setCapturing(null);
      if (shortcut === 'Backspace' || shortcut === 'Delete') {
        setShortcut(account, capturing, '');
        setProblem('');
        return setCapturing(null);
      }
      if (!isUsableShortcut(shortcut)) return setProblem('Use Ctrl or Alt with a key, or a function key, so typing is never caught.');
      const other = commandUsing(commands, overrides, shortcut, capturing);
      if (other) return setProblem(`${shortcut.replace(/\+/g, ' ')} is used by “${other.title}”. Change that one first.`);
      setShortcut(account, capturing, shortcut);
      setProblem('');
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, account, overrides, commands]);

  return (
    <div class="card st-group">
      <table class="st-table st-shortcuts">
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">Shortcut</th>
            <th scope="col">
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {commands.map((c) => {
            const keys = shortcutsOf(c, overrides);
            const changed = overrides[c.id] !== undefined;
            return (
              <tr key={c.id} class="st-shortcut">
                <th scope="row" class="st-shortcut-title">
                  {c.title}
                </th>
                <td class="st-shortcut-keys">
                  {capturing === c.id ? (
                    <em>Press the keys… (Esc cancels, Backspace removes)</em>
                  ) : keys.length ? (
                    keys.map((k) => <kbd key={k}>{formatShortcut(k)}</kbd>)
                  ) : (
                    <span class="muted">none</span>
                  )}
                </td>
                <td class="st-shortcut-actions">
                  <Button variant="quiet" aria-label={`Change shortcut of ${c.title}`} onClick={() => (setProblem(''), setCapturing(capturing === c.id ? null : c.id))}>
                    {capturing === c.id ? 'Cancel' : 'Change'}
                  </Button>
                  {changed && (
                    <Button variant="quiet" aria-label={`Reset shortcut of ${c.title}`} onClick={() => resetShortcut(account, c.id)}>
                      Reset
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {problem && (
        <p class="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
