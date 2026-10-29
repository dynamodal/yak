import type * as Y from 'yjs';
import type { AppContextValue } from './context';
import { commandHidden } from './features';
import { allViews } from './registry';
import { settingsCommands } from './settings-index';

/**
 * Commands: named actions with default shortcuts. Modules register them from their `index.ts`, the way
 * they register views; one key handler (`CommandHost`) and the command palette run them. A person
 * rebinds a command through data (the account document's `shortcuts` map), never through code.
 */

interface CommandContext {
  app: AppContextValue;
}

export interface CommandDef {
  id: string;
  title: string;
  /** Further words the palette matches besides the title (`mirror`, `folder`, `obsidian` find Mirror). */
  keywords?: readonly string[];
  /** Default key combinations, for example `Alt+S`. */
  shortcuts?: readonly string[];
  run(ctx: CommandContext): void;
}

const registered: CommandDef[] = [];

export function registerCommand(def: CommandDef): void {
  if (registered.some((c) => c.id === def.id)) return;
  registered.push(def);
}

/** Defaults for the "Go to <view>" commands every view gets. */
const GO_DEFAULTS: Readonly<Record<string, string>> = { timer: 'Alt+T' };

/** Registered commands, then one "Go to <view>" per visible view. */
export function allCommands(): CommandDef[] {
  const go = allViews()
    .filter((v) => !v.hidden)
    .map(
      (v): CommandDef => ({
        id: `go.${v.id}`,
        title: `Go to ${v.commandTitle ?? v.title}`,
        shortcuts: GO_DEFAULTS[v.id] ? [GO_DEFAULTS[v.id] as string] : [],
        run: () => {
          const parent = v.joins === undefined ? undefined : allViews().find((p) => p.id === v.joins);
          location.hash = `#/${parent ? `${parent.path}/` : ''}${v.path}`;
        },
      }),
    );
  return [...registered, ...go].filter((c) => !commandHidden(c.id));
}

/** The commands the palette lists: every command, then one per Settings section and row (`settings-index.ts`). Not the shortcuts list: a place in Settings has no key. */
export function paletteCommands(): CommandDef[] {
  return [...allCommands(), ...settingsCommands()];
}

// ---- Shortcut strings

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);

/** The main key of an event: layout independent for letters and digits (so Alt+S is the S key). */
function mainKey(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return e.key.length === 1 ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key;
}

/** `Ctrl+Alt+Shift+Key`; Cmd counts as Ctrl. Null while only a modifier is held. */
export function eventShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(mainKey(e));
  return parts.join('+');
}

/** Canonical spelling of a typed shortcut: modifier order fixed, letters upper-cased, `Cmd`/`Mod` as `Ctrl`. */
export function normalizeShortcut(text: string): string {
  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => (/^(ctrl|control|cmd|command|meta|mod)$/i.test(p) ? 'Ctrl' : /^alt|option$/i.test(p) ? 'Alt' : /^shift$/i.test(p) ? 'Shift' : p)));
  const ordered = ['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m));
  return [...ordered, key.length === 1 ? key.toUpperCase() : key].join('+');
}

/** A shortcut that cannot be typed into a text field by mistake: it needs Ctrl or Alt, or is a function key. */
export function isUsableShortcut(shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts.pop() ?? '';
  return /^F([1-9]|1[0-2])$/.test(key) || (key !== '' && (parts.includes('Ctrl') || parts.includes('Alt')));
}

/** True on Apple platforms, where Alt is Option and Ctrl (which also stands for Cmd) shows as ⌘. Feature-detected; false when the browser says nothing. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** How a shortcut is written for people: `Alt P` (words, spaces) elsewhere, `⌥P` on a Mac. */
export function formatShortcut(shortcut: string, mac = isMacPlatform()): string {
  if (!mac) return shortcut.replace(/\+/g, ' ');
  const symbol: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' };
  return shortcut.split('+').map((part) => symbol[part] ?? part).join('');
}

// ---- Bindings: the person's changes to the defaults

export type Overrides = Readonly<Record<string, string>>;

function shortcutsMap(account: Y.Doc): Y.Map<string> {
  return account.getMap<string>('shortcuts');
}

export function readOverrides(account: Y.Doc | undefined): Overrides {
  const out: Record<string, string> = {};
  account?.getMap<unknown>('shortcuts').forEach((v, k) => {
    if (typeof v === 'string') out[k] = v;
  });
  return out;
}

/** An empty string in the overrides means "no shortcut". */
export function shortcutsOf(cmd: Pick<CommandDef, 'id' | 'shortcuts'>, overrides: Overrides): string[] {
  const own = overrides[cmd.id];
  if (own === undefined) return [...(cmd.shortcuts ?? [])];
  return own ? [own] : [];
}

export function setShortcut(account: Y.Doc, id: string, shortcut: string): void {
  shortcutsMap(account).set(id, shortcut);
}

export function resetShortcut(account: Y.Doc, id: string): void {
  shortcutsMap(account).delete(id);
}

/** The command that already uses `shortcut`, other than `except`. */
export function commandUsing(commands: readonly CommandDef[], overrides: Overrides, shortcut: string, except?: string): CommandDef | undefined {
  return commands.find((c) => c.id !== except && shortcutsOf(c, overrides).includes(shortcut));
}

export function findByShortcut(commands: readonly CommandDef[], overrides: Overrides, shortcut: string): CommandDef | undefined {
  return commandUsing(commands, overrides, shortcut);
}
