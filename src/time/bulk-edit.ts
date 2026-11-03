import type * as Y from 'yjs';
import type { BulkTx } from '../core/bulk';
import { collection, createRecord, nowIso } from '../core/schema';
import { createClient, createProject, ensureTag, liveClients, liveProjects } from './catalog';
import { cleanTags, isRunning } from './entries';
import { isoToMs } from './dates';

/**
 * Changing many time entries at once. Each function takes the spaces' documents, the chosen entries
 * and the bulk transaction (`tx`, from `bulkEdit`), so one action is one Undo. Running entries are
 * left alone: they are being timed. Entries are edited in the space they live in.
 */
export interface SpaceHandle {
  /** The space's main document: projects, clients, tags. */
  doc: Y.Doc;
  /** The space's time document: `time_entries`. */
  privateDoc: Y.Doc;
}
export type Spaces = ReadonlyMap<string, SpaceHandle>;
export interface Target {
  spaceId: string;
  id: string;
}
export interface Outcome {
  changed: number;
  /** Chosen entries that were left as they were (running, or no matching project). */
  skipped: number;
}

type Rec = Y.Map<unknown>;

function each(spaces: Spaces, targets: readonly Target[], fn: (rec: Rec, handle: SpaceHandle, t: Target) => boolean): Outcome {
  let changed = 0;
  let skipped = 0;
  for (const t of targets) {
    const handle = spaces.get(t.spaceId);
    const rec = handle ? collection(handle.privateDoc, 'time_entries').get(t.id) : undefined;
    if (!handle || !rec || rec.get('deleted') === true || isRunning({ stop: rec.get('stop') as string | null })) {
      skipped++;
      continue;
    }
    if (fn(rec, handle, t)) changed++;
    else skipped++;
  }
  return { changed, skipped };
}

const touch = (rec: Rec): void => void rec.set('updated_at', nowIso());

/** Project by name in each entry's own space (`null` removes it); an entry whose space has no such project is skipped. Billable follows the project, as when one entry is edited. */
export function setProject(spaces: Spaces, targets: readonly Target[], name: string | null, tx: BulkTx): Outcome {
  const lower = name?.toLowerCase() ?? null;
  return each(spaces, targets, (rec, h) => {
    let id: string | null = null;
    let billable: boolean | null = null;
    if (lower !== null) {
      const p = liveProjects(h.doc).find((x) => x.active && x.name.toLowerCase() === lower);
      if (!p) return false;
      id = p.id;
      billable = p.billable;
    }
    tx(h.privateDoc, () => {
      rec.set('project_id', id);
      if (billable !== null) rec.set('billable', billable);
      touch(rec);
    });
    return true;
  });
}

/** Add or remove a tag by name. An added tag is made in the entry's space when it has none (one tag list per space). */
export function setTag(spaces: Spaces, targets: readonly Target[], tag: string, add: boolean, tx: BulkTx): Outcome {
  const lower = tag.trim().toLowerCase();
  if (!lower) return { changed: 0, skipped: targets.length };
  return each(spaces, targets, (rec, h) => {
    const tags = (rec.get('tags') as string[] | undefined) ?? [];
    const has = tags.some((t) => t.toLowerCase() === lower);
    if (add === has) return false;
    let name = tag.trim();
    if (add) tx(h.doc, () => void (name = ensureTag(h.doc, name) ?? name));
    tx(h.privateDoc, () => {
      rec.set('tags', add ? cleanTags([...tags, name]) : tags.filter((t) => t.toLowerCase() !== lower));
      touch(rec);
    });
    return true;
  });
}

export function setBillable(spaces: Spaces, targets: readonly Target[], on: boolean, tx: BulkTx): Outcome {
  return each(spaces, targets, (rec, h) => {
    if (rec.get('billable') === on) return false;
    tx(h.privateDoc, () => {
      rec.set('billable', on);
      touch(rec);
    });
    return true;
  });
}

/** Move start and stop by whole local days; the times of day and the duration stay. */
export function shiftDays(spaces: Spaces, targets: readonly Target[], days: number, tx: BulkTx): Outcome {
  if (!Number.isInteger(days) || days === 0) return { changed: 0, skipped: targets.length };
  return each(spaces, targets, (rec, h) => {
    const start = isoToMs(rec.get('start') as string);
    const stop = isoToMs(rec.get('stop') as string);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return false;
    const move = (ms: number): number => {
      const d = new Date(ms);
      d.setDate(d.getDate() + days);
      return d.getTime();
    };
    tx(h.privateDoc, () => {
      rec.set('start', new Date(move(start)).toISOString());
      rec.set('stop', new Date(move(stop)).toISOString());
      touch(rec);
    });
    return true;
  });
}

