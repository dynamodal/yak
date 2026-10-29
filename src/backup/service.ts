import type * as Y from 'yjs';
import { reportError } from '../core/errors';
import type { EventBus } from '../core/bus';
import type { SegmentStore } from '../core/history/types';
import { blobStore, type BlobStore } from '../core/blobs/store';
import { blobNamer, EncryptedDir, type EncryptionParams, writeFolderEncryption } from './crypto';
import type * as Blobs from './blobs';

// Loaded on use: backing up files is not needed to start the app, and the main bundle is on a budget.
const blobsModule = (): Promise<typeof Blobs> => import('./blobs');
import type { ZipInput } from './zip';
import { SubDir, type BackupDir } from './dir';
import { CURRENT, addRestorePoint, copySegments, listRestorePoints, restorePointDue, writeCurrent, writeIndex } from './incremental';
import { MANIFEST, blobPath, encodeText, type Manifest } from './format';
import { bundleText } from './restore';
import { createSnapshot } from './snapshot';
import { errText } from './store';
import type { BackedUpDoc } from './cover';

/** Wait after a timer stops before backing up, so a quick stop/start/stop makes one backup. */
export const STOP_DEBOUNCE_MS = 5_000;
export const HOURLY_MS = 60 * 60 * 1000;
/** First check after the app opens, when the last backup is more than an hour old. */
const STARTUP_DELAY_MS = 15_000;
export const DEFAULT_STALE_HOURS = 24;
/** A cover record older than this is rewritten by an unchanged check; the shortest staleness choice is 12 hours. */
const COVER_REFRESH_MS = 3 * 3_600_000;

export type FolderState = 'unsupported' | 'none' | 'granted' | 'prompt' | 'denied' | 'error';

export interface FolderInfo {
  state: FolderState;
  name?: string;
  /** Random id given when the folder was chosen, so a new folder never counts as backed up. */
  id?: string;
  error?: string;
}

/** Access to the chosen backup folder; the browser version wraps File System Access. */
export interface FolderAccess {
  /** The folder and its permission, without prompting. `dir` only when granted and reachable. */
  current(): Promise<FolderInfo & { dir?: BackupDir }>;
}

/** What is kept on this device about backups (never in a document). */
export interface StoredStatus {
  lastBackupAt?: string;
  lastBackupName?: string;
  lastReason?: string;
  lastFolderId?: string;
  lastContentKey?: string;
  /** Last automatic check that found nothing new since the last backup, which was still there. */
  lastCheckedAt?: string;
  lastDownloadAt?: string;
  /** When this device last told the other devices what its backups hold (cover records, #83). */
  lastCoverAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  staleAfterHours?: number;
  /** This device writes only encrypted backups. */
  encrypted?: boolean;
  /** The mode changed: rewrite every file of `current/` once, so none stays in the old form. */
  rewriteCurrent?: boolean;
}

export interface StatusStore {
  load(): StoredStatus;
  save(status: StoredStatus): void;
}

export interface BackupState extends StoredStatus {
  folder: FolderInfo;
  running: boolean;
  /** One-off message, for example the result of a replace after the reload. */
  notice?: string;
}

export type RunResult =
  | { status: 'written'; manifest: Manifest }
  | { status: 'unchanged' }
  | { status: 'no-folder'; folder: FolderInfo }
  | { status: 'busy' }
  | { status: 'failed'; error: string };

/** Runs `fn` while holding a lock shared by all tabs; `wait: false` gives up when it is held. */
export type LockFn = <T>(fn: () => Promise<T>, wait: boolean) => Promise<T | 'busy'>;

const noLock: LockFn = (fn) => fn();

export interface ServiceOptions {
  docs: () => ReadonlyMap<string, Y.Doc>;
  deviceId: string;
  /** The folder's per-account sub-folder name. */
  accountId: string;
  /** This device's change log; its segments are copied into the folder. Omit to copy none. */
  history?: SegmentStore;
  /** The file store of a space (#166); defaults to the device's own. */
  blobs?: (unit: string) => BlobStore;
  /** The account's encryption key and parameters on this device, once the passphrase was entered. */
  keyring?: () => Promise<{ key: CryptoKey; params: EncryptionParams } | undefined>;
  folder: FolderAccess;
  /** Told after each folder backup, each download, and an unchanged check when the last telling is old: what the backup holds. */
  onBackup?: (e: { kind: 'folder' | 'download'; encrypted: boolean; at: string; documents: readonly BackedUpDoc[] }) => void;
  status: StatusStore;
  lock?: LockFn;
  now?: () => Date;
}

