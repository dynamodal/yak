import type * as Y from 'yjs';
import { type Rate, readRate, writeRate } from '../core/rates';
import { BULK_EDIT } from '../core/bulk';
import { visibleTags } from '../core/hidden-tags';
import { PROJECT_COLORS } from '../app/theme/palette';
import { type Client, collection, createRecord, liveRecords, nowIso, type Project, type Tag, updateRecord } from '../core/schema';
import { trashRecord } from '../core/trash';
import { cleanTags } from './entries';

export type ProjectRecord = Project & { id: string };
export type ClientRecord = Client & { id: string };
type TagRecord = Tag & { id: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

function isColor(value: string): boolean {
  return HEX.test(value);
}

/**
 * Projects of a space. Rates are private (the space's private part, `privateDoc`); a project's own
 * `rate` and `currency` are the first layout's values, used only where no private rate was set.
 */
export function liveProjects(doc: Y.Doc, privateDoc?: Y.Doc): ProjectRecord[] {
  return liveRecords<Project>(doc, 'projects')
    .map((p) => {
      const r = readRate(privateDoc, p.id);
      return r ? { ...p, rate: r.rate, currency: r.currency } : p;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function liveClients(doc: Y.Doc): ClientRecord[] {
  return liveRecords<Client>(doc, 'clients').sort((a, b) => a.name.localeCompare(b.name));
}

function liveTags(doc: Y.Doc): TagRecord[] {
  return liveRecords<Tag>(doc, 'tags').sort((a, b) => a.name.localeCompare(b.name));
}

export interface NewProject {
  name: string;
  client_id?: string | null;
  color?: string;
  billable?: boolean;
  rate?: number | null;
  currency?: string;
}

export function createProject(doc: Y.Doc, input: NewProject): string | null {
  const name = input.name.trim();
  if (!name) return null;
  const stamp = nowIso();
  const color = input.color && isColor(input.color) ? input.color : (PROJECT_COLORS[collection(doc, 'projects').size % PROJECT_COLORS.length] ?? PROJECT_COLORS[0]);
  return createRecord(doc, 'projects', {
    name,
    client_id: input.client_id ?? null,
    color,
    billable: input.billable ?? false,
    rate: input.rate ?? null,
    currency: (input.currency ?? 'USD').trim().toUpperCase() || 'USD',
    active: true,
    created_at: stamp,
    updated_at: stamp,
    deleted: false,
  });
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'client_id' | 'color' | 'billable' | 'rate' | 'currency' | 'active'>>;

/** Rate and currency go to `privateDoc` (the space's private part) when given; everything else to the shared project. */
export function updateProject(doc: Y.Doc, id: string, patch: ProjectPatch, privateDoc?: Y.Doc): boolean {
  const fields: Record<string, unknown> = { ...patch };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return false;
    fields.name = name;
  }
  if (patch.color !== undefined && !isColor(patch.color)) return false;
  if (patch.rate !== undefined && patch.rate !== null && !(Number.isFinite(patch.rate) && patch.rate >= 0)) return false;
  if (patch.currency !== undefined) fields.currency = patch.currency.trim().toUpperCase() || 'USD';
  if (privateDoc) {
    if (!collection(doc, 'projects').has(id)) return false;
    const rate: Partial<Rate> = {};
    if ('rate' in fields) rate.rate = fields.rate as number | null;
    if ('currency' in fields) rate.currency = fields.currency as string;
    delete fields.rate;
    delete fields.currency;
    if (rate.rate !== undefined || rate.currency !== undefined) writeRate(privateDoc, id, rate);
    return Object.keys(fields).length === 0 ? true : updateRecord(doc, 'projects', id, fields);
  }
  return updateRecord(doc, 'projects', id, fields);
}

export function createClient(doc: Y.Doc, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const stamp = nowIso();
  return createRecord(doc, 'clients', { name: trimmed, archived: false, created_at: stamp, updated_at: stamp, deleted: false });
}

export function updateClient(doc: Y.Doc, id: string, patch: Partial<Pick<Client, 'name' | 'archived'>>): boolean {
  const fields: Record<string, unknown> = { ...patch };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return false;
    fields.name = name;
  }
  return updateRecord(doc, 'clients', id, fields);
}

/** Tag names are unique ignoring case; two devices may create the same name, and the first one wins. */
export function uniqueTagNames(doc: Y.Doc): string[] {
  const records = liveTags(doc).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  return cleanTags(records.map((t) => t.name)).sort((a, b) => a.localeCompare(b));
}

/** Make sure a tag record exists for the name. Returns the name as stored (existing spelling wins). */
export function ensureTag(doc: Y.Doc, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = uniqueTagNames(doc).find((t) => t.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  createRecord(doc, 'tags', { name: trimmed, created_at: nowIso(), deleted: false });
  return trimmed;
}

/** Tag names for the lists pickers offer: every tag of the space except the ones hidden there. */
export function pickerTagNames(doc: Y.Doc): string[] {
  return visibleTags(doc, uniqueTagNames(doc));
}

/** Rewrite the tags array of every entry that has `from` (case-insensitive) using `map`. Returns how many entries changed. */
function rewriteEntryTags(doc: Y.Doc, from: string, map: (tags: string[]) => string[]): number {
  const lower = from.toLowerCase();
  let n = 0;
  doc.transact(() => {
    collection(doc, 'time_entries').forEach((record) => {
      if (record.get('deleted') === true) return;
      const tags = record.get('tags');
      if (!Array.isArray(tags) || !tags.some((t) => typeof t === 'string' && t.toLowerCase() === lower)) return;
      record.set('tags', map(tags as string[]));
      record.set('updated_at', nowIso());
      n++;
    });
  }, BULK_EDIT);
  return n;
}

/** How many live entries carry the tag. */
export function tagEntryCount(entriesDoc: Y.Doc, name: string): number {
  const lower = name.toLowerCase();
  let n = 0;
  collection(entriesDoc, 'time_entries').forEach((record) => {
    const tags = record.get('tags');
    if (record.get('deleted') !== true && Array.isArray(tags) && tags.some((t) => typeof t === 'string' && t.toLowerCase() === lower)) n++;
  });
  return n;
}

/**
 * Rename a tag everywhere in this space: its records (in `doc`, the space's main document) and the
 * entries that use it (in `entriesDoc`, the space's time document). Renaming to a tag that already
 * exists merges the two: entries keep one copy of the name. Returns how many entries changed.
 */
export function renameTag(doc: Y.Doc, from: string, to: string, entriesDoc: Y.Doc = doc): number {
  const target = to.trim();
  if (!target) return 0;
  const lower = from.toLowerCase();
  const merging = target.toLowerCase() !== lower && uniqueTagNames(doc).some((t) => t.toLowerCase() === target.toLowerCase());
  doc.transact(() => {
    for (const t of liveTags(doc)) {
      if (t.name.toLowerCase() !== lower) continue;
      if (merging) updateRecord(doc, 'tags', t.id, { deleted: true, merged: true });
      else updateRecord(doc, 'tags', t.id, { name: target });
    }
  }, BULK_EDIT);
  const existing = uniqueTagNames(doc).find((t) => t.toLowerCase() === target.toLowerCase()) ?? target;
  return rewriteEntryTags(entriesDoc, from, (tags) => cleanTags(tags.map((t) => (t.toLowerCase() === lower ? existing : t))));
}

/** Remove a tag from all items: soft-delete its records and take the name off entries. Returns how many entries changed. */
export function deleteTag(doc: Y.Doc, name: string, entriesDoc: Y.Doc = doc): number {
  const lower = name.toLowerCase();
  doc.transact(() => {
    for (const t of liveTags(doc)) if (t.name.toLowerCase() === lower) trashRecord(doc, 'tags', t.id);
  }, BULK_EDIT);
  return rewriteEntryTags(entriesDoc, name, (tags) => tags.filter((t) => t.toLowerCase() !== lower));
}

/** Live entries of a project. */
export function projectEntryCount(entriesDoc: Y.Doc, projectId: string): number {
  let n = 0;
  collection(entriesDoc, 'time_entries').forEach((record) => {
    if (record.get('deleted') !== true && record.get('project_id') === projectId) n++;
  });
  return n;
}

/** Point every live entry of a project at another project (or none). Returns how many changed. */
export function moveProjectEntries(entriesDoc: Y.Doc, from: string, to: string | null): number {
  let n = 0;
  entriesDoc.transact(() => {
    collection(entriesDoc, 'time_entries').forEach((record) => {
      if (record.get('deleted') === true || record.get('project_id') !== from) return;
      record.set('project_id', to);
      record.set('updated_at', nowIso());
      n++;
    });
  }, BULK_EDIT);
  return n;
}

/** Delete a project that no entry uses any more (soft, like every delete; Recently deleted keeps it 45 days). */
export function deleteProject(doc: Y.Doc, id: string): boolean {
  return trashRecord(doc, 'projects', id);
}

/** Live projects of a client. */
export function clientProjectCount(doc: Y.Doc, clientId: string): number {
  return liveProjects(doc).filter((p) => p.client_id === clientId).length;
}

/** Point every live project of a client at another client (or none). Returns how many changed. */
export function moveClientProjects(doc: Y.Doc, from: string, to: string | null): number {
  let n = 0;
  doc.transact(() => {
    for (const p of liveProjects(doc)) {
      if (p.client_id !== from) continue;
      updateRecord(doc, 'projects', p.id, { client_id: to });
      n++;
    }
  }, BULK_EDIT);
  return n;
}

/** Delete a client that has no projects any more. */
export function deleteClient(doc: Y.Doc, id: string): boolean {
  return trashRecord(doc, 'clients', id);
}
