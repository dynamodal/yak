import type * as Y from 'yjs';
import { blobStore, type BlobStore } from '../core/blobs/store';
import { emptyState, folderName, MIRROR_ORIGIN, syncMirror, type MirrorSpace, type MirrorState } from './engine';
import type { MirrorFs } from './fs';

export type FolderState = 'unsupported' | 'none' | 'granted' | 'prompt' | 'denied' | 'error';

export interface FolderInfo {
  state: FolderState;
  name?: string;
  /** Random id given when the folder was chosen, so a new folder starts from an empty state. */
  id?: string;
  error?: string;
}

/** Access to the chosen folder; the browser version wraps File System Access. */
export interface FolderAccess {
  /** The folder and its permission, without prompting. `fs` only when granted and reachable. */
  current(): Promise<FolderInfo & { fs?: MirrorFs }>;
}

/** What is kept on this device (never in a document). */
export interface Persisted {
  /** The folder `state` belongs to. */
  folderId?: string;
  /** Space ids the user left out. */
  excluded: string[];
  state: MirrorState;
  /** Conflict copies not yet dismissed, as `Folder/Name (conflict).md`. */
  conflicts: string[];
  lastRunAt?: string;
  lastResult?: MirrorResult;
}

/** How the last pass ended, and when (#95). Kept on this device with the rest. */
export interface MirrorResult {
  at: string;
  ok: boolean;
  /** Why it failed; absent when ok. */
  error?: string;
}

export interface MirrorStore {
  load(): Promise<Persisted>;
  save(p: Persisted): Promise<void>;
}

export interface SpaceInput {
  id: string;
  name: string;
  doc: Y.Doc;
  /** The space's file store; defaults to the IndexedDB one for the space id. */
  blobs?: BlobStore;
}

export interface MirrorServiceState {
  folder: FolderInfo;
  running: boolean;
  lastRunAt?: string;
  lastResult?: MirrorResult;
  conflicts: string[];
  errors: string[];
  excluded: string[];
  /** Why the last pass failed as a whole, if it did. */
  error?: string;
}

/** Runs `fn` while holding a lock shared by all tabs; `wait: false` gives up when it is held. */
export type LockFn = <T>(fn: () => Promise<T>, wait: boolean) => Promise<T | 'busy'>;

const POLL_MS = 4_000;
const NOTE_DEBOUNCE_MS = 800;

export interface MirrorServiceOptions {
  /** The spaces this device keeps. */
  spaces: () => SpaceInput[];
  folder: FolderAccess;
  store: MirrorStore;
  lock?: LockFn;
}

/** Folder names for spaces: unique, so two spaces never share a folder. */
export function mirrorSpaces(spaces: readonly SpaceInput[], excluded: readonly string[]): MirrorSpace[] {
  const used = new Set<string>();
  const out: MirrorSpace[] = [];
  for (const s of spaces) {
    if (excluded.includes(s.id)) continue;
    let folder = folderName(s.name);
    for (let n = 2; used.has(folder.toLowerCase()); n++) folder = `${folderName(s.name)} ${n}`;
    used.add(folder.toLowerCase());
    out.push({ id: s.id, folder, doc: s.doc, blobs: s.blobs ?? blobStore(s.id) });
  }
  return out;
}

/**
 * Decides when to run the engine and makes sure only one pass runs at a time (in this tab by a
 * flag, across tabs by the lock). Triggers: a change to a mirrored space's notes, a timer while
 * the page is visible, the page becoming visible, and the folder reporting a change.
 */
export class MirrorService {
  private folderInfo: FolderInfo = { state: 'none' };
  private data: Pick<MirrorServiceState, 'running' | 'lastRunAt' | 'lastResult' | 'conflicts' | 'errors' | 'excluded' | 'error'> = {
    running: false,
    conflicts: [],
    errors: [],
    excluded: [],
  };
  private readonly listeners = new Set<(s: MirrorServiceState) => void>();
  private inflight: Promise<void> | undefined;
  private again = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private readonly watched = new Map<Y.Doc, () => void>();
  private readonly lock: LockFn;

  constructor(private readonly opts: MirrorServiceOptions) {
    this.lock = opts.lock ?? ((fn) => fn());
  }

  get state(): MirrorServiceState {
    return { ...this.data, folder: this.folderInfo };
  }

  subscribe(fn: (s: MirrorServiceState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) l(s);
  }