/**
 * Decides when to back up and makes sure only one backup runs at a time (in this tab by a
 * promise chain, across tabs by the lock). Automatic runs skip writing when nothing changed
 * since the last backup in the same folder; "Back up now" always writes.
 */
export class BackupService {
  private stored: StoredStatus;
  private folderInfo: FolderInfo = { state: 'none' };
  private running = false;
  private notice: string | undefined;
  private readonly listeners = new Set<(s: BackupState) => void>();
  private inflight: Promise<RunResult> | undefined;
  private next: { reason: string; force: boolean; promise: Promise<RunResult> } | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private readonly lock: LockFn;
  private readonly now: () => Date;

  constructor(private readonly opts: ServiceOptions) {
    this.stored = opts.status.load();
    this.lock = opts.lock ?? noLock;
    this.now = opts.now ?? (() => new Date());
  }

  get state(): BackupState {
    return { ...this.stored, folder: this.folderInfo, running: this.running, notice: this.notice };
  }

  subscribe(fn: (s: BackupState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) l(s);
  }

  private save(patch: Partial<StoredStatus>): void {
    this.stored = { ...this.stored, ...patch };
    this.opts.status.save(this.stored);
    this.emit();
  }

  setNotice(text: string | undefined): void {
    this.notice = text;
    this.emit();
  }

  setEncrypted(on: boolean): void {
    this.save({ encrypted: on, lastContentKey: undefined, rewriteCurrent: true });
  }

  setStaleAfterHours(hours: number): void {
    this.save({ staleAfterHours: hours });
  }

  /** Re-read the folder state (after choosing a folder or granting permission). */
  async refreshFolder(): Promise<FolderInfo> {
    const { dir: _dir, ...info } = await this.opts.folder.current();
    this.folderInfo = info;
    this.emit();
    return info;
  }

  /** Back up after each stopped timer (debounced) and every hour while open. Returns a stop function. */
  start(bus: EventBus): () => void {
    const off = bus.on('timer:stopped', () => this.schedule('timer-stopped', STOP_DEBOUNCE_MS));
    const hourly = setInterval(() => void this.run('hourly'), HOURLY_MS);
    const last = this.lastGoodAt();
    if (last === undefined || this.now().getTime() - last > HOURLY_MS) this.schedule('hourly', STARTUP_DELAY_MS);
    void this.refreshFolder();
    return () => {
      off();
      clearInterval(hourly);
      if (this.debounce) clearTimeout(this.debounce);
    };
  }

  /** Resolves once no backup is running or queued. */
  async whenIdle(): Promise<void> {
    while (this.inflight || this.next) await (this.next?.promise ?? this.inflight);
  }

