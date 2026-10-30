import type * as Y from 'yjs';
import { collection, createRecord, liveRecords, type TimeEntry, updateRecord } from '../core/schema';
import { TRASH_DAYS } from '../core/trash';
import { isoToMs } from './dates';

/** The user-editable fields of an entry. */
export interface EntryFields {
  description: string;
  project_id: string | null;
  task_id: string | null;
  tags: string[];
  billable: boolean;
}

/** `spaceId` is set when entries of several spaces are listed together. */
export type EntryRecord = TimeEntry & { id: string; spaceId?: string };

/**
 * Documents holding `time_entries`, by space id: the spaces' time documents (`space/<id>/time`).
 * The running-timer rule spans all of them. Projects live in the spaces' main documents.
 */
export type TimeDocs = ReadonlyMap<string, Y.Doc>;

export interface RunningRef {
  spaceId: string;
  id: string;
  entry: EntryRecord;
}

interface Failure {
  ok: false;
  error: string;
}
export type Result = { ok: true } | Failure;
export type CreateResult = { ok: true; id: string } | Failure;

export function isRunning(e: Pick<TimeEntry, 'stop'>): boolean {
  return e.stop === null || e.stop === undefined;
}

export function startMs(e: Pick<TimeEntry, 'start'>): number {
  const ms = isoToMs(e.start);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Seconds from start to stop, or to `now` while running. Never negative. */
export function entryDuration(e: Pick<TimeEntry, 'start' | 'stop'>, now: number): number {
  const end = isRunning(e) ? now : isoToMs(e.stop);
  const secs = Math.round((end - startMs(e)) / 1000);
  return Number.isNaN(secs) ? 0 : Math.max(0, secs);
}

export function entryFields(e: Partial<EntryFields>): EntryFields {
  return {
    description: e.description ?? '',
    project_id: e.project_id ?? null,
    task_id: e.task_id ?? null,
    tags: cleanTags(e.tags ?? []),
    billable: e.billable ?? false,
  };
}

/** Trim, drop empties, and drop case-insensitive duplicates while keeping the first spelling. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const name = t.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export function liveEntries(doc: Y.Doc): EntryRecord[] {
  return liveRecords<TimeEntry>(doc, 'time_entries');
}

/** Running (not deleted) entries of every space. */
export function findRunning(privateDocs: TimeDocs): RunningRef[] {
  const out: RunningRef[] = [];
  for (const [spaceId, doc] of privateDocs) {
    for (const entry of liveEntries(doc)) if (isRunning(entry)) out.push({ spaceId, id: entry.id, entry });
  }
  return out;
}

/** Oldest start first; ties by id, so every device orders the same way. */
export function compareRunning(a: RunningRef, b: RunningRef): number {
  const d = startMs(a.entry) - startMs(b.entry);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Stop an entry at a given time (not before its start). */
export function stopEntryAt(doc: Y.Doc, id: string, atMs: number): boolean {
  const record = collection(doc, 'time_entries').get(id);
  if (!record) return false;
  const start = isoToMs(record.get('start') as string);
  const at = Number.isNaN(start) ? atMs : Math.max(atMs, start);
  return updateRecord(doc, 'time_entries', id, {
    stop: new Date(at).toISOString(),
    duration: Math.max(0, Math.round((at - (Number.isNaN(start) ? at : start)) / 1000)),
  });
}

/** Stop every running entry in every space at `now`. Returns what was stopped. */
function stopAllRunning(privateDocs: TimeDocs, now: number): RunningRef[] {
  const running = findRunning(privateDocs);
  for (const r of running) {
    const doc = privateDocs.get(r.spaceId);
    if (doc) stopEntryAt(doc, r.id, now);
  }
  return running;
}

function projectDefaultBillable(doc: Y.Doc, projectId: string | null): boolean {
  if (!projectId) return false;
  const p = collection(doc, 'projects').get(projectId);
  return p ? p.get('billable') === true : false;
}

export interface StartResult {
  id: string;
  /** Entries that were running and got stopped by this start, in any space. */
  stopped: RunningRef[];
}

/**
 * Start a timer in `spaceId`. Any entry running in any space is stopped first (the later start
 * wins). `billable` defaults from the project, read from `catalogDocs` (the spaces' main
 * documents; the time documents themselves when one document holds both, as in tests).
 */
export function startTimer(
  privateDocs: TimeDocs,
  spaceId: string,
  deviceId: string,
  fields: Partial<EntryFields> = {},
  now: number = Date.now(),
  catalogDocs: TimeDocs = privateDocs,
): StartResult {
  const doc = privateDocs.get(spaceId);
  if (!doc) throw new Error(`Unknown space: ${spaceId}`);
  const stopped = stopAllRunning(privateDocs, now);
  const f = entryFields(fields);
  if (fields.billable === undefined) f.billable = projectDefaultBillable(catalogDocs.get(spaceId) ?? doc, f.project_id);
  const stamp = new Date(now).toISOString();
  const id = createRecord(doc, 'time_entries', {
    start: stamp,
    stop: null,
    duration: 0,
    ...f,
    device_id: deviceId,
    created_at: stamp,
    updated_at: stamp,
    deleted: false,
  });
  return { id, stopped };
}

export function stopTimer(doc: Y.Doc, id: string, now: number = Date.now()): boolean {
  return stopEntryAt(doc, id, now);
}

export interface ManualEntry extends Partial<EntryFields> {
  start: number;
  stop: number;
}

/** `doc` holds the entries; `catalog` (the space's main document) the projects, for the billable default. */
export function addManualEntry(doc: Y.Doc, deviceId: string, input: ManualEntry, catalog: Y.Doc = doc): CreateResult {
  if (!Number.isFinite(input.start) || !Number.isFinite(input.stop)) return { ok: false, error: 'Enter a start and a stop time.' };
  if (input.stop < input.start) return { ok: false, error: 'The stop time is before the start time.' };
  const f = entryFields(input);
  if (input.billable === undefined) f.billable = projectDefaultBillable(catalog, f.project_id);
  const stamp = new Date().toISOString();
  const id = createRecord(doc, 'time_entries', {
    start: new Date(input.start).toISOString(),
    stop: new Date(input.stop).toISOString(),
    duration: Math.round((input.stop - input.start) / 1000),
    ...f,
    device_id: deviceId,
    created_at: stamp,
    updated_at: stamp,
    deleted: false,
  });
  return { ok: true, id };
}

export interface EntryPatch extends Partial<EntryFields> {
  start?: number;
  /** A time stops a running entry; `null` is rejected (continue creates a new entry instead). */
  stop?: number | null;
}

export function editEntry(doc: Y.Doc, id: string, patch: EntryPatch): Result {
  const record = collection(doc, 'time_entries').get(id);
  if (!record) return { ok: false, error: 'That entry no longer exists.' };
  const wasRunning = record.get('stop') === null || record.get('stop') === undefined;
  if (patch.stop === null && !wasRunning) return { ok: false, error: 'A stopped entry cannot be set running again. Use continue.' };
  const start = patch.start ?? isoToMs(record.get('start') as string);
  const stop = patch.stop !== undefined ? patch.stop : wasRunning ? null : isoToMs(record.get('stop') as string);
  if (!Number.isFinite(start)) return { ok: false, error: 'Enter a valid start time.' };
  if (stop !== null && !Number.isFinite(stop)) return { ok: false, error: 'Enter a valid stop time.' };
  if (stop !== null && stop < start) return { ok: false, error: 'The stop time is before the start time.' };
  const fields: Record<string, unknown> = {};
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.project_id !== undefined) fields.project_id = patch.project_id;
  if (patch.task_id !== undefined) fields.task_id = patch.task_id;
  if (patch.billable !== undefined) fields.billable = patch.billable;
  if (patch.tags !== undefined) fields.tags = cleanTags(patch.tags);
  if (patch.start !== undefined || patch.stop !== undefined) {
    fields.start = new Date(start).toISOString();
    fields.stop = stop === null ? null : new Date(stop).toISOString();
    fields.duration = stop === null ? 0 : Math.round((stop - start) / 1000);
  }
  updateRecord(doc, 'time_entries', id, fields);
  return { ok: true };
}

/**
 * Split an entry at `atMs` into two: the original keeps the first part and a new entry (same
 * fields) gets the second part. Splitting a running entry leaves the new part running.
 */
export function splitEntry(doc: Y.Doc, deviceId: string, id: string, atMs: number, now: number = Date.now()): CreateResult {
  const record = collection(doc, 'time_entries').get(id);
  if (!record) return { ok: false, error: 'That entry no longer exists.' };
  const start = isoToMs(record.get('start') as string);
  const running = record.get('stop') === null || record.get('stop') === undefined;
  const stop = running ? null : isoToMs(record.get('stop') as string);
  if (!Number.isFinite(atMs)) return { ok: false, error: 'Enter the time to split at.' };
  if (!(atMs > start)) return { ok: false, error: 'Split after the start of the entry.' };
  if (stop !== null ? !(atMs < stop) : !(atMs <= now)) return { ok: false, error: 'Split before the end of the entry.' };
  const fields = entryFields({
    description: record.get('description') as string,
    project_id: record.get('project_id') as string | null,
    task_id: record.get('task_id') as string | null,
    tags: record.get('tags') as string[],
    billable: record.get('billable') as boolean,
  });
  const stamp = new Date().toISOString();
  let newId = '';
  doc.transact(() => {
    updateRecord(doc, 'time_entries', id, {
      stop: new Date(atMs).toISOString(),
      duration: Math.round((atMs - start) / 1000),
    });
    newId = createRecord(doc, 'time_entries', {
      start: new Date(atMs).toISOString(),
      stop: stop === null ? null : new Date(stop).toISOString(),
      duration: stop === null ? 0 : Math.round((stop - atMs) / 1000),
      ...fields,
      device_id: deviceId,
      created_at: stamp,
      updated_at: stamp,
      deleted: false,
    });
  });
  return { ok: true, id: newId };
}

/**
 * How long a deleted entry can be restored, in days; the one place to change it. 45 days covers a
 * monthly timesheet (owner decision 2026-10-16). After that the delete is permanent, as every soft
 * delete is.
 */
export const RESTORE_WINDOW_DAYS: number = TRASH_DAYS;
export const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 3600_000;
/** The window in words, for messages: "a day", "45 days". */
export const RESTORE_WINDOW_TEXT = RESTORE_WINDOW_DAYS === 1 ? 'a day' : `${RESTORE_WINDOW_DAYS} days`;

/**
 * Soft delete, stamped with `deleted_at` so it can be undone within the restore window. A running entry is also
 * stopped, so a deleted record never counts as running (and a restored one never runs again).
 */
export function deleteEntry(doc: Y.Doc, id: string, now: number = Date.now()): boolean {
  const record = collection(doc, 'time_entries').get(id);
  if (!record) return false;
  const running = record.get('stop') === null || record.get('stop') === undefined;
  let done = false;
  doc.transact(() => {
    if (running) stopEntryAt(doc, id, now);
    done = updateRecord(doc, 'time_entries', id, { deleted: true, deleted_at: new Date(now).toISOString() });
  });
  return done;
}

/** Whether a deleted entry may still be restored at `now`: deleted with a stamp inside the restore window. */
export function canRestore(e: Pick<TimeEntry, 'deleted' | 'deleted_at'>, now: number = Date.now()): boolean {
  if (e.deleted !== true || !e.deleted_at) return false;
  const at = isoToMs(e.deleted_at);
  return Number.isFinite(at) && now - at < RESTORE_WINDOW_MS && now - at >= -RESTORE_WINDOW_MS;
}

/** Undo a delete within the restore window. Outside it, or for a live entry, nothing changes. */
export function restoreEntry(doc: Y.Doc, id: string, now: number = Date.now()): Result {
  const record = collection(doc, 'time_entries').get(id);
  if (!record) return { ok: false, error: 'That entry no longer exists.' };
  if (record.get('deleted') !== true) return { ok: true };
  if (!canRestore({ deleted: true, deleted_at: record.get('deleted_at') as string | null | undefined }, now)) {
    return { ok: false, error: `Deleted more than ${RESTORE_WINDOW_TEXT} ago; it can no longer be restored.` };
  }
  updateRecord(doc, 'time_entries', id, { deleted: false, deleted_at: null });
  return { ok: true };
}

/** Entries that can still be restored, most recently deleted first. */
export function recentlyDeleted(doc: Y.Doc, now: number = Date.now()): EntryRecord[] {
  const out: EntryRecord[] = [];
  collection(doc, 'time_entries').forEach((record, id) => {
    if (record.get('deleted') !== true) return;
    const plain: Record<string, unknown> = { id };
    record.forEach((v, k) => {
      plain[k] = v;
    });
    if (canRestore(plain as unknown as EntryRecord, now)) out.push(plain as unknown as EntryRecord);
  });
  return out.sort((a, b) => isoToMs(b.deleted_at) - isoToMs(a.deleted_at) || (a.id < b.id ? -1 : 1));
}

/** Distinct recent descriptions (newest first) with the entry they came from, for suggestions. */
export function recentDescriptions(entries: readonly EntryRecord[], limit = 30): EntryRecord[] {
  const sorted = [...entries].sort((a, b) => startMs(b) - startMs(a));
  const seen = new Set<string>();
  const out: EntryRecord[] = [];
  for (const e of sorted) {
    const key = e.description.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
