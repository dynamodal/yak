import { STORAGE_PREFIX } from '../constants';
import { docDbName } from '../core/doc-store';
import { blobDbName } from '../core/blobs/store';
import { reloadOtherTabs } from '../backup/replace';
import type { StorageLike } from '../core/account-setup';

/** What the next start erases: set by `eraseEverything`, consumed first thing at start. */
export const ERASE_ALL_KEY = `${STORAGE_PREFIX}-erase-everything`;
/** What a finished erase could not clear; shown once at the next start, then removed. Written only when something remains. */
export const ERASE_REPORT_KEY = `${STORAGE_PREFIX}-erase-report`;

/** Databases that do not depend on a document or space id. Only used where `indexedDB.databases()` is missing. */
export const FIXED_DATABASES = ['backup', 'mirror', 'keys', 'history', 'probe-handles'].map((n) => `${STORAGE_PREFIX}-${n}`);

/** Whether a localStorage / sessionStorage key belongs to Yak (generic prefix, so a rename is cheap). */
export const isYakKey = (key: string): boolean => key.startsWith(`${STORAGE_PREFIX}-`);

/** The database names this page knows of, for browsers that cannot list them. */
export function knownDatabases(docIds: readonly string[], unitIds: readonly string[]): string[] {
  return [...new Set([...FIXED_DATABASES, ...docIds.map(docDbName), ...unitIds.map(blobDbName)])];
}

/** The browser calls an erase makes; replaced in tests. A missing function means the browser has no such store. */
export interface EraseIo {
  databases?: () => Promise<string[]>;
  deleteDatabase: (name: string) => Promise<void>;
  localKeys?: () => string[];
  removeLocal?: (key: string) => void;
  sessionKeys?: () => string[];
  removeSession?: (key: string) => void;
  cacheNames?: () => Promise<string[]>;
  deleteCache?: (name: string) => Promise<void>;
  opfsEntries?: () => Promise<string[]>;
  removeOpfs?: (name: string) => Promise<void>;
  unregisterWorkers?: () => Promise<void>;
}

/**
 * Erase every store of Yak on this origin. Never throws: returns what could not be cleared, in words
 * for the user. Call before any document is open (a database cannot be deleted while open).
 */
export async function eraseAllStores(io: EraseIo, fallbackDatabases: readonly string[]): Promise<string[]> {
  const left: string[] = [];
  const attempt = async (what: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
    } catch {
      left.push(what);
    }
  };
  // Databases: all of this origin where the browser lists them, else the names this page knows.
  let names: string[] = [...fallbackDatabases];
  if (io.databases) {
    try {
      names = [...new Set([...(await io.databases()), ...names])];
    } catch {
      left.push('the list of databases (only the known ones were cleared)');
    }
  }
  for (const name of names) await attempt(`database ${name}`, () => io.deleteDatabase(name));
  if (io.cacheNames && io.deleteCache) {
    const del = io.deleteCache;
    await attempt('offline cache', async () => {
      for (const n of await (io.cacheNames as () => Promise<string[]>)()) await del(n);
    });
  }
  if (io.opfsEntries && io.removeOpfs) {
    const rm = io.removeOpfs;
    await attempt('private file storage', async () => {
      for (const n of await (io.opfsEntries as () => Promise<string[]>)()) await rm(n);
    });
  }
  if (io.unregisterWorkers) await attempt('service worker', io.unregisterWorkers);
  for (const [keys, remove, what] of [[io.sessionKeys, io.removeSession, 'session settings'], [io.localKeys, io.removeLocal, 'settings']] as const) {
    if (!keys || !remove) continue;
    await attempt(what, () => keys().filter(isYakKey).forEach(remove));
  }
  return left;
}