  private schedule(reason: string, delay: number): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.run(reason);
    }, delay);
  }

  /**
   * Run a backup. While one runs, further requests are merged into a single follow-up run, which
   * picks up changes made after the running one took its snapshot.
   */
  run(reason: string, opts: { force?: boolean } = {}): Promise<RunResult> {
    const force = opts.force === true;
    if (!this.inflight) return this.begin(reason, force);
    if (this.next) {
      this.next.force ||= force;
      if (force) this.next.reason = reason;
      return this.next.promise;
    }
    const next = { reason, force, promise: undefined as unknown as Promise<RunResult> };
    next.promise = this.inflight.then(() => {
      this.next = undefined;
      return this.begin(next.reason, next.force);
    });
    this.next = next;
    return next.promise;
  }

  private begin(reason: string, force: boolean): Promise<RunResult> {
    this.running = true;
    this.emit();
    const p = this.lock(() => this.exec(reason, force), force)
      .then((r) => (r === 'busy' ? ({ status: 'busy' } as const) : r))
      .catch((e: unknown): RunResult => {
        reportError('backup', e);
        this.save({ lastErrorAt: this.now().toISOString(), lastError: errText(e) });
        return { status: 'failed', error: errText(e) };
      })
      .finally(() => {
        if (this.inflight === p) {
          this.inflight = undefined;
          this.running = false;
          this.emit();
        }
      });
    this.inflight = p;
    return p;
  }

  private async exec(reason: string, force: boolean): Promise<RunResult> {
    const folder = await this.opts.folder.current();
    const { dir, ...info } = folder;
    this.folderInfo = info;
    this.emit();
    if (info.state !== 'granted' || !dir) return { status: 'no-folder', folder: info };

    // An encrypted device writes every file encrypted and no readable exports; without the key it writes nothing.
    const ring = this.stored.encrypted ? await this.opts.keyring?.() : undefined;
    if (this.stored.encrypted && !ring) {
      const error = 'Encrypted backups are on, but this device does not have the passphrase. Enter it on Backup & restore, under Encrypted backups.';
      this.save({ lastErrorAt: this.now().toISOString(), lastError: error });
      return { status: 'failed', error };
    }
    const stores = this.opts.blobs ?? blobStore;
    const docs = this.opts.docs();
    const found = await (await blobsModule()).collectBlobs(docs, stores);
    const snap = await createSnapshot(docs, { deviceId: this.opts.deviceId, reason, now: this.now(), readable: !ring, files: { ...found, storage: 'folder' } });
    const s = this.stored;
    const acct = new SubDir(ring ? new EncryptedDir(dir, ring.key) : dir, this.opts.accountId);
    if (
      !force &&
      s.lastContentKey === snap.contentKey &&
      s.lastFolderId === info.id &&
      s.lastBackupName &&
      (await acct.exists(`${CURRENT}/${MANIFEST}`))
    ) {
      this.save({ lastCheckedAt: this.now().toISOString() });
      // The folder still holds exactly this state: tell the other devices again once the last telling is old.
      const told = s.lastCoverAt ? Date.parse(s.lastCoverAt) : NaN;
      if (Number.isNaN(told) || this.now().getTime() - told >= COVER_REFRESH_MS) this.tell('folder', snap.manifest);
      return { status: 'unchanged' };
    }
    try {
      if (ring) await writeFolderEncryption(dir, this.opts.accountId, ring.params);
      const at = this.now().getTime();
      const segments = this.opts.history ? await copySegments(this.opts.history, [...snap.manifest.documents.map((d) => d.id)], acct) : { written: {}, present: 0 };
      // Files first, so no manifest ever lists bytes the folder lacks; each hash is copied once, whatever the number of backups.
      const { copyBlobs, storeReader } = await blobsModule();
      const read = storeReader(stores);
      await copyBlobs(acct, snap.manifest.blobs, read, ring ? await blobNamer(ring.key) : async (h) => h);
      await writeCurrent(acct, snap, s.rewriteCurrent === true, ring ? undefined : { read });
      // A restore point on "Back up now", and weekly otherwise; the folder's index is written last.
      const points = await listRestorePoints(acct);
      const newest = points.map((p) => p.manifest.created_at).sort().pop();
      let manifest = snap.manifest;
      if (force || restorePointDue(newest, at)) manifest = (await addRestorePoint(acct, snap, at, reason !== 'before-restore')).manifest;
      await writeIndex(
        acct,
        {
          account: this.opts.accountId,
          updated_at: snap.manifest.created_at,
          device_id: this.opts.deviceId,
          current: snap.manifest.name,
          restore_points: (await listRestorePoints(acct)).map((p) => p.name).sort(),
        },
        segments.written,
      );
      this.save({
        lastBackupAt: manifest.created_at,
        lastBackupName: manifest.name,
        lastReason: reason,
        lastFolderId: info.id,
        lastContentKey: snap.contentKey,
        rewriteCurrent: undefined,
        lastErrorAt: undefined,
        lastError: undefined,
      });
      this.tell('folder', snap.manifest);
      return { status: 'written', manifest };
    } catch (e) {
      // Permission may have been withdrawn while writing; show that rather than a raw error.
      const { dir: _d, ...after } = await this.opts.folder.current();
      this.folderInfo = after;
      reportError('backup', e);
      this.save({ lastErrorAt: this.now().toISOString(), lastError: errText(e) });
      return { status: 'failed', error: errText(e) };
    }
  }

  /** Record what a backup holds for the other devices (the sink never throws). */
  private tell(kind: 'folder' | 'download', manifest: Manifest): void {
    this.opts.onBackup?.({ kind, encrypted: this.stored.encrypted === true, at: manifest.created_at, documents: manifest.documents });
    this.save({ lastCoverAt: this.now().toISOString() });
  }

  /** A whole backup as one JSON file, for browsers without folder access (or as an extra copy). It leaves the files in notes out. */
  async downloadable(): Promise<{ fileName: string; text: string; manifest: Manifest; leftOut: { count: number; bytes: number } }> {
    if (this.stored.encrypted) throw new Error('A downloaded file is not encrypted. Turn off encrypted backups on this device to download one.');
    const docs = this.opts.docs();
    const found = await (await blobsModule()).collectBlobs(docs, this.opts.blobs ?? blobStore);
    const snap = await createSnapshot(docs, { deviceId: this.opts.deviceId, reason: 'download', now: this.now(), files: { ...found, storage: 'none' } });
    const text = bundleText(snap);
    this.save({ lastDownloadAt: snap.manifest.created_at });
    this.tell('download', snap.manifest);
    return { fileName: `backup-${snap.manifest.name}.json`, text, manifest: snap.manifest, leftOut: { count: found.blobs.length + found.missing, bytes: found.blobs.reduce((n, b) => n + b.size, 0) } };
  }

  /** A whole backup as one store-only zip (ZIP64), files in notes included. Built from parts, so the files are never one buffer. */
  async downloadZip(): Promise<{ fileName: string; blob: Blob; manifest: Manifest }> {
    if (this.stored.encrypted) throw new Error('A downloaded file is not encrypted. Turn off encrypted backups on this device to download one.');
    const stores = this.opts.blobs ?? blobStore;
    const docs = this.opts.docs();
    const found = await (await blobsModule()).collectBlobs(docs, stores);
    const snap = await createSnapshot(docs, { deviceId: this.opts.deviceId, reason: 'download', now: this.now(), files: { ...found, storage: 'zip' } });
    const entries: ZipInput[] = [];
    const held: typeof found.blobs = [];
    for (const b of found.blobs) {
      const data = await (await blobsModule()).storeReader(stores)(b);
      if (!data) {
        snap.manifest.blobs_missing++;
        continue;
      }
      held.push(b);
      entries.push({ path: blobPath(b), data });
    }
    snap.manifest.blobs = held;
    for (const [path, data] of snap.files) entries.unshift({ path, data });
    entries.push({ path: MANIFEST, data: encodeText(`${JSON.stringify(snap.manifest, null, 2)}\n`) });
    // Loaded on use: only a zip download needs the writer, and the main bundle is on a budget.
    const { zipBlob } = await import('./zip');
    const blob = await zipBlob(entries, { now: this.now() });
    this.save({ lastDownloadAt: snap.manifest.created_at });
    this.tell('download', snap.manifest);
    return { fileName: `backup-${snap.manifest.name}.zip`, blob, manifest: snap.manifest };
  }

  /** The most recent moment the data was known to be in a backup. */
  lastGoodAt(): number | undefined {
    const times = [this.stored.lastBackupAt, this.stored.lastCheckedAt, this.stored.lastDownloadAt]
      .filter((t): t is string => typeof t === 'string')
      .map((t) => Date.parse(t))
      .filter((t) => !Number.isNaN(t));
    return times.length ? Math.max(...times) : undefined;
  }
}

