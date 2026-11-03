import { bulkEdit } from '../core/bulk';
import { collection } from '../core/schema';
import { isoToMs } from './dates';
import { editEntry, splitEntry } from './entries';
import { MIN_OVERLAP_MS, clockText } from './timeline';
import type { Spaces } from './bulk-edit';

/**
 * The fixes for gaps and overlaps (#68, slice 2). `plan…` functions are pure: from the entries as they are now
 * they say which edits to make, or why none is possible. Real time throughout (epoch milliseconds), so midnight
 * and daylight-saving days need no special case. A fix never stops a running timer: setting a stop on one is
 * refused, while moving its start or splitting before now leaves it running.
 */

/** An entry as the fixes see it; `end` is `null` while it runs. */
export interface FixEntry {
  id: string;
  spaceId: string;
  start: number;
  end: number | null;
  title: string;
}

export interface Ref {
  spaceId: string;
  id: string;
}

export type Step =
  | { kind: 'edit'; entry: FixEntry; start?: number; stop?: number }
  /** Split `entry` at `at`, then end its first part at `trimTo` (so nothing is deleted). */
  | { kind: 'split'; entry: FixEntry; at: number; trimTo: number };

export type Plan = { ok: true; message: string; steps: Step[] } | { ok: false; reason: string };

export interface GapSpan {
  start: number;
  end: number;
}

const name = (e: FixEntry): string => `"${e.title || '(no description)'}"`;
const fail = (reason: string): Plan => ({ ok: false, reason });
const CHANGED = 'The entries changed since the calendar was drawn. Nothing was edited.';

/** Move the end of the entry before a gap forward to the gap's end. */
export function planExtendPrevious(prev: FixEntry | undefined, gap: GapSpan): Plan {
  if (!prev) return fail('That entry no longer exists.');
  if (prev.end === null) return fail(`${name(prev)} is running.`);
  if (prev.end !== gap.start) return fail(CHANGED);
  return { ok: true, message: `Extended ${name(prev)} to ${clockText(gap.end)}.`, steps: [{ kind: 'edit', entry: prev, stop: gap.end }] };
}

/** Move the start of the entry after a gap back to the gap's start. A running entry stays running. */
export function planStartNextEarlier(next: FixEntry | undefined, gap: GapSpan): Plan {
  if (!next) return fail('That entry no longer exists.');
  if (next.start !== gap.end) return fail(CHANGED);
  return { ok: true, message: `Started ${name(next)} at ${clockText(gap.start)}.`, steps: [{ kind: 'edit', entry: next, start: gap.start }] };
}

type Pair = { first: FixEntry; second: FixEntry };

/** The two entries ordered by start; `undefined` when either is gone or they no longer share a minute. */
function ordered(a: FixEntry | undefined, b: FixEntry | undefined, now: number): Pair | string {
  if (!a || !b) return 'That entry no longer exists.';
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  const shared = Math.min(first.end ?? now, second.end ?? now) - second.start;
  return shared >= MIN_OVERLAP_MS ? { first, second } : 'These entries no longer overlap. Nothing was edited.';
}

/** End the first entry where the second starts. Not possible while the first runs, or when it would be left empty. */
export function planTrimFirst(a: FixEntry | undefined, b: FixEntry | undefined, now: number): Plan {
  const pair = ordered(a, b, now);
  if (typeof pair === 'string') return fail(pair);
  const { first, second } = pair;
  if (first.end === null) return fail(`${name(first)} is running, so it cannot be ended earlier without stopping it.`);
  if (second.start <= first.start) return fail(`${name(first)} would be left empty.`);
  if (second.end !== null && second.end < first.end) return fail(`${name(second)} is inside ${name(first)}; ending it would drop the rest.`);
  return { ok: true, message: `Ended ${name(first)} at ${clockText(second.start)}.`, steps: [{ kind: 'edit', entry: first, stop: second.start }] };
}