function deleteDb(name: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('blocked')), timeoutMs);
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => (clearTimeout(timer), resolve());
      req.onerror = () => (clearTimeout(timer), reject(req.error));
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/** The real browser, with each API feature-detected. */
export function browserIo(): EraseIo {
  const io: EraseIo = { deleteDatabase: (name) => (typeof indexedDB === 'undefined' ? Promise.resolve() : deleteDb(name)) };
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    io.databases = async () => (await indexedDB.databases()).map((d) => d.name).filter((n): n is string => typeof n === 'string');
  }
  try {
    if (typeof localStorage !== 'undefined') {
      io.localKeys = () => Object.keys(localStorage);
      io.removeLocal = (k) => localStorage.removeItem(k);
    }
    if (typeof sessionStorage !== 'undefined') {
      io.sessionKeys = () => Object.keys(sessionStorage);
      io.removeSession = (k) => sessionStorage.removeItem(k);
    }
  } catch {
    // Storage blocked: nothing to clear there.
  }
  if (typeof caches !== 'undefined') {
    io.cacheNames = () => caches.keys();
    io.deleteCache = async (n) => void (await caches.delete(n));
  }
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
    io.opfsEntries = async () => {
      const names: string[] = [];
      for await (const [name] of (await navigator.storage.getDirectory()) as unknown as AsyncIterable<[string, unknown]>) names.push(name);
      return names;
    };
    io.removeOpfs = async (name) => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true });
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    io.unregisterWorkers = async () => {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    };
  }
  return io;
}

/** The storage the start-up erase reads; `localStorage` fits. */
export interface EraseStorage extends StorageLike {
  removeItem(key: string): void;
}

interface PendingErase {
  databases: string[];
}

/**
 * Record that the next start erases everything, tell the other tabs to reload, and reload.
 * Only the confirmed button in Settings › Advanced calls this; nothing else may.
 */
export function eraseEverything(options: { storage: StorageLike; docIds: readonly string[]; unitIds: readonly string[]; reload?: () => void }): void {
  const pending: PendingErase = { databases: knownDatabases(options.docIds, options.unitIds) };
  options.storage.setItem(ERASE_ALL_KEY, JSON.stringify(pending));
  reloadOtherTabs();
  (options.reload ?? (() => location.reload()))();
}

/**
 * Carry out an erase recorded before the reload. Call first thing at start, before the app reads or
 * opens anything. Returns undefined when none was pending; else what could not be cleared (empty: all
 * gone). The page must reload afterwards so no module keeps stale state.
 */
export async function applyPendingEraseAll(storage: EraseStorage, io: EraseIo = browserIo()): Promise<string[] | undefined> {
  const raw = storage.getItem(ERASE_ALL_KEY);
  if (raw === null) return undefined;
  // The record goes first: if anything below fails the app must still start, never erase again and again.
  try {
    storage.removeItem(ERASE_ALL_KEY);
  } catch {
    // The key goes with the other Yak keys below.
  }
  let databases: string[] = [];
  try {
    const parsed = JSON.parse(raw) as Partial<PendingErase> | null;
    if (parsed && Array.isArray(parsed.databases)) databases = parsed.databases.filter((x): x is string => typeof x === 'string');
  } catch {
    databases = FIXED_DATABASES;
  }
  const left = await eraseAllStores(io, databases);
  if (left.length > 0) {
    try {
      storage.setItem(ERASE_REPORT_KEY, JSON.stringify(left));
    } catch {
      // Nowhere to keep the report.
    }
  }
  return left;
}

/** The message for what an erase could not clear, shown once; clears the record. */
export function takeEraseReport(storage: EraseStorage): string | undefined {
  try {
    const raw = storage.getItem(ERASE_REPORT_KEY);
    if (raw === null) return undefined;
    storage.removeItem(ERASE_REPORT_KEY);
    const left = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string');
    if (left.length === 0) return undefined;
    return eraseReportText(left);
  } catch {
    return undefined;
  }
}

export function eraseReportText(left: readonly string[]): string {
  return `Some data could not be cleared: ${left.slice(0, 5).join(', ')}${left.length > 5 ? ` and ${left.length - 5} more` : ''}. Use your browser's "Clear site data" for this site to remove it.`;
}