export interface Health {
  ok: boolean;
  kind: 'ok' | 'never' | 'stale' | 'failed' | 'permission' | 'lost' | 'empty';
  text: string;
  /** The data is safe because another device's recent backup holds it (not this device's own). */
  covered?: boolean;
}

export function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/**
 * Whether the data is safely backed up. Not ok when folder access was lost, the last run failed,
 * there is data but no backup, or the last backup is older than the threshold.
 */
export function backupHealth(s: BackupState, now: number, hasData: boolean): Health {
  const name = s.folder.name ? ` "${s.folder.name}"` : '';
  if (s.folder.state === 'prompt') {
    return { ok: false, kind: 'permission', text: `Automatic backups are paused: allow access to the backup folder${name} again.` };
  }
  if (s.folder.state === 'denied' || s.folder.state === 'error') {
    return { ok: false, kind: 'lost', text: `Automatic backups stopped: the backup folder${name} cannot be reached. Choose it again.` };
  }
  const times = [s.lastBackupAt, s.lastCheckedAt, s.lastDownloadAt].map((t) => (t ? Date.parse(t) : NaN)).filter((t) => !Number.isNaN(t));
  const last = times.length ? Math.max(...times) : undefined;
  const lastSuccess = s.lastBackupAt ? Date.parse(s.lastBackupAt) : 0;
  if (s.lastErrorAt && Date.parse(s.lastErrorAt) > lastSuccess) {
    return { ok: false, kind: 'failed', text: `The last backup failed: ${s.lastError ?? 'unknown error'}` };
  }
  const limit = (s.staleAfterHours ?? DEFAULT_STALE_HOURS) * 3_600_000;
  if (last === undefined) {
    if (!hasData) return { ok: true, kind: 'empty', text: 'Nothing to back up yet.' };
    const how = s.folder.state === 'unsupported' ? 'Download a backup' : 'Choose a backup folder';
    return { ok: false, kind: 'never', text: `No backup yet. ${how} so your data survives a cleared browser.` };
  }
  if (now - last > limit) return { ok: false, kind: 'stale', text: `The last backup was ${ago(now - last)}.` };
  return { ok: true, kind: 'ok', text: `Backed up ${ago(now - last)}.` };
}
