import * as Y from 'yjs';
import type { Segment, SegmentStore } from './types';

/** Browsing the log: days that have changes, then the points (one per segment) of a day. */

export interface DayCount {
  /** Local date, `YYYY-MM-DD`. */
  day: string;
  points: number;
}

export interface Point {
  docId: string;
  seq: number;
  start: number;
  end: number;
  /** Edited on this device (otherwise it arrived from another device). */
  local: boolean;
  /** Distinct time entries and notes (tasks included) the point touched. */
  entries: number;
  notes: number;
  /** Where the point was recorded. Every point has one, so a log that syncs later can name other devices. */
  source: string;
  /** Set on a mark rather than a change: "Before restore". */
  mark?: string;
}

/** What `source` says for points recorded here. */
export const THIS_DEVICE = 'This device';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day of a time. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isChange = (s: Segment): boolean => !s.baseline;

/** Days with at least one change in any of the documents, newest first. Reads segment headers only. */
export async function historyDays(store: SegmentStore, docIds: readonly string[]): Promise<DayCount[]> {
  const days = new Map<string, number>();
  for (const id of docIds) {
    for (const s of await store.list(id)) if (isChange(s)) days.set(dayOf(s.start), (days.get(dayOf(s.start)) ?? 0) + 1);
  }
  return [...days].map(([day, points]) => ({ day, points })).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** The record id under a top-level collection that a changed type belongs to, with the collection's name. */
function recordOf(type: Y.AbstractType<unknown>): { name: string; id: string } | null {
  let node: Y.AbstractType<unknown> = type;
  for (;;) {
    const item = node._item;
    if (!item) return null;
    const parent = item.parent as Y.AbstractType<unknown>;
    if (!parent._item) {
      for (const [name, t] of parent.doc?.share ?? []) if (t === parent) return item.parentSub ? { name, id: item.parentSub } : null;
      return null;
    }
    node = parent;
  }
}

/**
 * The points of one day, oldest first, each summarised by what it touched. Earlier segments are
 * replayed without counting so the day's edits apply on top of the right state.
 */
export async function dayPoints(store: SegmentStore, docIds: readonly string[], day: string): Promise<Point[]> {
  const out: Point[] = [];
  for (const docId of docIds) {
    const doc = new Y.Doc();
    const entries = new Set<string>();
    const notes = new Set<string>();
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      const touch = (name: string, id: string): void => {
        if (name === 'time_entries') entries.add(id);
        else if (name === 'notes') notes.add(id);
      };
      for (const [type, keys] of tr.changed) {
        const t = type as Y.AbstractType<unknown>;
        if (t._item) {
          const r = recordOf(t);
          if (r) touch(r.name, r.id);
        } else for (const [name, top] of doc.share) if (top === t) for (const id of keys) if (id) touch(name, id);
      }
    });
    for (const s of await store.list(docId)) {
      const mine = isChange(s) && dayOf(s.start) === day;
      entries.clear();
      notes.clear();
      Y.applyUpdate(doc, s.update);
      if (mine) out.push({ docId, seq: s.seq, start: s.start, end: s.end, local: s.local, entries: entries.size, notes: notes.size, source: THIS_DEVICE });
    }
  }
  // A mark is written to each document it covers; show it once.
  const seen = new Set<number>();
  for (const docId of docIds) {
    for (const m of await store.marks(docId)) {
      if (m.kind !== 'before-restore' || dayOf(m.at) !== day || seen.has(m.at)) continue;
      seen.add(m.at);
      out.push({ docId, seq: -1, start: m.at, end: m.at, local: true, entries: 0, notes: 0, source: THIS_DEVICE, mark: m.name });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "3 entries · 1 note", or "Other changes" when the point touched neither. */
export function pointSummary(p: Pick<Point, 'entries' | 'notes' | 'mark'>): string {
  if (p.mark) return p.mark;
  const parts: string[] = [];
  if (p.entries > 0) parts.push(plural(p.entries, 'entry', 'entries'));
  if (p.notes > 0) parts.push(plural(p.notes, 'note', 'notes'));
  return parts.join(' · ') || 'Other changes';
}
