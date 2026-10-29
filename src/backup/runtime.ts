import { useEffect, useState } from 'preact/hooks';
import { useNow } from '../app/hooks';
import type * as Cover from './cover';

// A chunk that fails to load only means no cover: the warning stays as it would be without. Loaded on use: only a device that is not covered by its own backup, or one that backs up, needs it, and the main bundle is on a budget.
const coverModule = (): Promise<typeof Cover> => import('./cover');
import { testMode } from '../core/test-build';
import * as Y from 'yjs';
import { useApp } from '../app/context';
import { STORAGE_PREFIX } from '../constants';
import type { EventBus } from '../core/bus';
import { accountOfDoc } from '../core/account';
import { isLogDoc, spaceLogDocId, spaceOfDoc, type DocumentStore } from '../core/doc-store';
import { historyStore } from '../core/history/store';
import { deviceKey } from './encryption-state';
import { BrowserFolder } from './folder';
import { completePendingReplace, takeAppliedNotice, reloadOnReplaceElsewhere } from './replace';
import { backupHealth, BackupService, DEFAULT_STALE_HOURS, type BackupState, type Health, type LockFn, type StatusStore, type StoredStatus } from './service';

const STATUS_KEY = `${STORAGE_PREFIX}-backup-status`;

const localStatus: StatusStore = {
  load(): StoredStatus {
    try {
      return JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}') as StoredStatus;
    } catch {
      return {};
    }
  },
  save(s: StoredStatus): void {
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(s));
    } catch {
      // Status is a convenience; backups themselves do not depend on it.
    }
  },
};

/** One backup run across all tabs of this app, with the Web Locks API where available. */
const webLock: LockFn = async (fn, wait) => {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return fn();
  return locks.request(`${STORAGE_PREFIX}-backup`, { ifAvailable: !wait }, async (lock) => (lock ? fn() : 'busy'));
};

/** When the last backup was written, or undefined when none was (read without starting the service). */
export function lastBackupAt(): string | undefined {
  return localStatus.load().lastBackupAt;
}

export interface BackupRuntime {
  service: BackupService;
  folder: BrowserFolder;
  store: DocumentStore;
  bus: EventBus;
  deviceId: string;
  accountId: string;
  /** Resolves after a pending replace was applied and the triggers started. */
  ready: Promise<void>;
}

let runtime: BackupRuntime | undefined;

/**
 * The backup service is created once, by the first backup component that renders (the banner
 * renders on every screen), because modules get the store and bus only through the app context.
 */
function backupRuntime(app: { store: DocumentStore; bus: EventBus; deviceId: string; accountId: string; account: Y.Doc }): BackupRuntime {
  if (runtime) return runtime;
  const folder = new BrowserFolder();
  const service = new BackupService({ docs: () => new Map([...app.store.opened()].filter(([id]) => !isLogDoc(id) && (accountOfDoc(id) === undefined || accountOfDoc(id) === app.accountId))), deviceId: app.deviceId, accountId: app.accountId, history: historyStore, keyring: () => deviceKey(app.accountId, app.account), folder, status: localStatus, lock: webLock, onBackup: (e) => recordCover(app.store, app.deviceId, e) });
  const ready = (async () => {
    reloadOnReplaceElsewhere();
    try {
      const notice = (await completePendingReplace((id) => app.store.open(id))) ?? takeAppliedNotice();
      if (notice) {
        service.setNotice(notice);
        app.bus.emit('backup:restored', { docIds: [...app.store.opened().keys()] });
      }
    } catch (e) {
      service.setNotice(`Could not finish the restore: ${e instanceof Error ? e.message : String(e)}. Reload to try again.`);
      return;
    }
    service.start(app.bus);
  })();
  runtime = { service, folder, store: app.store, bus: app.bus, deviceId: app.deviceId, accountId: app.accountId, ready };
  if (testMode()) void import('./test-hook').then((m) => m.installTestHook(runtime as BackupRuntime));
  return runtime;
}

/** Tell the devices that keep a space what this backup holds of it: one record per space, in the space's log document. */
function recordCover(store: DocumentStore, deviceId: string, e: { kind: 'folder' | 'download'; encrypted: boolean; at: string; documents: readonly { id: string; state_vector_base64: string }[] }): void {
  void coverModule().then(({ coverDocs, writeCover }) => {
    for (const [space, docs] of coverDocs(e.documents, spaceOfDoc)) {
      const log = store.get(spaceLogDocId(space));
      if (log) writeCover(log, deviceId, { at: e.at, kind: e.kind, encrypted: e.encrypted, docs });
    }
  }, () => undefined);
}

export function useBackup(): BackupRuntime & { state: BackupState } {
  const app = useApp();
  const rt = backupRuntime(app);
  const [state, setState] = useState(rt.service.state);
  useEffect(() => {
    setState(rt.service.state);
    return rt.service.subscribe(setState);
  }, [rt]);
  return { ...rt, state };
}

const RECORD_MAPS = ['time_entries', 'projects', 'clients', 'tags', 'notes'];

/** Whether any open document holds a record (so "no backup yet" is worth a warning). */
export function hasData(docs: ReadonlyMap<string, Y.Doc>): boolean {
  for (const doc of docs.values()) {
    for (const name of RECORD_MAPS) {
      const t = doc.share.get(name);
      if (t instanceof Y.Map && t.size > 0) return true;
      if (t && !(t instanceof Y.Map) && t._map.size > 0) return true;
    }
  }
  return false;
}

/** Offer a text file as a download (the fallback where no folder can be picked). */
export function saveTextFile(fileName: string, text: string): void {
  saveBlobFile(fileName, new Blob([text], { type: 'application/json' }));
}

/** Offer a Blob as a download; the browser streams it from where it is (a zip may be gigabytes). */
export function saveBlobFile(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}

const REMIND_KEY = `${STORAGE_PREFIX}-backup-remind-until`;
const DAY_MS = 86_400_000;

/** Until when the backup banner stays hidden ("Remind me tomorrow"); this device only, never in a document. */
export function remindUntil(): number {
  try {
    return Number(localStorage.getItem(REMIND_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Hides the backup banner for a day on this device. Returns the time it comes back. */
export function remindTomorrow(now = Date.now()): number {
  const until = now + DAY_MS;
  try {
    localStorage.setItem(REMIND_KEY, String(until));
  } catch {
    // Without storage the banner comes back on the next start.
  }
  return until;
}

/**
 * The backup health of this device, counting a recent backup by another device as cover (#83).
 * Re-read every minute.
 */
export function useBackupHealth(): Health {
  const app = useApp();
  const { state, store } = useBackup();
  const now = useNow(60_000);
  const limit = (state.staleAfterHours ?? DEFAULT_STALE_HOURS) * 3_600_000;
  const data = hasData(store.opened());
  const own = backupHealth(state, now, data);
  // Another device's backup can only help when this device's own is missing or old and nothing else is wrong.
  const helps = !own.ok && (own.kind === 'never' || own.kind === 'stale');
  const [m, setM] = useState<typeof Cover>();
  useEffect(() => {
    if (helps && !m) void coverModule().then(setM, () => undefined);
  }, [helps, m]);
  if (!helps || !m) return own;
  const c = m.coverOf(app, hasData, now, limit);
  return c ? m.coverHealth(own, c, now, (d) => m.nameOf(app.account, d), state.folder.state === 'unsupported') : own;
}
