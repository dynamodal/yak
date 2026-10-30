import * as Y from 'yjs';
import type { NewSegment, Segment, SegmentStore } from './types';

const DAY = 86_400_000;

export interface ThinningPolicy {
  /** Segments younger than this stay as they are. */
  fineDays: number;
  /** Segments older than `fineDays` and younger than this are merged into one per day. */
  dailyDays: number;
}

/** Owner's answer H1: every change for 60 days, then one per day up to a year, then one per month. */
const DEFAULT_POLICY: ThinningPolicy = { fineDays: 60, dailyDays: 365 };

const pad = (n: number): string => String(n).padStart(2, '0');

/** The bucket a segment belongs to by age; null when it stays fine-grained. */
export function bucketOf(seg: Pick<Segment, 'end'>, now: number, policy: ThinningPolicy = DEFAULT_POLICY): string | null {
  const age = now - seg.end;
  const d = new Date(seg.end);
  if (age < policy.fineDays * DAY) return null;
  if (age < policy.dailyDays * DAY) return `d${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `m${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Runs of neighbouring segments in the same bucket; only runs of two or more are worth merging. */
export function planThinning(segments: readonly Segment[], now: number, policy: ThinningPolicy = DEFAULT_POLICY, cuts: readonly number[] = []): Segment[][] {
  const runs: Segment[][] = [];
  let current: Segment[] = [];
  let key: string | null = null;
  let prev: Segment | undefined;
  for (const s of segments) {
    const b = bucketOf(s, now, policy);
    // A "Before restore" mark at time `c` stays a point: segments up to `c` never merge with later ones.
    const cut = prev !== undefined && cuts.some((c) => prev !== undefined && prev.end <= c && s.end > c);
    prev = s;
    if (b !== null && b === key && !cut) current.push(s);
    else {
      if (current.length > 1) runs.push(current);
      current = b === null ? [] : [s];
      key = b;
    }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

/** Merge old runs of segments; the content is kept, only the time inside a merged span is lost. */
export async function thinDocument(store: SegmentStore, docId: string, now: number, policy: ThinningPolicy = DEFAULT_POLICY): Promise<number> {
  const cuts = (await store.marks(docId)).filter((m) => m.kind === 'before-restore').map((m) => m.at);
  const runs = planThinning(await store.list(docId), now, policy, cuts);
  for (const run of runs) {
    const merged: NewSegment = {
      docId,
      start: Math.min(...run.map((s) => s.start)),
      end: Math.max(...run.map((s) => s.end)),
      update: Y.mergeUpdates(run.map((s) => s.update)),
      local: run.some((s) => s.local),
      baseline: run.some((s) => s.baseline),
    };
    await store.replace(docId, run.map((s) => s.seq), merged);
  }
  return runs.length;
}

export async function thinAll(store: SegmentStore, now: number, policy: ThinningPolicy = DEFAULT_POLICY): Promise<number> {
  let n = 0;
  for (const id of await store.docIds()) n += await thinDocument(store, id, now, policy);
  return n;
}
