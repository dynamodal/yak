import * as Y from 'yjs';
import { uuid } from './ids';
import { NEW_DOC_VERSION } from './migrations';

/**
 * Shared record shapes. See docs/architecture.md. Field names follow the Toggl API v9 where a
 * Toggl equivalent exists. Every record lives in a Y.Map keyed by a fresh UUID; deletes are soft.
 */

export interface TimeEntry {
  start: string;
  stop: string | null;
  duration: number;
  description: string;
  project_id: string | null;
  task_id: string | null;
  tags: string[];
  billable: boolean;
  device_id: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  /** When it was deleted (ISO); a delete can be undone for `RESTORE_WINDOW_DAYS` (45) days after this. Absent on entries never deleted, and on entries deleted before this field existed. */
  deleted_at?: string | null;
  /** Fingerprint of an entry brought in by an import, so importing the same file again skips it. Absent on other entries. */
  import_id?: string;
}

export interface Project {
  name: string;
  client_id: string | null;
  color: string;
  billable: boolean;
  rate: number | null;
  currency: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  /** When it was deleted (ISO), for Recently deleted (B-107); absent when never deleted or deleted before the field existed ("date unknown"). */
  deleted_at?: string | null;
}

export interface Client {
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  /** As `Project.deleted_at`. */
  deleted_at?: string | null;
}

export interface Tag {
  name: string;
  created_at: string;
  deleted: boolean;
  /** As `Project.deleted_at`. */
  deleted_at?: string | null;
  /** Set when a rename merged it into another tag: not a delete, so Recently deleted leaves it out. */
  merged?: boolean;
}

export type CollectionName = 'time_entries' | 'projects' | 'clients' | 'tags' | 'notes';

export function nowIso(): string {
  return new Date().toISOString();
}

/** The Y.Map of records for a collection; each value is a Y.Map of fields. */
export function collection(doc: Y.Doc, name: CollectionName): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(name);
}

/** Create a record under a fresh UUID in one transaction. Returns the id. */
export function createRecord(doc: Y.Doc, name: CollectionName, fields: Record<string, unknown>): string {
  const id = uuid();
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) record.set(k, v);
    collection(doc, name).set(id, record);
  });
  return id;
}

/** Set fields of an existing record; never creates one. Sets `updated_at` when the record has it. */
export function updateRecord(doc: Y.Doc, name: CollectionName, id: string, fields: Record<string, unknown>): boolean {
  const record = collection(doc, name).get(id);
  if (!record) return false;
  doc.transact(() => {
    for (const [k, v] of Object.entries(fields)) record.set(k, v);
    if (record.has('updated_at') && !('updated_at' in fields)) record.set('updated_at', nowIso());
  });
  return true;
}

export function softDelete(doc: Y.Doc, name: CollectionName, id: string): boolean {
  return updateRecord(doc, name, id, { deleted: true });
}

/** Plain objects for the live (not deleted) records of a collection, with their ids. */
export function liveRecords<T>(doc: Y.Doc, name: CollectionName): (T & { id: string })[] {
  const out: (T & { id: string })[] = [];
  collection(doc, name).forEach((record, id) => {
    // A tombstone (Delete for good, B-107) is never live, even if a concurrent restore cleared `deleted`.
    if (record.get('deleted') === true || record.has('purged_at')) return;
    const plain: Record<string, unknown> = { id };
    record.forEach((v, k) => {
      plain[k] = v;
    });
    out.push(plain as T & { id: string });
  });
  return out;
}

/** Stamp a new space document with its schema version. Idempotent. */
export function initSpaceDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (!meta.has('schema_version')) {
    doc.transact(() => {
      meta.set('schema_version', NEW_DOC_VERSION);
      meta.set('created_at', nowIso());
    });
  }
}
