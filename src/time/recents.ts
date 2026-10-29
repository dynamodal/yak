// The pill popover's "Recent" list: pure, so it is unit tested without a DOM.
import { isoToMs } from './dates';
import { type EntryRecord, isRunning, liveEntries, startMs, type TimeDocs } from './entries';

export interface RecentItem {
  spaceId: string;
  entry: EntryRecord;
  /** When it stopped (ms); the list is ordered by it. */
  stoppedAt: number;
}

export interface Recents {
  /** The entry that stopped last, in any space (the "Continue" row); undefined when nothing was tracked or it is the running one's twin. */
  last: RecentItem | undefined;
  /** Further distinct combinations, most recent first, never the running one or `last`. */
  others: RecentItem[];
}

/** What makes two entries the same pick: description (case and spacing ignored), project, tags in any order, and the space. Billable is not part of it. */
export function recentKey(e: Pick<EntryRecord, 'description' | 'project_id' | 'tags'>, spaceId: string): string {
  const tags = [...e.tags].map((t) => t.toLowerCase()).sort();
  return JSON.stringify([e.description.trim().replace(/\s+/g, ' ').toLowerCase(), e.project_id ?? '', tags, spaceId]);
}

/**
 * The recent list across every space. `running` is the running entry (if any): its combination is left out, because
 * picking it would change nothing. Deleted entries and entries without a stop time never appear; an entry with no
 * description, project or tags is skipped from `others` (nothing to pick), but can still be `last`.
 */
export function buildRecents(docs: TimeDocs, opts: { limit?: number; running?: { entry: EntryRecord; spaceId: string } } = {}): Recents {
  const limit = opts.limit ?? 5;
  const stopped: RecentItem[] = [];
  for (const [spaceId, doc] of docs) {
    for (const entry of liveEntries(doc)) {
      if (isRunning(entry)) continue;
      const stoppedAt = isoToMs(entry.stop);
      if (Number.isNaN(stoppedAt)) continue;
      stopped.push({ spaceId, entry, stoppedAt });
    }
  }
  stopped.sort((a, b) => b.stoppedAt - a.stoppedAt || startMs(b.entry) - startMs(a.entry) || (a.entry.id < b.entry.id ? 1 : -1));
  const skip = opts.running ? recentKey(opts.running.entry, opts.running.spaceId) : undefined;
  const seen = new Set<string>(skip ? [skip] : []);
  let last: RecentItem | undefined;
  const others: RecentItem[] = [];
  const first = stopped[0];
  if (first && recentKey(first.entry, first.spaceId) !== skip) last = first;
  if (last) seen.add(recentKey(last.entry, last.spaceId));
  for (const item of stopped) {
    if (others.length >= limit) break;
    const e = item.entry;
    if (!e.description.trim() && !e.project_id && e.tags.length === 0) continue;
    const key = recentKey(e, item.spaceId);
    if (seen.has(key)) continue;
    seen.add(key);
    others.push(item);
  }
  return { last, others };
}

/** "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", then the date. */
export function relativeAgo(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(thenMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
