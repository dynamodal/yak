import * as Y from 'yjs';
import { deviceName, isLeft, isRemoved } from '../core/devices';
import { isLogDoc, spaceLogDocId, spaceOfDoc, type DocumentStore } from '../core/doc-store';
import { ago, type Health } from './service';
import { unbase64 } from './format';

/**
 * Cover: a space is covered on this device when a recent backup made by another device holds
 * everything this device holds of it (#83, decision B-83).
 *
 * Each backup writes, per space, one record into that space's log document (`space/<id>/log`): it
 * syncs only between devices that keep the space and is never backed up, so the record cannot
 * leak to a device or account that lacks the space, and writing it does not change what a backup
 * holds. The record sits in its own root map, `cover`, keyed by the writing device, so each device
 * overwrites only its own entry (one record per device and space). Older builds ignore the map.
 */

export const COVER_MAP = 'cover';
/** A record dated further ahead than this is a wrong clock, not a backup. */
const MAX_AHEAD_MS = 86_400_000;

export interface CoverRecord {
  /** When the backup was made (ISO). */
  at: string;
  kind: 'folder' | 'download';
  encrypted: boolean;
  /** Base64 `Y.encodeStateVector` of each document of the space the backup holds, by document id. */
  docs: Record<string, string>;
}

/** What a backup held, as the manifest says: document id and base64 state vector. */
export interface BackedUpDoc {
  id: string;
  state_vector_base64: string;
}

/** Write (overwrite) this device's record in a space's log document. */
export function writeCover(logDoc: Y.Doc, device: string, record: CoverRecord): void {
  logDoc.getMap<CoverRecord>(COVER_MAP).set(device, record);
}

/** The valid records of a space's log document, by device. Anything malformed is skipped. */
export function readCover(logDoc: Y.Doc | undefined): Map<string, CoverRecord> {
  const out = new Map<string, CoverRecord>();
  if (!logDoc) return out;
  // `getMap`, not `share.get`: a root that only arrived by sync has no type until this device asks for it.
  logDoc.getMap<unknown>(COVER_MAP).forEach((v, device) => {
    if (typeof v !== 'object' || v === null) return;
    const r = v as Partial<CoverRecord>;
    if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)) || typeof r.docs !== 'object' || r.docs === null) return;
    const docs: Record<string, string> = {};
    for (const [id, sv] of Object.entries(r.docs)) if (typeof sv === 'string') docs[id] = sv;
    out.set(device, { at: r.at, kind: r.kind === 'download' ? 'download' : 'folder', encrypted: r.encrypted === true, docs });
  });
  return out;
}

function vector(b64: string): Map<number, number> | undefined {
  try {
    return Y.decodeStateVector(unbase64(b64));
  } catch {
    return undefined;
  }
}

/** Every client in `local` has a clock no greater than the recorded one: the record holds all of local. */
export function vectorContains(recorded: Map<number, number>, local: Map<number, number>): boolean {
  for (const [client, clock] of local) if (clock > (recorded.get(client) ?? 0)) return false;
  return true;
}

export interface SpaceInput {
  id: string;
  name: string;
  /** Whether the space holds anything worth a backup. */
  hasData: boolean;
  /** This device's state vector of each of the space's documents it holds, by document id. */
  vectors: ReadonlyMap<string, Uint8Array>;
  /** Records by device. */
  records: ReadonlyMap<string, CoverRecord>;
}

export interface SpaceCover {
  /** Some recent record of another device holds all of this device's state. */
  covered: boolean;
  /** Some recent record of another device exists, though it lacks changes made here since: wait for the next backup. */
  waiting: boolean;
  /** The newest recent record that covers, or else the newest recent one. */
  by?: { device: string; at: number };
}

/** Whether one space is covered. Pure: `self` records and records outside `limitMs` never count. */
export function spaceCover(s: SpaceInput, self: string, now: number, limitMs: number, ignore: (device: string) => boolean = () => false): SpaceCover {
  const local = [...s.vectors].map(([id, sv]) => [id, Y.decodeStateVector(sv)] as const);
  let covering: { device: string; at: number } | undefined;
  let recent: { device: string; at: number } | undefined;
  for (const [device, r] of s.records) {
    if (device === self || ignore(device)) continue;
    const at = Date.parse(r.at);
    if (at > now + MAX_AHEAD_MS || now - at > limitMs) continue;
    if (!recent || at > recent.at) recent = { device, at };
    const holds = local.every(([id, lv]) => {
      const sv = r.docs[id];
      const rv = sv === undefined ? undefined : vector(sv);
      return rv !== undefined && vectorContains(rv, lv);
    });
    if (holds && (!covering || at > covering.at)) covering = { device, at };
  }
  return { covered: covering !== undefined, waiting: covering === undefined && recent !== undefined, by: covering ?? recent };
}

