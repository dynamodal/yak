import { useEffect } from 'preact/hooks';
import type { AppContextValue } from './context';
import type { SearchItem } from '../core/search';
import { searchKindFor, type FeatureId } from './features';

/**
 * What the universal search looks through. Each module registers a source for its own data (notes
 * and tasks, time entries and the catalogue, tags); the search dialog (`views/SearchDialog.tsx`)
 * never imports a module, and ranking lives in `src/core/search.ts`.
 */
export interface SearchEntry extends SearchItem {
  /** Opens the item where it lives. */
  open(): void;
}

export interface SearchSource {
  id: string;
  /** All items of one space; called when the dialog opens and again when documents change. */
  collect(app: AppContextValue, spaceId: string): SearchEntry[];
}

const sources: SearchSource[] = [];

export function registerSearchSource(source: SearchSource): void {
  if (!sources.some((s) => s.id === source.id)) sources.push(source);
}

/** The sources, with the results of hidden features left out (F-309). A task found while only Tasks is off is listed as a note (#44). */
export function allSearchSources(): readonly SearchSource[] {
  return sources.map((s) => ({ ...s, collect: (app, spaceId) => collectVisible(s.collect(app, spaceId)) }));
}

/** Drops the results of hidden features and files a task under Notes when only Tasks is hidden. Pure, so it is tested without a source. */
export function collectVisible(entries: readonly SearchEntry[], hidden?: ReadonlySet<FeatureId>): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const e of entries) {
    const kind = searchKindFor(e.kind, hidden);
    if (kind !== undefined) out.push(kind === e.kind ? e : { ...e, kind });
  }
  return out;
}

/** The groups results are listed in, with the item kinds each one holds. */
export const SEARCH_GROUPS: readonly { id: string; label: string; kinds: readonly string[] }[] = [
  { id: 'notes', label: 'Notes', kinds: ['note'] },
  { id: 'tasks', label: 'Tasks', kinds: ['task'] },
  { id: 'entries', label: 'Time entries', kinds: ['entry'] },
  { id: 'projects', label: 'Projects and clients', kinds: ['project', 'client'] },
  { id: 'tags', label: 'Tags', kinds: ['tag'] },
];

/**
 * A page to land on once a result is opened: the page may not be mounted yet, so the target waits
 * here until the page asks for it (`useSearchTarget`) and is also announced for a page already open.
 */
export interface SearchTarget {
  kind: string;
  spaceId: string;
  id: string;
  /** Milliseconds, for an entry: the day to show. */
  at?: number;
}

const EVENT = 'app:search-target';
let pending: SearchTarget | null = null;

export function setSearchTarget(target: SearchTarget): void {
  pending = target;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls `handle` with the waiting target when its kind is one of `kinds`, on mount and whenever a new one is set. */
export function useSearchTarget(kinds: readonly string[], handle: (target: SearchTarget) => void): void {
  useEffect(() => {
    const take = (): void => {
      if (pending && kinds.includes(pending.kind)) {
        const t = pending;
        pending = null;
        handle(t);
      }
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
