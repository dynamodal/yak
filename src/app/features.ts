import { useEffect, useState } from 'preact/hooks';

/**
 * Features this device can hide (F-309). The list is per device, in `localStorage` under `hidden_modules`;
 * when it is absent everything is on. Hiding only removes the pages, commands and search results: the data
 * stays and keeps syncing, so showing a feature again brings it all back (F39, no migration).
 * Settings, Devices and the sync status are never hidden. Time can be hidden (F-33l):
 * the tab, Reports, the timer pill, the timer commands and the running cue go; a running timer must be
 * stopped first (`setFeatureBlock`), so a timer is never left running out of sight on this device.
 */
export type FeatureId = 'home' | 'time' | 'notes' | 'tasks' | 'mirror' | 'import';

export const FEATURES: readonly { id: FeatureId; title: string; hint: string }[] = [
  { id: 'home', title: 'Home', hint: 'A summary page: what needs you, this week, tasks due soon and recent notes. It opens first.' },
  { id: 'time', title: 'Time', hint: 'The timer (also in the header), the log, the week and Reports. Hiding Time hides all of them; stop a running timer first.' },
  { id: 'notes', title: 'Notes', hint: 'Markdown notes, folders and daily notes. Tasks stay when Notes is off.' },
  { id: 'tasks', title: 'Tasks', hint: 'Tasks are notes with a due date or status. They work with Notes off.' },
  { id: 'mirror', title: 'Mirror', hint: 'Keep a folder of Markdown files in step with your notes. Needs folder access in the browser. Set it up in Settings › Mirror to a folder.' },
  { id: 'import', title: 'Import', hint: 'Bring in a Toggl or CSV export.' },
];

const KEY = 'hidden_modules';
const EVENT = 'app:features';

/** The view (by id) each feature owns. */
const VIEW_FEATURE: Readonly<Record<string, FeatureId>> = {
  home: 'home',
  timer: 'time',
  entries: 'time',
  notes: 'notes',
  tasks: 'tasks',
  // Reports is a segment of the Time page, so it follows Time (F-33m); an old stored `reports` id is not a known feature and is ignored.
  reports: 'time',
  import: 'import',
};

/** The commands that are not a "Go to <view>". */
const COMMAND_FEATURE: Readonly<Record<string, FeatureId>> = {
  'timer.toggle': 'time',
  'tasks.new': 'tasks',
  'notes.find': 'notes',
  'notes.today': 'notes',
  'notes.insert-date': 'notes',
};

const known = new Set<string>(FEATURES.map((f) => f.id));

/** The stored list, as saved (only known ids); empty when absent or unreadable. */
export function readHiddenModules(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): FeatureId[] {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === 'string' && known.has(x)) as FeatureId[]) : [];
  } catch {
    return [];
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * What is hidden in effect: the stored list. The switches are independent (F-33n): Tasks work without Notes.
 * (Before that, hiding Notes also hid Tasks; an old list with `notes` but not `tasks` now shows Tasks.)
 */
export function effectiveHidden(stored: readonly FeatureId[]): Set<FeatureId> {
  return new Set(stored);
}

// ---- A feature that cannot be hidden right now (a running timer)

const blocks = new Map<FeatureId, string>();

/** A feature says why it cannot be hidden at the moment (`null` clears it). Settings shows the reason and disables the switch. */
export function setFeatureBlock(id: FeatureId, reason: string | null): void {
  if ((blocks.get(id) ?? null) === reason) return;
  if (reason === null) blocks.delete(id);
  else blocks.set(id, reason);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function featureBlock(id: FeatureId): string | undefined {
  return blocks.get(id);
}

export function setHiddenModules(list: readonly FeatureId[]): void {
  try {
    safeStorage()?.setItem(KEY, JSON.stringify([...new Set(list)]));
  } catch {
    // ignore: the choice then lasts until the page reloads
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function isFeatureHidden(id: FeatureId): boolean {
  return effectiveHidden(readHiddenModules()).has(id);
}

/** Re-renders when the list changes (here or in another tab). */
export function useHiddenModules(): FeatureId[] {
  const [list, setList] = useState(readHiddenModules);
  useEffect(() => {
    const update = (): void => setList(readHiddenModules());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return list;
}

// ---- The registry filter: nav, Settings pages, palette, shortcuts, search

export function viewHidden(viewId: string, hidden: ReadonlySet<FeatureId> = effectiveHidden(readHiddenModules())): boolean {
  const f = VIEW_FEATURE[viewId];
  return f !== undefined && hidden.has(f);
}

export function commandHidden(commandId: string, hidden: ReadonlySet<FeatureId> = effectiveHidden(readHiddenModules())): boolean {
  const f = COMMAND_FEATURE[commandId] ?? (commandId.startsWith('go.') ? VIEW_FEATURE[commandId.slice(3)] : undefined);
  return f !== undefined && hidden.has(f);
}

/**
 * The kind a search result is listed under, or undefined when it is left out. Notes and tasks come from one source (a task is a note):
 * with Tasks off and Notes on, a task is still found, as a note, and opens in Notes (#44); with Notes off, plain notes go and tasks stay.
 */
export function searchKindFor(kind: string, hidden: ReadonlySet<FeatureId> = effectiveHidden(readHiddenModules())): string | undefined {
  if (kind === 'note') return hidden.has('notes') ? undefined : 'note';
  if (kind === 'task') return !hidden.has('tasks') ? 'task' : hidden.has('notes') ? undefined : 'note';
  return kind;
}

/** Whether results of a kind are left out of search altogether (see `searchKindFor`). */
export function searchKindHidden(kind: string, hidden: ReadonlySet<FeatureId> = effectiveHidden(readHiddenModules())): boolean {
  return searchKindFor(kind, hidden) === undefined;
}

/**
 * The route to leave when it names a hidden page (`#/notes`, `#/settings/import`), else undefined.
 * `views` is every registered view, hidden or not.
 */
export function hiddenRoute(route: readonly string[], views: readonly { id: string; path: string; group?: string; joins?: string }[], hidden: ReadonlySet<FeatureId> = effectiveHidden(readHiddenModules())): boolean {
  const [first, second] = route;
  // `#/time/reports`: a view that joins another's switch is hidden on its own.
  const parent = views.find((v) => v.path === first && v.group !== 'settings');
  const joined = second === undefined || !parent ? undefined : views.find((v) => v.joins === parent.id && v.path === second);
  const view = joined ?? (first === 'settings' ? views.find((v) => v.group === 'settings' && v.path === second) : parent);
  return view !== undefined && viewHidden(view.id, hidden);
}

/**
 * Where to land: the first tab this device shows, else Settings (never hidden). `views` is every registered view;
 * tabs are the ones with no group, not `hidden` and not joined to another page.
 */
export function landingRoute(
  hidden: ReadonlySet<FeatureId>,
  views: readonly { id: string; path: string; order: number; group?: string; joins?: string; hidden?: boolean }[],
): string {
  const tab = [...views]
    .sort((a, b) => a.order - b.order)
    .find((v) => !v.group && !v.hidden && v.joins === undefined && !viewHidden(v.id, hidden));
  return tab ? `#/${tab.path}` : '#/settings';
}

/** The two choices on Welcome. */
export const PRESETS = {
  timeTracker: ['home', 'notes', 'tasks'] as FeatureId[],
  everything: [] as FeatureId[],
};
