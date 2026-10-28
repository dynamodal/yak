import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { type CommandDef, commandUsing, eventShortcut, formatShortcut, isUsableShortcut, normalizeShortcut, readOverrides, resetShortcut, setShortcut, shortcutsOf } from './commands';

const ev = (o: Partial<KeyboardEvent> & { key: string }): Parameters<typeof eventShortcut>[0] => ({ code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('eventShortcut', () => {
  it('uses the physical letter key, so Alt+S is S whatever the layout produces', () => {
    expect(eventShortcut(ev({ key: 'ß', code: 'KeyS', altKey: true }))).toBe('Alt+S');
  });
  it('orders modifiers and treats Cmd as Ctrl', () => {
    expect(eventShortcut(ev({ key: 'D', code: 'KeyD', shiftKey: true, metaKey: true }))).toBe('Ctrl+Shift+D');
  });
  it('ignores a lone modifier', () => {
    expect(eventShortcut(ev({ key: 'Alt', altKey: true }))).toBeNull();
  });
  it('names other keys', () => {
    expect(eventShortcut(ev({ key: 'F2' }))).toBe('F2');
    expect(eventShortcut(ev({ key: 'ArrowUp', altKey: true }))).toBe('Alt+ArrowUp');
  });
});

describe('normalizeShortcut', () => {
  it('canonicalises typed shortcuts', () => {
    expect(normalizeShortcut('shift + ctrl + d')).toBe('Ctrl+Shift+D');
    expect(normalizeShortcut('Cmd+k')).toBe('Ctrl+K');
    expect(normalizeShortcut('option+s')).toBe('Alt+S');
  });
});

describe('isUsableShortcut', () => {
  it('needs Ctrl or Alt, or a function key', () => {
    expect(isUsableShortcut('Alt+S')).toBe(true);
    expect(isUsableShortcut('Ctrl+Shift+D')).toBe(true);
    expect(isUsableShortcut('F2')).toBe(true);
    expect(isUsableShortcut('S')).toBe(false);
    expect(isUsableShortcut('Shift+S')).toBe(false);
  });
});

describe('bindings', () => {
  const a: CommandDef = { id: 'a', title: 'A', shortcuts: ['Alt+A'], run() {} };
  const b: CommandDef = { id: 'b', title: 'B', run() {} };
  it('overrides replace defaults; an empty string unbinds; reset restores', () => {
    const doc = new Y.Doc();
    expect(shortcutsOf(a, readOverrides(doc))).toEqual(['Alt+A']);
    setShortcut(doc, 'a', 'Alt+Z');
    expect(shortcutsOf(a, readOverrides(doc))).toEqual(['Alt+Z']);
    setShortcut(doc, 'a', '');
    expect(shortcutsOf(a, readOverrides(doc))).toEqual([]);
    resetShortcut(doc, 'a');
    expect(shortcutsOf(a, readOverrides(doc))).toEqual(['Alt+A']);
  });
  it('finds the command that already uses a shortcut', () => {
    expect(commandUsing([a, b], {}, 'Alt+A')?.id).toBe('a');
    expect(commandUsing([a, b], {}, 'Alt+A', 'a')).toBeUndefined();
    expect(commandUsing([a, b], { b: 'Alt+A' }, 'Alt+A', 'a')?.id).toBe('b');
  });
});

describe('formatShortcut', () => {
  it('writes words with spaces, as the Shortcuts card does', () => {
    expect(formatShortcut('Alt+P', false)).toBe('Alt P');
    expect(formatShortcut('Ctrl+Shift+F', false)).toBe('Ctrl Shift F');
    expect(formatShortcut('F5', false)).toBe('F5');
  });
  it('writes Mac symbols on a Mac', () => {
    expect(formatShortcut('Alt+P', true)).toBe('⌥P');
    expect(formatShortcut('Ctrl+Shift+F', true)).toBe('⌘⇧F');
  });
});
