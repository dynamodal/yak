import { useEffect, useState } from 'preact/hooks';

/**
 * Features this device can hide (F-309). The list is per device, in `localStorage` under `hidden_modules`;
 * when it is absent everything is on. Hiding only removes the pages, commands and search results: the data
 * stays and keeps syncing, so showing a feature again brings it all back (F39, no migration).
 * Time, Settings, Backup & restore, Devices and the sync status are never hidden.
 */
export type FeatureId = 'notes' | 'tasks' | 'reports' | 'mirror' | 'import';

export const FEATURES: readonly { id: FeatureId; title: string; hint: string }[] = [
  { id: 'notes', title: 'Notes', hint: 'Markdown notes. Hiding Notes also hides Tasks.' },
  { id: 'tasks', title: 'Tasks', hint: 'Tasks are notes with a due date or status.' },
  { id: 'reports', title: 'Reports', hint: 'Totals and charts of your time.' },
  { id: 'mirror', title: 'Mirror', hint: 'Keep a folder of Markdown files in step with your notes. Needs folder access in the browser.' },
  { id: 'import', title: 'Import', hint: 'Bring in a Toggl or CSV export.' },
];

const KEY = 'hidden_modules';
const EVENT = 'app:features';

/** The view (by id) each feature owns. */
const VIEW_FEATURE: Readonly<Record<string, FeatureId>> = {
  notes: 'notes',
  'notes-settings': 'notes',
  tasks: 'tasks',
  reports: 'reports',
  import: 'import',
};

/** The commands that are not a "Go to <view>". */
const COMMAND_FEATURE: Readonly<Record<string, FeatureId>> = {
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

/** What is hidden in effect: the stored list, plus Tasks whenever Notes is hidden. */
export function effectiveHidden(stored: readonly FeatureId[]): Set<FeatureId> {
  const out = new Set(stored);
  if (out.has('notes')) out.add('tasks');
  return out;
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

/** Search results of a kind: notes and tasks come from one source, so they are filtered by kind. */
export function searchKindHidden(kind: string, hidden: ReadonlySet<FeatureId> = effectiveHidden(readHiddenModules())): boolean {
  return (kind === 'note' && hidden.has('notes')) || (kind === 'task' && hidden.has('tasks'));
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

/** The two choices on Welcome. */
export const PRESETS = {
  timeTracker: ['notes', 'tasks'] as FeatureId[],
  everything: [] as FeatureId[],
};
