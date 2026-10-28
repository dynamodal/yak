import { useEffect, useState } from 'preact/hooks';
import { type HealthItem, healthItems, onHealth } from '../core/health';
import { type Notice, notices, onNotices } from '../core/notices';
import { readSettings, type SharedSettings, writeSetting } from '../core/settings';
import { useApp } from './context';
import type * as Y from 'yjs';
import type { SyncService, SyncStatus } from '../sync/sync-service';

/**
 * Re-render when a Yjs type (or anything inside it) changes. Returns a counter; read the data
 * from the Yjs type during render.
 */
export function useYVersion(type: Y.AbstractType<unknown> | undefined): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!type) return;
    const bump = (): void => setVersion((v) => v + 1);
    type.observeDeep(bump);
    return () => type.unobserveDeep(bump);
  }, [type]);
  return version;
}

export function useSyncStatus(sync: SyncService): SyncStatus {
  const [status, setStatus] = useState(sync.status);
  useEffect(() => sync.subscribe(setStatus), [sync]);
  return status;
}

/** Current time, ticking at the given interval; for running timers. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The shared settings (account document), re-read when they change, and a setter. */
export function useSettings(): {
  settings: SharedSettings;
  set<K extends keyof SharedSettings>(key: K, value: SharedSettings[K]): void;
} {
  const { account: doc } = useApp();
  useYVersion(doc?.getMap('settings') as Y.AbstractType<unknown> | undefined);
  return {
    settings: readSettings(doc),
    set: (key, value) => {
      if (doc) writeSetting(doc, key, value);
    },
  };
}

/** `navigator.onLine`, updated on the online and offline events. True when the browser cannot tell. */
export function useOnline(): boolean {
  const read = (): boolean => (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine);
  const [online, setOnline] = useState(read);
  useEffect(() => {
    const update = (): void => setOnline(read());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * Whether a page shows every kept space at once, remembered on this device under `app-<page>-all-spaces`.
 * Pages with one space (a single kept space, or a space chosen in the picker) ignore it.
 */
export function useAllSpaces(page: string): [boolean, (all: boolean) => void] {
  const key = `app-${page}-all-spaces`;
  const [all, set] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const setAll = (value: boolean): void => {
    set(value);
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // ignore
    }
  };
  return [all, setAll];
}

/** The sync notices waiting on this device (`core/notices.ts`), re-read when they change. */
export function useNotices(): readonly Notice[] {
  const [list, setList] = useState(notices);
  useEffect(() => onNotices(() => setList(notices())), []);
  return list;
}

/** What modules and the shell report about the safety of this device's data (`core/health.ts`). */
export function useHealth(): readonly HealthItem[] {
  const [items, setItems] = useState(healthItems);
  // Read again once subscribed: a child's effect (the backup banner) runs before its parent's, so it may have reported already.
  useEffect(() => {
    setItems(healthItems());
    return onHealth(() => setItems(healthItems()));
  }, []);
  return items;
}