/** Put the entries on one local date (`YYYY-MM-DD`), keeping each one's time of day and duration. */
export function setDate(spaces: Spaces, targets: readonly Target[], date: string, tx: BulkTx): Outcome {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { changed: 0, skipped: targets.length };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return each(spaces, targets, (rec, h) => {
    const start = isoToMs(rec.get('start') as string);
    const stop = isoToMs(rec.get('stop') as string);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return false;
    const s = new Date(start);
    s.setFullYear(y!, mo! - 1, d!);
    const newStart = s.getTime();
    if (newStart === start) return false;
    tx(h.privateDoc, () => {
      rec.set('start', new Date(newStart).toISOString());
      rec.set('stop', new Date(newStart + (stop - start)).toISOString());
      touch(rec);
    });
    return true;
  });
}

/** Soft delete with the stamp that lets each entry be restored for the restore window. */
export function deleteAll(spaces: Spaces, targets: readonly Target[], tx: BulkTx, now: number = Date.now()): Outcome {
  return each(spaces, targets, (rec, h) => {
    tx(h.privateDoc, () => {
      rec.set('deleted', true);
      rec.set('deleted_at', new Date(now).toISOString());
      touch(rec);
    });
    return true;
  });
}

/** The project of another space with the same name (and client name), made when the target space has none. */
function projectIn(from: SpaceHandle, to: SpaceHandle, projectId: string | null, tx: BulkTx): string | null {
  if (!projectId) return null;
  const src = liveProjects(from.doc).find((p) => p.id === projectId);
  if (!src) return null;
  const lower = src.name.toLowerCase();
  const hit = liveProjects(to.doc).find((p) => p.name.toLowerCase() === lower);
  if (hit) return hit.id;
  let id: string | null = null;
  tx(to.doc, () => {
    let clientId: string | null = null;
    const client = src.client_id ? liveClients(from.doc).find((c) => c.id === src.client_id) : undefined;
    if (client) clientId = liveClients(to.doc).find((c) => c.name.toLowerCase() === client.name.toLowerCase())?.id ?? createClient(to.doc, client.name);
    id = createProject(to.doc, { name: src.name, client_id: clientId, color: src.color, billable: src.billable });
  });
  return id;
}

/**
 * Move entries to another space. An entry's space follows its project (S17): the project is the one
 * with the same name in the target space, made there (with its client) when missing; tags are made
 * in the target space's tag list. The entry is copied under a new id and the original is marked
 * deleted without the restore stamp, so no copy is left behind. Rates are private and not copied.
 * `projectMap` (source project id → target project id) overrides the by-name match, for a project moved under a new name.
 */
export function moveToSpace(spaces: Spaces, targets: readonly Target[], toSpace: string, deviceId: string, tx: BulkTx, projectMap?: ReadonlyMap<string, string>): Outcome {
  const dest = spaces.get(toSpace);
  if (!dest) return { changed: 0, skipped: targets.length };
  const plan = targets.filter((t) => t.spaceId !== toSpace);
  const staying = targets.length - plan.length;
  const out = each(spaces, plan, (rec, h) => {
    const sourceProject = rec.get('project_id') as string | null;
    const projectId = (sourceProject && projectMap?.get(sourceProject)) || projectIn(h, dest, sourceProject, tx);
    const tags = ((rec.get('tags') as string[] | undefined) ?? []).map((t) => {
      let name = t;
      tx(dest.doc, () => void (name = ensureTag(dest.doc, t) ?? t));
      return name;
    });
    tx(dest.privateDoc, () => {
      const stamp = nowIso();
      createRecord(dest.privateDoc, 'time_entries', {
        start: rec.get('start'),
        stop: rec.get('stop'),
        duration: rec.get('duration'),
        description: rec.get('description') ?? '',
        project_id: projectId,
        task_id: null,
        tags,
        billable: rec.get('billable') === true,
        device_id: deviceId,
        created_at: stamp,
        updated_at: stamp,
        deleted: false,
      });
    });
    tx(h.privateDoc, () => {
      rec.set('deleted', true);
      touch(rec);
    });
    return true;
  });
  return { changed: out.changed, skipped: out.skipped + staying };
}