/** Start the second entry where the first ends. Not possible while the first runs, or when it would be left empty. */
export function planTrimSecond(a: FixEntry | undefined, b: FixEntry | undefined, now: number): Plan {
  const pair = ordered(a, b, now);
  if (typeof pair === 'string') return fail(pair);
  const { first, second } = pair;
  if (first.end === null) return fail(`${name(first)} is running, so there is no end to start ${name(second)} after.`);
  if ((second.end ?? now) <= first.end) return fail(`${name(second)} is inside ${name(first)}; starting it later would leave nothing.`);
  return { ok: true, message: `Started ${name(second)} at ${clockText(first.end)}.`, steps: [{ kind: 'edit', entry: second, start: first.end }] };
}

/** Whether `inner` lies strictly inside `outer` (an end of the outer one is left on each side). */
export function isInside(outer: FixEntry, inner: FixEntry, now: number): boolean {
  return inner.end !== null && inner.start > outer.start && inner.end < (outer.end ?? now + 1);
}

/** Split the outer entry around the inner one: the outer keeps the time before it and gets a new part for the time after. */
export function planSplitAround(outerEntry: FixEntry | undefined, innerEntry: FixEntry | undefined, now: number): Plan {
  const pair = ordered(outerEntry, innerEntry, now);
  if (typeof pair === 'string') return fail(pair);
  const outer = outerEntry as FixEntry;
  const inner = innerEntry as FixEntry;
  if (!isInside(outer, inner, now)) return fail(`${name(inner)} is not inside ${name(outer)}.`);
  return {
    ok: true,
    message: `Split ${name(outer)} around ${name(inner)}.`,
    steps: [{ kind: 'split', entry: outer, at: inner.end as number, trimTo: inner.start }],
  };
}

// ------------------------------------------------------------------ applying

export type Reader = (ref: Ref) => FixEntry | undefined;

/** The entry as it is in its document right now, or `undefined` when it is gone. */
export function readFix(spaces: Spaces, ref: Ref): FixEntry | undefined {
  const handle = spaces.get(ref.spaceId);
  const rec = handle ? collection(handle.privateDoc, 'time_entries').get(ref.id) : undefined;
  if (!rec || rec.get('deleted') === true) return undefined;
  const start = isoToMs(rec.get('start') as string);
  const stop = rec.get('stop') as string | null | undefined;
  const end = stop === null || stop === undefined ? null : isoToMs(stop);
  if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end))) return undefined;
  return { id: ref.id, spaceId: ref.spaceId, start, end, title: (rec.get('description') as string | undefined) ?? '' };
}

export type FixResult = { ok: true; message: string; undo(): void } | { ok: false; reason: string };

/**
 * Plan from the entries as they are now (sync may have changed them since the view drew), then make the edits as one
 * transaction in the entry's own space document, with one Undo. If an edit is refused, the ones made are undone.
 */
export function runFix(spaces: Spaces, deviceId: string, planner: (read: Reader) => Plan, now: number = Date.now()): FixResult {
  const plan = planner((ref) => readFix(spaces, ref));
  if (!plan.ok) return plan;
  const handle = spaces.get(plan.steps[0]?.entry.spaceId ?? '');
  if (!handle) return { ok: false, reason: 'That space is not on this device.' };
  const { result, undo } = bulkEdit([handle.privateDoc], (tx) => {
    let error = '';
    tx(handle.privateDoc, () => {
      for (const step of plan.steps) {
        if (error) break;
        const r = step.kind === 'edit' ? editEntry(handle.privateDoc, step.entry.id, { ...(step.start !== undefined && { start: step.start }), ...(step.stop !== undefined && { stop: step.stop }) }) : splitEntry(handle.privateDoc, deviceId, step.entry.id, step.at, now);
        if (!r.ok) error = r.error;
        else if (step.kind === 'split') {
          const t = editEntry(handle.privateDoc, step.entry.id, { stop: step.trimTo });
          if (!t.ok) error = t.error;
        }
      }
    });
    return error;
  });
  if (result) {
    undo();
    return { ok: false, reason: result };
  }
  return { ok: true, message: plan.message, undo };
}
