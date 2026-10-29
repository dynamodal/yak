import { STORAGE_PREFIX } from '../constants';

/** One entry of `docs/user/changes.md` or a `docs/user/changes/*.md` file: `## <id>: <title>` and its bullets (Markdown). */
export interface Change {
  /** The date, for example `2026-10-19`; entries are newest first and ids sort by time. */
  id: string;
  title: string;
  body: string;
}

const SEEN_KEY = `${STORAGE_PREFIX}-changes-seen`;
const NOTICE_KEY = `${STORAGE_PREFIX}-alpha-notice`;

export function parseChanges(source: string): Change[] {
  return source
    .split(/^##\s+/m)
    .slice(1)
    .map((chunk) => {
      const [head = '', ...rest] = chunk.split('\n');
      const m = /^(\d{4}-\d{2}-\d{2})\s*:?\s*(.*)$/.exec(head.trim());
      return m ? { id: m[1] as string, title: (m[2] ?? '').trim(), body: rest.join('\n').trim() } : undefined;
    })
    .filter((c): c is Change => c !== undefined)
    // Newest date first; entries of one date keep the file's order (already newest first), so they never swap.
    .sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? 1 : -1));
}

/** A fragment file name: `YYYY-MM-DD-HHMM-<slug>.md` (UTC time of writing). Other names are ignored. */
export const FRAGMENT_NAME = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

/**
 * All entries, newest first: the archive (`changes.md`) plus one file per entry (`changes/*.md`, keyed by path).
 * Same date: fragments before archive entries, fragments by file name descending, so the order never depends on merge order.
 */
export function mergeChanges(archive: string, fragments: Record<string, string>): Change[] {
  const named = Object.entries(fragments)
    .map(([path, src]) => [path.replace(/^.*\//, ''), src] as const)
    .filter(([name]) => FRAGMENT_NAME.test(name))
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
  const all = [...named.flatMap(([, src]) => parseChanges(src)), ...parseChanges(archive)];
  return all.sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? 1 : -1));
}

/** What a device stores as seen: the date and title of the newest entry, so a new entry on an already-seen date still counts as new. */
export const changeToken = (c: Change | undefined): string | undefined => (c ? `${c.id} ${c.title}` : undefined);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the dot and the notice come back on the next start.
  }
}

const listeners = new Set<() => void>();

/** The newest entry this device has looked at. A device with no record starts up to date: nothing is new to it. */
export function changesSeen(newest: string | undefined): string {
  const stored = read(SEEN_KEY);
  if (stored !== null) return stored;
  if (newest) write(SEEN_KEY, newest);
  return newest ?? '';
}

export function hasNewChanges(newest: string | undefined): boolean {
  // Inequality, not `<`: a stored value later than every known entry (an entry whose date was corrected) is stale and counts as unseen.
  return !!newest && changesSeen(newest) !== newest;
}

export function markChangesSeen(newest: string | undefined): void {
  if (!newest || read(SEEN_KEY) === newest) return;
  write(SEEN_KEY, newest);
  for (const l of listeners) l();
}

export function onChangesSeen(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const alphaNoticeSeen = (): boolean => read(NOTICE_KEY) === 'seen';
export const markAlphaNoticeSeen = (): void => write(NOTICE_KEY, 'seen');
