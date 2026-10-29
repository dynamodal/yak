import { isCompleted, isTaskProps, localDate, type Task } from './tasks';
import type { NoteInfo } from './note-store';

/** How far ahead Home's "Due soon" looks, in days (overdue tasks always show). */
export const DUE_SOON_DAYS = 7;

/**
 * Tasks to show under "Due soon": open ones that are late or due within `days` days, soonest first.
 * `keep` holds tasks just checked off on Home: they stay in the list (checked) so the row does not vanish under the pointer.
 */
export function dueSoon(tasks: readonly Task[], now: Date, keep: ReadonlySet<string> = new Set(), days: number = DUE_SOON_DAYS): Task[] {
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const last = localDate(limit);
  const picked = tasks.filter((t) => {
    if (t.archived) return false;
    if (isCompleted(t.status)) return keep.has(t.id);
    const d = t.due.slice(0, 10);
    return d !== '' && d <= last;
  });
  // Soonest first; a task just checked off keeps its place.
  return picked.sort((a, b) => (a.due.slice(0, 10) < b.due.slice(0, 10) ? -1 : a.due.slice(0, 10) > b.due.slice(0, 10) ? 1 : a.title.localeCompare(b.title)));
}

/** A due date for a row: "Late · 25 Oct", "Today", "Tomorrow", "Fri 31 Oct". */
export function dueLabel(due: string, now: Date): { text: string; late: boolean } {
  const day = due.slice(0, 10);
  const today = localDate(now);
  const tomorrow = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  const short = `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.getDate()} ${date.toLocaleDateString('en-US', { month: 'short' })}`;
  if (day < today) return { text: `Late · ${short}`, late: true };
  if (day === today) return { text: 'Today', late: false };
  if (day === tomorrow) return { text: 'Tomorrow', late: false };
  return { text: short, late: false };
}

/** The most recently changed notes that are not tasks, newest first. */
export function recentNotes<T extends Pick<NoteInfo, 'parsed' | 'updated_at'>>(notes: readonly T[], limit: number): T[] {
  return notes
    .filter((n) => !isTaskProps(n.parsed.properties))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
    .slice(0, limit);
}

/** When a note changed: "Today", "Yesterday", else "28 Oct". */
export function changedLabel(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const today = localDate(now);
  if (localDate(d) === today) return 'Today';
  if (localDate(d) === localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
}
