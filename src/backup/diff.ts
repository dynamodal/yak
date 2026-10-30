import * as Y from 'yjs';
import type { DocUpdate } from './restore';

/**
 * What restoring a backup would change, compared with this device now (#96).
 *
 * Merge is simulated, not guessed: a copy of each current document takes in the backup's update, and the
 * result is compared with now. Replace makes the device exactly the backup, so it is the backup compared
 * with now; documents the backup lacks end up empty.
 *
 * Only what a person can see counts: live records (deleted ones, Recently deleted included, count as gone,
 * and a contentless "deleted for good" marker is never listed). Work yields to the browser every few hundred
 * records so a large backup does not freeze the page.
 */

export type DiffKind = 'time_entries' | 'notes' | 'projects' | 'clients' | 'tags' | 'files' | 'settings';

export const DIFF_KINDS: readonly DiffKind[] = ['time_entries', 'notes', 'projects', 'clients', 'tags', 'files', 'settings'];

export interface DiffItem {
  kind: DiffKind;
  docId: string;
  id: string;
  /** What the person knows it by: a description, a note path, a name, a setting's key. */
  title: string;
  /** Start of a time entry (ISO), to tell entries with the same description apart. */
  start?: string;
}

export interface DiffSide {
  added: DiffItem[];
  removed: DiffItem[];
  changed: DiffItem[];
}

export interface BackupDiff {
  merge: DiffSide;
  replace: DiffSide;
}

export interface DiffOptions {
  /** Records handled between two yields to the browser. */
  chunk?: number;
  signal?: AbortSignal;
}

const COLLECTIONS = ['time_entries', 'notes', 'projects', 'clients', 'tags'] as const;

interface Seen {
  item: DiffItem;
  /** The record's content; equal strings mean the same record. */
  print: string;
}

type Records = Map<string, Seen>;

/** Let the browser paint and handle input. `scheduler.yield` where the browser has it, else a macrotask. */
export function yieldToBrowser(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A root map by name, without redefining a root of another type (the same care as the snapshot export). */
function rootMap(doc: Y.Doc, name: string): Y.Map<unknown> | undefined {
  const existing = doc.share.get(name);
  if (existing instanceof Y.Map) return existing;
  if (existing?.constructor === Y.AbstractType) return doc.getMap(name);
  return undefined;
}

function plain(v: unknown): unknown {
  return v instanceof Y.AbstractType ? v.toJSON() : v;
}

/** A record's content in a stable form (keys sorted), so equal records print the same. */
function print(rec: Y.Map<unknown>): string {
  const keys = [...rec.keys()].sort();
  return JSON.stringify(keys.map((k) => [k, plain(rec.get(k))]));
}

function str(rec: Y.Map<unknown>, key: string): string {
  const v = rec.get(key);
  return typeof v === 'string' ? v : '';
}

function live(kind: DiffKind, rec: unknown): rec is Y.Map<unknown> {
  if (!(rec instanceof Y.Map) || rec.get('deleted') === true || rec.has('purged_at')) return false;
  return kind !== 'files' || typeof rec.get('name') === 'string';
}

class Collector {
  private count = 0;
  constructor(private readonly opts: DiffOptions) {}

  async tick(): Promise<void> {
    if (++this.count % (this.opts.chunk ?? 300) === 0) await this.pause();
  }

  async pause(): Promise<void> {
    await yieldToBrowser();
    if (this.opts.signal?.aborted) throw new DOMException('The comparison was stopped.', 'AbortError');
  }

  async records(docId: string, doc: Y.Doc | undefined, out: Records): Promise<void> {
    if (!doc) return;
    for (const kind of [...COLLECTIONS, 'files'] as const) {
      const map = rootMap(doc, kind === 'files' ? 'attachments' : kind);
      if (!map) continue;
      for (const [id, rec] of map) {
        await this.tick();
        if (!live(kind, rec)) continue;
        const title = kind === 'time_entries' ? str(rec, 'description') : kind === 'notes' ? str(rec, 'path') : str(rec, 'name');
        const item: DiffItem = { kind, docId, id, title };
        if (kind === 'time_entries' && str(rec, 'start')) item.start = str(rec, 'start');
        out.set(`${kind}\u0000${docId}\u0000${id}`, { item, print: print(rec) });
      }
    }
    const settings = rootMap(doc, 'settings');
    settings?.forEach((v, key) => {
      if (v === undefined || v === null) return;
      out.set(`settings\u0000${docId}\u0000${key}`, { item: { kind: 'settings', docId, id: key, title: key }, print: JSON.stringify(plain(v)) });
    });
  }
}

function compare(from: Records, to: Records): DiffSide {
  const side: DiffSide = { added: [], removed: [], changed: [] };
  for (const [key, b] of to) {
    const a = from.get(key);
    if (!a) side.added.push(b.item);
    else if (a.print !== b.print) side.changed.push(b.item);
  }
  for (const [key, a] of from) if (!to.has(key)) side.removed.push(a.item);
  return side;
}

function docFrom(updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
}

/**
 * Compare a verified backup's documents with the current ones. `current` holds the documents a backup of
 * this device would hold (log documents left out); the given documents are only read.
 */
export async function diffBackup(current: ReadonlyMap<string, Y.Doc>, backup: readonly DocUpdate[], opts: DiffOptions = {}): Promise<BackupDiff> {
  const c = new Collector(opts);
  const now: Records = new Map();
  const merged: Records = new Map();
  const replaced: Records = new Map();
  const inBackup = new Map(backup.map((d) => [d.id, d.update]));
  for (const id of new Set([...current.keys(), ...inBackup.keys()])) {
    const here = current.get(id);
    const update = inBackup.get(id);
    await c.records(id, here, now);
    if (!update) {
      // Merge leaves a document the backup lacks as it is; Replace leaves it empty.
      await c.records(id, here, merged);
      continue;
    }
    await c.pause();
    const after = docFrom(here ? [Y.encodeStateAsUpdate(here), update] : [update]);
    await c.records(id, after, merged);
    after.destroy();
    await c.pause();
    const exact = docFrom([update]);
    await c.records(id, exact, replaced);
    exact.destroy();
  }
  return { merge: compare(now, merged), replace: compare(now, replaced) };
}

export type KindCounts = Record<DiffKind, number>;

export function countByKind(items: readonly DiffItem[]): KindCounts {
  const out = Object.fromEntries(DIFF_KINDS.map((k) => [k, 0])) as KindCounts;
  for (const i of items) out[i.kind]++;
  return out;
}

const NAMES: Record<DiffKind, [string, string]> = {
  time_entries: ['time entry', 'time entries'],
  notes: ['note or task', 'notes and tasks'],
  projects: ['project', 'projects'],
  clients: ['client', 'clients'],
  tags: ['tag', 'tags'],
  files: ['file in notes', 'files in notes'],
  settings: ['setting', 'settings'],
};

export function kindName(kind: DiffKind, n: number): string {
  return NAMES[kind][n === 1 ? 0 : 1];
}

/** "3 time entries, 1 note or task"; "nothing" when every count is zero. */
export function countsText(items: readonly DiffItem[]): string {
  const counts = countByKind(items);
  const parts = DIFF_KINDS.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${kindName(k, counts[k])}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

export function sideIsEmpty(side: DiffSide): boolean {
  return side.added.length === 0 && side.removed.length === 0 && side.changed.length === 0;
}
