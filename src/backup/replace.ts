import * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { docDbName } from '../core/doc-store';
import { uuid } from '../core/ids';
import { kvGet, kvSet } from './device-db';
import { applyUpdates, backupUpdates, type DocUpdate, type OpenedBackup } from './restore';

/**
 * Replace restore: this device's documents become exactly the backup.
 *
 * Yjs cannot un-delete inside a live document, so a replace needs fresh documents:
 *   1. keep the current state as a recovery copy and the backup's updates in IndexedDB;
 *   2. set a flag in localStorage: from here on, the next start applies the backup;
 *   3. delete the IndexedDB database of every open document and of every backup document
 *      (y-indexeddb closes its connection when asked, so this does not block);
 *   4. reload; on start the documents are empty and the saved backup is applied.
 * If anything stops half way, the flag makes the next start apply the backup again, which is
 * harmless because applying a Yjs update twice changes nothing.
 */

const FLAG = `${STORAGE_PREFIX}-backup-replace`;

/** A replace was started and the next start applies the backup (the documents are empty until then). */
export function replacePending(): boolean {
  try {
    return localStorage.getItem(FLAG) !== null;
  } catch {
    return false;
  }
}
const PENDING = 'pending-replace';
const BEFORE = 'before-replace';
const CHANNEL = `${STORAGE_PREFIX}-backup`;

interface PendingReplace {
  id: string;
  name: string;
  created_at: string;
  backup: DocUpdate[];
}

export interface BeforeReplace {
  at: string;
  backupName: string;
  docs: DocUpdate[];
  /** The person dismissed "Merge it back". The copy stays on the device; only the prompt goes. Absent in records made before this field. */
  dismissed_at?: string;
}

/** How long "Merge it back" stays visible after a replace. */
export const MERGE_BACK_DAYS = 45;

/** Whether "Merge it back" is still offered: not dismissed and younger than 45 days. */
export function mergeBackOffered(before: BeforeReplace | undefined, now = Date.now()): before is BeforeReplace {
  if (!before || before.dismissed_at) return false;
  const at = Date.parse(before.at);
  return Number.isFinite(at) && now - at < MERGE_BACK_DAYS * 86_400_000;
}

/** Hide "Merge it back". Nothing is deleted: the earlier data stays on the device. */
export async function dismissMergeBack(): Promise<void> {
  const before = await kvGet<BeforeReplace>(BEFORE);
  if (before) await kvSet(BEFORE, { ...before, dismissed_at: new Date().toISOString() });
}

export function replaceSupported(): boolean {
  try {
    return typeof indexedDB?.deleteDatabase === 'function' && typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function deleteDatabase(name: string, onBlocked: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = onBlocked;
  });
}

export async function startReplace(backup: OpenedBackup, current: ReadonlyMap<string, Y.Doc>, onBlocked: () => void): Promise<void> {
  const updates = await backupUpdates(backup);
  const before: BeforeReplace = {
    at: new Date().toISOString(),
    backupName: backup.manifest.name,
    docs: [...current].map(([id, doc]) => ({ id, update: Y.encodeStateAsUpdate(doc) })),
  };
  await kvSet(BEFORE, before);
  const id = uuid();
  await kvSet(PENDING, { id, name: backup.manifest.name, created_at: backup.manifest.created_at, backup: updates } satisfies PendingReplace);
  localStorage.setItem(FLAG, JSON.stringify({ id }));
  const ids = new Set([...current.keys(), ...updates.map((u) => u.id)]);
  for (const docId of ids) await deleteDatabase(docDbName(docId), onBlocked);
  reloadOtherTabs();
  location.reload();
}

/** Ask the app's other tabs to reload, so none keeps editing documents that are about to be replaced. */
export function reloadOtherTabs(): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: 'reload' });
    ch.close();
  } catch {
    // Other tabs then keep stale data until reloaded; the confirmation asks to close them.
  }
}

/** The message of a replace applied earlier in this page load (the app applies it before it starts). */
let appliedNotice: string | undefined;

/** Take the message of a replace applied earlier in this page load, once. */
export function takeAppliedNotice(): string | undefined {
  const n = appliedNotice;
  appliedNotice = undefined;
  return n;
}

/**
 * Apply a replace that was started before the reload. Returns a message for the user. The app calls
 * this first thing at start, so the account document is restored before anything reads it.
 */
export async function completePendingReplace(open: (id: string) => Promise<Y.Doc>): Promise<string | undefined> {
  const notice = await applyPendingReplace(open);
  if (notice) appliedNotice = notice;
  return notice;
}

async function applyPendingReplace(open: (id: string) => Promise<Y.Doc>): Promise<string | undefined> {
  let flag: { id?: string } | null = null;
  try {
    flag = JSON.parse(localStorage.getItem(FLAG) ?? 'null') as { id?: string } | null;
  } catch {
    return undefined;
  }
  if (!flag?.id) return undefined;
  const rec = await kvGet<PendingReplace>(PENDING);
  if (!rec || rec.id !== flag.id) {
    localStorage.removeItem(FLAG);
    return undefined;
  }
  await applyUpdates(rec.backup, open);
  // y-indexeddb stores the applied update asynchronously; give it a moment before the flag goes.
  await new Promise((r) => setTimeout(r, 1000));
  localStorage.removeItem(FLAG);
  await kvSet(PENDING, undefined);
  return `Replaced this device's data with the backup from ${new Date(rec.created_at).toLocaleString()}.`;
}

/** Reload when another tab replaced the data, so no tab keeps editing the old documents. */
export function reloadOnReplaceElsewhere(): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'reload') location.reload();
    };
  } catch {
    // BroadcastChannel missing: nothing to do.
  }
}

export function beforeReplace(): Promise<BeforeReplace | undefined> {
  return kvGet<BeforeReplace>(BEFORE);
}

/** Merge the data from before the last replace back in. */
export async function recoverBeforeReplace(open: (id: string) => Promise<Y.Doc>): Promise<string[]> {
  const before = await beforeReplace();
  if (!before) return [];
  return applyUpdates(before.docs, open);
}
