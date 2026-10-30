import * as Y from 'yjs';
import { attachmentsMap } from './blobs/attachments';
import { collection, nowIso, type CollectionName } from './schema';

/**
 * Recently deleted (#107, docs/design/backup-history-model.md): every kind of record is kept for
 * `TRASH_DAYS` after a delete and can be restored until then; Delete for good clears it on every device.
 *
 * - A delete sets `deleted: true` and stamps `deleted_at` (ISO). A record deleted before the stamp existed
 *   (projects, clients, tags, files) has none: it reads as "date unknown" and never expires by itself.
 *   Time entries without the stamp were never restorable (moves leave none), and notes fall back on `updated_at`, as before.
 * - Delete for good keeps the record as a tombstone: `deleted: true` and `purged_at`, every other field removed.
 *   Keeping the key, rather than deleting it from the map, keeps a stale copy on another device from looking new.
 * - No migration (F39): every field is optional and older builds already skip deleted records.
 */

export const TRASH_DAYS = 45;
export const TRASH_MS = TRASH_DAYS * 86_400_000;

/** The kinds Recently deleted lists. `files` are the `attachments` index of a space; the rest are collections. */
export type TrashKind = 'time_entries' | 'notes' | 'projects' | 'clients' | 'tags' | 'files';

export const TRASH_KINDS: readonly TrashKind[] = ['time_entries', 'notes', 'projects', 'clients', 'tags', 'files'];

export interface TrashItem {
  kind: TrashKind;
  id: string;
  /** What the person knows it by: a description, a note path, a name. */
  title: string;
  /** When it was deleted (ms); `null` when the record predates the stamp. */
  deletedAt: number | null;
  /** When it leaves the list (and, for files, when the bytes go); `null` never, by itself. */
  expiresAt: number | null;
  /** Plain fields of the record, for the kinds' own display (entry start and duration, file size). */
  fields: Record<string, unknown>;
}

function recordMap(doc: Y.Doc, kind: TrashKind): Y.Map<Y.Map<unknown>> {
  return kind === 'files' ? attachmentsMap(doc) : collection(doc, kind as CollectionName);
}

const ms = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : NaN);

export function isPurged(rec: Y.Map<unknown>): boolean {
  return rec.has('purged_at');
}

/**
 * When a deleted record was deleted, or `null` for "date unknown". Notes also count `updated_at`, which an
 * older build sets on a delete: the later of the two wins, so a stamp left over from an earlier delete
 * and restore by such a build does not shorten the window.
 */
export function deletedAtMs(kind: TrashKind, rec: Y.Map<unknown>): number | null {
  const at = ms(rec.get('deleted_at'));
  if (kind === 'notes') {
    const updated = ms(rec.get('updated_at'));
    const best = Math.max(Number.isFinite(at) ? at : -Infinity, Number.isFinite(updated) ? updated : -Infinity);
    return Number.isFinite(best) ? best : null;
  }
  return Number.isFinite(at) ? at : null;
}

/**
 * Whether a record is in Recently deleted at `now`: deleted, not deleted for good, not merged into another,
 * and inside the window. Without a date: listed for projects, clients, tags and files; not for time
 * entries (a move to another space leaves its original unstamped on purpose) or notes (nothing to go by).
 */
export function inTrash(kind: TrashKind, rec: Y.Map<unknown>, now: number = Date.now()): boolean {
  if (rec.get('deleted') !== true || isPurged(rec) || rec.get('merged') === true) return false;
  if (kind === 'files' && typeof rec.get('name') !== 'string') return false;
  const at = deletedAtMs(kind, rec);
  if (at === null) return kind !== 'time_entries' && kind !== 'notes';
  return now - at < TRASH_MS && now - at >= -TRASH_MS;
}

function titleOf(kind: TrashKind, rec: Y.Map<unknown>): string {
  const str = (k: string): string => (typeof rec.get(k) === 'string' ? (rec.get(k) as string) : '');
  if (kind === 'time_entries') return str('description');
  if (kind === 'notes') return str('path');
  return str('name');
}

function plain(rec: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  rec.forEach((v, k) => {
    out[k] = v instanceof Y.AbstractType ? undefined : v;
  });
  return out;
}

