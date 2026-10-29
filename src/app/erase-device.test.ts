import { describe, expect, it } from 'vitest';
import { docDbName } from '../core/doc-store';
import { blobDbName } from '../core/blobs/store';
import { applyPendingEraseAll, ERASE_ALL_KEY, ERASE_REPORT_KEY, eraseAllStores, eraseEverything, FIXED_DATABASES, isYakKey, knownDatabases, takeEraseReport, type EraseIo } from './erase-device';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] };
};

function fakeIo(over: Partial<EraseIo> = {}) {
  const log: string[] = [];
  const local = new Set(['app-device-id', 'app-theme', 'other-site-key']);
  const io: EraseIo = {
    databases: async () => ['app-doc-account/a', 'app-history', 'someone-elses'],
    deleteDatabase: async (n) => void log.push(`db:${n}`),
    localKeys: () => [...local],
    removeLocal: (k) => void local.delete(k),
    sessionKeys: () => ['app-x'],
    removeSession: (k) => void log.push(`session:${k}`),
    cacheNames: async () => ['app-precache-1'],
    deleteCache: async (n) => void log.push(`cache:${n}`),
    opfsEntries: async () => ['blobs'],
    removeOpfs: async (n) => void log.push(`opfs:${n}`),
    unregisterWorkers: async () => void log.push('sw'),
    ...over,
  };
  return { io, log, local };
}

describe('erase everything: the erase list', () => {
  it('only Yak keys count, by the generic prefix', () => {
    expect(isYakKey('app-device-id')).toBe(true);
    expect(isYakKey('application')).toBe(false);
    expect(isYakKey('other-site-key')).toBe(false);
  });

  it('knows fixed names, document databases and file databases where the browser cannot list them', () => {
    const names = knownDatabases(['space/w1'], ['w1']);
    expect(names).toEqual(expect.arrayContaining([...FIXED_DATABASES, docDbName('space/w1'), blobDbName('w1')]));
    expect(new Set(names).size).toBe(names.length);
  });

  it('clears databases, caches, private files, the worker and Yak keys', async () => {
    const { io, log, local } = fakeIo();
    expect(await eraseAllStores(io, ['app-keys'])).toEqual([]);
    expect(log).toEqual(expect.arrayContaining(['db:app-doc-account/a', 'db:app-history', 'db:app-keys', 'cache:app-precache-1', 'opfs:blobs', 'sw', 'session:app-x']));
    expect([...local]).toEqual(['other-site-key']);
  });

  it('degrades when an API is missing and falls back to the known database names', async () => {
    const { io, log } = fakeIo({ databases: undefined, cacheNames: undefined, opfsEntries: undefined, unregisterWorkers: undefined });
    expect(await eraseAllStores(io, ['app-keys'])).toEqual([]);
    expect(log).toContain('db:app-keys');
    expect(log.some((l) => l.startsWith('cache:') || l.startsWith('opfs:') || l === 'sw')).toBe(false);
  });

  it('reports what could not be cleared and still clears the rest', async () => {
    const { io, log, local } = fakeIo({
      deleteDatabase: async (n) => {
        if (n === 'app-history') throw new Error('blocked');
      },
      unregisterWorkers: async () => {
        throw new Error('no');
      },
    });
    const left = await eraseAllStores(io, []);
    expect(left).toEqual(['database app-history', 'service worker']);
    expect(log).toContain('cache:app-precache-1');
    expect(local.has('app-device-id')).toBe(false);
  });
});

describe('erase everything: the flow', () => {
  it('records the erase, reloads, and runs once at the next start', async () => {
    const storage = memory();
    let reloaded = 0;
    expect(await applyPendingEraseAll(storage, fakeIo().io)).toBeUndefined();
    eraseEverything({ storage, docIds: ['space/w1'], unitIds: ['w1'], reload: () => void reloaded++ });
    expect(reloaded).toBe(1);
    expect(storage.getItem(ERASE_ALL_KEY)).not.toBeNull();
    const { io, log } = fakeIo({ databases: undefined });
    expect(await applyPendingEraseAll(storage, io)).toEqual([]);
    expect(log).toContain(`db:${docDbName('space/w1')}`);
    expect(log).toContain(`db:${blobDbName('w1')}`);
    expect(storage.getItem(ERASE_ALL_KEY)).toBeNull();
    expect(await applyPendingEraseAll(storage, fakeIo().io)).toBeUndefined();
  });

  it('keeps a report only when something remains, and shows it once', async () => {
    const storage = memory();
    storage.setItem(ERASE_ALL_KEY, JSON.stringify({ databases: [] }));
    await applyPendingEraseAll(storage, fakeIo({ unregisterWorkers: async () => Promise.reject(new Error('x')) }).io);
    expect(storage.getItem(ERASE_REPORT_KEY)).not.toBeNull();
    expect(takeEraseReport(storage)).toMatch(/service worker.*Clear site data/);
    expect(takeEraseReport(storage)).toBeUndefined();

    storage.setItem(ERASE_ALL_KEY, 'not json');
    expect(await applyPendingEraseAll(storage, fakeIo().io)).toEqual([]);
    expect(storage.getItem(ERASE_REPORT_KEY)).toBeNull();
  });
});