  /** Re-read the folder and the saved settings (after choosing a folder or granting permission). */
  async refresh(): Promise<FolderInfo> {
    const { fs: _fs, ...info } = await this.opts.folder.current();
    this.folderInfo = info;
    const p = await this.opts.store.load();
    this.data = { ...this.data, excluded: p.excluded, conflicts: p.conflicts, lastRunAt: p.lastRunAt, lastResult: p.lastResult };
    this.emit();
    return info;
  }

  async setExcluded(spaceId: string, excluded: boolean): Promise<void> {
    const p = await this.opts.store.load();
    const set = new Set(p.excluded);
    if (excluded) set.add(spaceId);
    else set.delete(spaceId);
    await this.opts.store.save({ ...p, excluded: [...set] });
    await this.refresh();
    void this.run();
  }

  async dismissConflicts(): Promise<void> {
    const p = await this.opts.store.load();
    await this.opts.store.save({ ...p, conflicts: [] });
    await this.refresh();
  }

  /** Stop mirroring: forget the folder's state so a later folder starts clean. */
  async reset(): Promise<void> {
    const p = await this.opts.store.load();
    await this.opts.store.save({ excluded: p.excluded, state: emptyState(), conflicts: [] });
    this.data = { ...this.data, errors: [], error: undefined, conflicts: [], lastResult: undefined };
    await this.refresh();
  }

  /** Start the triggers. Returns a stop function. */
  start(): () => void {
    const tick = (): void => {
      this.watchDocs();
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.run();
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    void this.refresh().then(tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (this.debounce) clearTimeout(this.debounce);
      for (const off of this.watched.values()) off();
      this.watched.clear();
    };
  }

  /** The folder changed under us (File System Observer). */
  notifyFolderChanged(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.run();
    }, NOTE_DEBOUNCE_MS);
  }

  private watchDocs(): void {
    const current = new Set(this.opts.spaces().map((s) => s.doc));
    for (const [doc, off] of this.watched) {
      if (!current.has(doc)) {
        off();
        this.watched.delete(doc);
      }
    }
    for (const doc of current) {
      if (this.watched.has(doc)) continue;
      const onUpdate = (_u: Uint8Array, origin: unknown): void => {
        if (origin !== MIRROR_ORIGIN) this.schedule();
      };
      doc.on('update', onUpdate);
      this.watched.set(doc, () => doc.off('update', onUpdate));
    }
  }

  /** Resolves once no pass is running or queued. */
  async whenIdle(): Promise<void> {
    while (this.inflight) await this.inflight;
  }

  /** One pass. A request during a pass is merged into one follow-up pass. */
  run(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    const p = this.pass().finally(() => {
      this.inflight = undefined;
      if (this.again) {
        this.again = false;
        void this.run();
      }
    });
    this.inflight = p;
    return p;
  }

  private async pass(): Promise<void> {
    this.data = { ...this.data, running: true };
    this.emit();
    try {
      const folder = await this.opts.folder.current();
      const { fs, ...info } = folder;
      this.folderInfo = info;
      if (!fs) return;
      const done = await this.lock(async () => {
        const p = await this.opts.store.load();
        // A different folder than the state was made for: start clean, nothing is deleted.
        const state = p.folderId === info.id ? p.state : emptyState();
        const report = await syncMirror(fs, mirrorSpaces(this.opts.spaces(), p.excluded), state);
        const conflicts = [...new Set([...p.conflicts, ...report.conflicts])];
        const lastRunAt = new Date().toISOString();
        const lastResult: MirrorResult = report.errors.length === 0 ? { at: lastRunAt, ok: true } : { at: lastRunAt, ok: false, error: `${report.errors.length} file${report.errors.length === 1 ? '' : 's'} could not be mirrored` };
        await this.opts.store.save({ folderId: info.id, excluded: p.excluded, state, conflicts, lastRunAt, lastResult });
        this.data = { ...this.data, errors: report.errors, error: undefined, conflicts, excluded: p.excluded, lastRunAt, lastResult };
        return true;
      }, false);
      if (done === 'busy') return;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const lastResult: MirrorResult = { at: new Date().toISOString(), ok: false, error };
      this.data = { ...this.data, error, lastResult };
      // Kept so the reason is still there after a reload; a store that fails too changes nothing.
      await this.opts.store.load().then((p) => this.opts.store.save({ ...p, lastResult })).catch(() => undefined);
    } finally {
      this.data = { ...this.data, running: false };
      this.emit();
    }
  }
}