/** What Recently deleted lists of one kind in one document, newest first; "date unknown" last. */
export function trashItems(doc: Y.Doc, kind: TrashKind, now: number = Date.now()): TrashItem[] {
  const out: TrashItem[] = [];
  recordMap(doc, kind).forEach((rec, id) => {
    if (!(rec instanceof Y.Map) || !inTrash(kind, rec, now)) return;
    const deletedAt = deletedAtMs(kind, rec);
    out.push({ kind, id, title: titleOf(kind, rec), deletedAt, expiresAt: deletedAt === null ? null : deletedAt + TRASH_MS, fields: plain(rec) });
  });
  return out.sort((a, b) => (b.deletedAt ?? -Infinity) - (a.deletedAt ?? -Infinity) || (a.id < b.id ? -1 : 1));
}

/** Soft delete with the stamp, for every kind. Returns false when the record is not on this device. */
export function trashRecord(doc: Y.Doc, kind: TrashKind, id: string, now: number = Date.now()): boolean {
  const rec = recordMap(doc, kind).get(id);
  if (!rec) return false;
  doc.transact(() => {
    rec.set('deleted', true);
    rec.set('deleted_at', new Date(now).toISOString());
    if (rec.has('updated_at')) rec.set('updated_at', new Date(now).toISOString());
  });
  return true;
}

export type TrashResult = { ok: true } | { ok: false; error: string };

/**
 * Bring a record back from Recently deleted. A file gets a free name if another live file took its name
 * meanwhile (names are unique, N-166f). Refused once it was deleted for good or the window has passed.
 */
export function restoreRecord(doc: Y.Doc, kind: TrashKind, id: string, now: number = Date.now()): TrashResult {
  const rec = recordMap(doc, kind).get(id);
  if (!rec || isPurged(rec)) return { ok: false, error: 'It was deleted for good and can no longer be restored.' };
  if (rec.get('deleted') !== true) return { ok: true };
  if (!inTrash(kind, rec, now)) return { ok: false, error: `Deleted more than ${TRASH_DAYS} days ago; it can no longer be restored.` };
  doc.transact(() => {
    if (kind === 'files') {
      const name = String(rec.get('name'));
      const taken = new Set<string>();
      attachmentsMap(doc).forEach((m, h) => {
        if (h !== id && m.get('deleted') !== true && typeof m.get('name') === 'string') taken.add((m.get('name') as string).toLowerCase());
      });
      if (taken.has(name.toLowerCase())) rec.set('name', freeName(name, taken));
    }
    rec.set('deleted', false);
    rec.delete('deleted_at');
    if (rec.has('updated_at')) rec.set('updated_at', nowIso());
  });
  return { ok: true };
}

/** `photo.png` → `photo 2.png`, … against lower-cased taken names (the rule of `uniqueFileName`). */
function freeName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Delete for good: every field but `deleted` is removed (a note's text with it) and `purged_at` marks the
 * tombstone, on every device once it syncs. Only a deleted record can be purged. Older backups and this
 * device's Version history may still hold a copy; the confirmation says so. A file's bytes go with the sweep.
 */
export function purgeRecord(doc: Y.Doc, kind: TrashKind, id: string, now: number = Date.now()): boolean {
  const rec = recordMap(doc, kind).get(id);
  if (!rec || rec.get('deleted') !== true) return false;
  doc.transact(() => {
    for (const key of [...rec.keys()]) if (key !== 'deleted') rec.delete(key);
    rec.set('purged_at', new Date(now).toISOString());
  });
  return true;
}

/** Account setting (synced, B-107): a deleted file is deleted for good at once, bytes included, instead of kept for `TRASH_DAYS`. Default off. */
export const DELETE_FILES_NOW = 'delete_files_now';

export function readDeleteFilesNow(account: Y.Doc | undefined): boolean {
  return account?.getMap<unknown>('settings').get(DELETE_FILES_NOW) === true;
}

export function writeDeleteFilesNow(account: Y.Doc, on: boolean): void {
  account.getMap<unknown>('settings').set(DELETE_FILES_NOW, on);
}