export interface CoverSummary {
  /** Spaces with data that no recent backup of another device holds and none is expected to. */
  open: string[];
  covered: number;
  waiting: number;
  /** The device whose recent backup covers (or, failing that, the newest recent one), and when. */
  by?: { device: string; at: number };
  /** The newest record of any age by another device, to name it in advice. */
  last?: { device: string; at: number };
}

/** Combine the spaces. Only spaces with data count; `undefined` when no space has records to go by. */
export function summarizeCover(spaces: readonly SpaceInput[], self: string, now: number, limitMs: number, ignore?: (device: string) => boolean): CoverSummary | undefined {
  const sum: CoverSummary = { open: [], covered: 0, waiting: 0 };
  let any = false;
  let byCovers = false;
  for (const s of spaces) {
    if (!s.hasData) continue;
    for (const [device, r] of s.records) {
      if (device === self || ignore?.(device)) continue;
      const at = Date.parse(r.at);
      if (at <= now + MAX_AHEAD_MS && (!sum.last || at > sum.last.at)) sum.last = { device, at };
      any = true;
    }
    const c = spaceCover(s, self, now, limitMs, ignore);
    if (c.covered) sum.covered++;
    else if (c.waiting) sum.waiting++;
    else sum.open.push(s.name);
    if (c.by && (!sum.by || (c.covered && !byCovers) || (c.covered === byCovers && c.by.at > sum.by.at))) {
      sum.by = c.by;
      byCovers = c.covered;
    }
  }
  return any ? sum : undefined;
}

/** The records one backup writes: per space, the vectors of the space's documents it holds. */
export function coverDocs(documents: readonly BackedUpDoc[], spaceOf: (docId: string) => string | undefined): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const d of documents) {
    const space = spaceOf(d.id);
    if (space === undefined) continue;
    const docs = out.get(space) ?? {};
    docs[d.id] = d.state_vector_base64;
    out.set(space, docs);
  }
  return out;
}

export const nameOf = (account: Y.Doc, device: string): string => deviceName(account, device) ?? 'another device';

/** The cover of every space this device keeps, from the other devices' records. `undefined` when no record exists, as on a device that never syncs. */
export function coverOf(app: { store: DocumentStore; account: Y.Doc; deviceId: string; spaces: readonly { id: string; name: string }[] }, hasData: (docs: ReadonlyMap<string, Y.Doc>) => boolean, now: number, limitMs: number): CoverSummary | undefined {
  const inputs: SpaceInput[] = [];
  for (const sp of app.spaces) {
    const docs = new Map<string, Y.Doc>();
    for (const [id, doc] of app.store.opened()) if (!isLogDoc(id) && spaceOfDoc(id) === sp.id) docs.set(id, doc);
    if (docs.size === 0) continue;
    inputs.push({ id: sp.id, name: sp.name, hasData: hasData(docs), vectors: new Map([...docs].map(([id, d]) => [id, Y.encodeStateVector(d)])), records: readCover(app.store.get(spaceLogDocId(sp.id))) });
  }
  return summarizeCover(inputs, app.deviceId, now, limitMs, (d) => isRemoved(app.account, d) || isLeft(app.account, d));
}

/**
 * `own` (this device's health, never or stale) in the light of other devices' backups. All spaces covered or waiting: fine, "Backed up by".
 * Otherwise warn about the spaces not covered, naming the device. Folder and failed-run warnings never come here.
 */
export function coverHealth(own: Health, c: CoverSummary, now: number, name: (device: string) => string, unsupported: boolean): Health {
  if (c.by && c.covered + c.waiting > 0) {
    const by = name(c.by.device);
    if (c.open.length === 0) return { ok: true, kind: 'ok', covered: true, text: `Backed up by ${by}, ${ago(now - c.by.at)}.` };
    return { ok: false, kind: 'stale', text: `${c.open.join(', ')} ${c.open.length === 1 ? 'has' : 'have'} changes that are in no recent backup. Open ${by} so they reach it and it backs up, or download a backup.` };
  }
  if (!c.last) return own;
  const who = name(c.last.device);
  if (own.kind === 'stale') return { ...own, text: `${own.text} Open ${who} so it backs up, or download a backup.` };
  return { ...own, text: `No recent backup holds your latest changes. Open ${who} so it backs up (its last backup was ${ago(now - c.last.at)}), or ${unsupported ? 'download a backup' : 'choose a backup folder'}.` };
}
