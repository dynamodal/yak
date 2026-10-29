import type * as Y from 'yjs';
import { liveRecords, type TimeEntry } from './schema';

/**
 * Seconds tracked per task id: the live entries whose `task_id` names the task, in every document given.
 * A running entry counts up to `now`. Read-only; the Tasks views show it when Time is on (F-33v).
 */
export function trackedByTask(docs: Iterable<Y.Doc>, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const doc of docs) {
    for (const e of liveRecords<TimeEntry>(doc, 'time_entries')) {
      if (!e.task_id) continue;
      const start = Date.parse(e.start);
      const end = e.stop === null || e.stop === undefined ? now : Date.parse(e.stop);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      out.set(e.task_id, (out.get(e.task_id) ?? 0) + Math.max(0, Math.round((end - start) / 1000)));
    }
  }
  return out;
}

/** "1 h 30 m", "45 m", "< 1 m" (for 0 s too: an entry exists); empty when `seconds` is undefined, i.e. no entry names the task. */
export function formatTracked(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  if (m < 1) return '< 1 m';
  const h = Math.floor(m / 60);
  return h > 0 ? (m % 60 ? `${h} h ${m % 60} m` : `${h} h`) : `${m} m`;
}
