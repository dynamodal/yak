import { useEffect, useRef, useState } from 'preact/hooks';
import { useNow } from '../app/hooks';
import * as Y from 'yjs';
import { useApp } from '../app/context';
import { readSpaces } from '../core/account';
import { askBackupPassphrase, withKey as withAccountKey } from '../app/key-prompt';
import { Button, FileButton, Page, PageHeader } from '../app/ui';
import { WrongPassphraseError } from '../core/crypto';
import type { ViewProps } from '../app/registry';
import { HistorySection } from '../history/HistoryView';
import { ENCRYPTION_FILE, EncryptedError, keyFor, readParamsAt, withKey } from './crypto';
import { SubDir, type BackupDir } from './dir';
import { readableFolder } from './encryption-state';
import { RESTORE_POINTS, findAccounts, readIndex, snapshotDir, stateAtTime } from './incremental';
import { MANIFEST, type DocCounts, type Manifest } from './format';
import { folderPickerSupported, pickReadFolder } from './folder';
import { beforeReplace, recoverBeforeReplace, replaceSupported, startReplace, type BeforeReplace } from './replace';
import { bundleToDir, mergeBackup, openBackup, type OpenedBackup } from './restore';
import { accountBlobSource, folderBlobSource, listBlobs, restoreBlobs, totalBlobBytes, type BlobSource } from './blobs';
import { blobStore } from '../core/blobs/store';
import { readZip, ZipDir } from './zip';
import { createSnapshot } from './snapshot';
import { hasData, saveBlobFile, saveTextFile, useBackup } from './runtime';
import { type BackupService, type RunResult, DEFAULT_STALE_HOURS, backupHealth } from './service';
import { errText, listBackups, type BackupListing } from './store';
import { usePassphraseState } from './passphrase-state';
import { PassphraseSection } from './PassphraseSection';
import { requestPersistence, type PersistenceResult } from '../core/persistence';

/** Whether the browser promised to keep this site's data (`storage.persist()`), asked again each time the page opens. */
function StorageLine() {
  const [result, setResult] = useState<PersistenceResult | undefined>();
  useEffect(() => {
    let live = true;
    void requestPersistence().then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, []);
  return (
    <p class="hint" data-storage={result ?? 'checking'}>
      <strong>Storage:</strong>{' '}
      {result === 'granted' ? 'kept. The browser promised not to clear Yak\'s data on its own.' : result === undefined ? 'checking…' : 'may be cleared by the browser when this device runs low on space.'} Clearing site data for this site in your browser deletes Yak's data, and only a backup brings it back.
    </p>
  );
}

const STALE_CHOICES = [12, 24, 72, 168];

const REASONS: Record<string, string> = {
  manual: 'Back up now',
  'timer-stopped': 'Timer stopped',
  hourly: 'Hourly',
  download: 'Download',
  'permission-granted': 'Access allowed',
  'before-restore': 'Before a restore',
  'restore-to-time': 'Rebuilt for a chosen time',
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const totalBytes = (m: Manifest): number => Object.values(m.files).reduce((a, f) => a + f.bytes, 0);
const live = (c: { total: number; deleted: number }): number => c.total - c.deleted;
const when = (iso: string | undefined): string => (iso ? new Date(iso).toLocaleString() : 'never');

function CountsLine({ counts }: { counts: DocCounts }) {
  return (
    <span>
      {live(counts.time_entries)} entries, {live(counts.notes)} notes, {live(counts.projects)} projects
    </span>
  );
}

/** A backed-up document by what people know it as: the space name, its private part, or the account. */
function docLabel(id: string, spaces: readonly { id: string; name: string }[]): string {
  if (id.startsWith('account/')) return 'Account: devices and settings';
  const m = /^space\/([^/]+)(\/private)?$/.exec(id);
  const name = m ? spaces.find((s) => s.id === m[1])?.name : undefined;
  if (!m || !name) return id;
  return m[2] ? `${name} · private (time, rates)` : name;
}

function RestorePanel(props: { backup: OpenedBackup; source: string; onClose(): void; onDone(text: string): void }) {
  const { store, deviceId, service, state, bus } = useBackup();
  const { spaces: ourSpaces } = useApp();
  // Name documents by the backup's own account (a backup from another browser has other space ids).
  const [backupSpaces, setBackupSpaces] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const doc = props.backup.manifest.documents.find((d) => d.id.startsWith('account/'));
    if (!doc || !props.backup.verification.ok) return undefined;
    void props.backup.dir
      .readFile(doc.update)
      .then((update) => {
        const account = new Y.Doc();
        Y.applyUpdate(account, update);
        if (!cancelled) setBackupSpaces(readSpaces(account));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.backup]);
  const spaces = [...backupSpaces, ...ourSpaces];
  const { manifest, verification } = props.backup;
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  /** Put the backup's files into this device's file stores; `merge` also brings back index entries deleted here. */
  const restoreFiles = async (merge: boolean): Promise<string> => {
    const source = props.backup.blobs;
    if (!source || manifest.blobs.length === 0) return '';
    const r = await restoreBlobs(manifest, source, blobStore, merge ? (unit) => store.get(`space/${unit}`) : undefined);
    return ` ${r.restored} file${r.restored === 1 ? '' : 's'} restored${r.unavailable > 0 ? `; ${r.unavailable} could not be restored (not in the backup, or damaged)` : ''}.`;
  };

  const merge = async (): Promise<void> => {
    setError('');
    setBusy('Merging…');
    try {
      const ids = await mergeBackup(props.backup, (id) => store.open(id));
      const files = await restoreFiles(true);
      bus.emit('backup:restored', { docIds: ids });
      props.onDone(`Merged the backup from ${when(manifest.created_at)} into ${ids.length} document${ids.length === 1 ? '' : 's'}. Nothing on this device was removed.${files}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  const replace = async (): Promise<void> => {
    setError('');
    setBusy('Saving a copy of the current data…');
    try {
      // A last backup of what is about to be replaced, when a folder is available.
      if (state.folder.state === 'granted') {
        const r = await service.run('before-restore', { force: true });
        if (r.status === 'failed') throw new Error(`Could not back up the current data first: ${r.error}`);
      }
      setBusy('Restoring files…');
      await restoreFiles(false);
      setBusy('Replacing…');
      await startReplace(props.backup, store.opened(), () => setBusy('Waiting for other tabs of the app to close…'));
    } catch (e) {
      setError(errText(e));
      setBusy('');
    }
  };

  return (
    <div class="card restore-panel" aria-label="Restore">
      <h2>Restore: {when(manifest.created_at)}</h2>
      <dl class="backup-facts">
        <dt>From</dt>
        <dd>{props.source}</dd>
        <dt>Device</dt>
        <dd>{manifest.device_id === deviceId ? 'This device' : manifest.device_id.slice(0, 8)}</dd>
        <dt>Made by</dt>
        <dd>
          {REASONS[manifest.reason] ?? manifest.reason}, format {manifest.format_version}, {bytes(totalBytes(manifest))}
        </dd>
      </dl>
      {(manifest.blobs.length > 0 || manifest.blobs_missing > 0) && (
        <p class="hint backup-files" data-files={manifest.blobs.length}>
          Files in notes: {manifest.blobs.length} ({bytes(totalBlobBytes(manifest.blobs))}).{' '}
          {manifest.blob_storage === 'none' && manifest.blobs.length > 0 && 'This file was made without them: the notes name them but the files are not in it. Restore from a zip download or a backup folder to get them.'}
          {manifest.blobs_missing > 0 && `${manifest.blobs_missing} more were not on the device that made this backup yet.`}
        </p>
      )}
      <table class="backup-docs">
        <thead>
          <tr>
            <th>Document</th>
            <th>Entries</th>
            <th>Notes</th>
            <th>Projects</th>
            <th>Clients</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {manifest.documents.map((d) => (
            <tr key={d.id} data-doc={d.id}>
              <td title={d.id}>{docLabel(d.id, spaces)}</td>
              <td>
                {live(d.counts.time_entries)}
                {d.counts.time_entries.deleted ? <span class="hint"> (+{d.counts.time_entries.deleted} deleted)</span> : null}
              </td>
              <td>{live(d.counts.notes)}</td>
              <td>{live(d.counts.projects)}</td>
              <td>{live(d.counts.clients)}</td>
              <td>{live(d.counts.tags)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {verification.ok ? (
        <p class="verify ok">All {verification.checked} files match their checksums.</p>
      ) : (
        <div class="verify bad" role="alert">
          <p>This backup is damaged and cannot be restored:</p>
          <ul>
            {verification.problems.slice(0, 10).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {verification.ok && !confirming && (
        <div class="row">
          <Button variant="primary" disabled={!!busy} onClick={() => void merge()}>
            Merge into this device
          </Button>
          {replaceSupported() && (
            <Button variant="danger" disabled={!!busy} onClick={() => setConfirming(true)}>
              Replace local data…
            </Button>
          )}
        </div>
      )}
      {!confirming && (
        <div class="row">
          <Button disabled={!!busy} onClick={props.onClose}>
            {verification.ok ? 'Cancel' : 'Close'}
          </Button>
        </div>
      )}
      {verification.ok && !confirming && (
        <p class="hint">Merge adds whatever is missing on this device and keeps everything else, including later edits.</p>
      )}
      {confirming && (
        <div class="confirm-replace">
          <p>
            Replace removes this device's data and loads the backup exactly as it was. Changes made after{' '}
            {when(manifest.created_at)} are removed from this device. The current data is kept on this device so it can be
            merged back{state.folder.state === 'granted' ? ', and a backup of it is written to the backup folder first' : ''}.
            Paired devices are not changed and send their data back when they connect. Close other tabs of the app first.
          </p>
          <label class="row">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood((e.target as HTMLInputElement).checked)} />
            I understand that later changes on this device will be removed.
          </label>
          <div class="row">
            <Button variant="danger" disabled={!understood || !!busy} onClick={() => void replace()}>
              Replace and reload
            </Button>
            <Button disabled={!!busy} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
      {busy ? <p class="hint">{busy}</p> : null}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Pick a moment; the documents are rebuilt from the newest restore point before it plus the log segments up to it, then shown like any backup. */
function TimeRestore(props: { source: { dir: BackupDir; accounts: string[] }; deviceId: string; accountId: string; readable(dir: BackupDir, account: string): Promise<BackupDir>; onClose: () => void; onOpen: (b: OpenedBackup, source: string) => void }) {
  const [account, setAccount] = useState(props.source.accounts[0] ?? '');
  const [at, setAt] = useState(() => localInput(Date.now()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const show = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const ms = new Date(at).getTime();
      if (!Number.isFinite(ms)) throw new Error('Choose a date and time.');
      const view = await props.readable(props.source.dir, account);
      const state = await stateAtTime(view, account, ms);
      const snap = await createSnapshot(state.docs, { deviceId: props.deviceId, reason: 'restore-to-time', now: new Date(ms), files: { blobs: listBlobs(state.docs), missing: 0, storage: 'folder' } });
      props.onOpen(await openBackup(snapshotDir(snap), accountBlobSource(view, account)), `the folder as of ${when(new Date(ms).toISOString())}${state.base ? `, from the restore point ${state.base} and ${state.segments} log segments` : `, from ${state.segments} log segments`}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card time-restore" aria-label="Restore to a time">
      <h3>Restore to a time</h3>
      <p class="hint">Rebuilds your data as it was then, from the newest restore point before it and the changes logged after. You see what it holds before anything changes.</p>
      <div class="row">
        {props.source.accounts.length > 1 && (
          <label>
            Account{' '}
            <select aria-label="Account" value={account} onChange={(e) => setAccount((e.target as HTMLSelectElement).value)}>
              {props.source.accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          As of <input type="datetime-local" aria-label="Restore as of" value={at} onInput={(e) => setAt((e.target as HTMLInputElement).value)} />
        </label>
        <Button variant="primary" disabled={busy || !account} onClick={() => void show()}>
          Show that time
        </Button>
        <Button disabled={busy} onClick={props.onClose}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Encrypted backups are written only with the passphrase, which is created in the passphrase sheet (F-324). */
function EncryptionPanel(props: { account: Y.Doc; accountId: string; service: BackupService; encrypted: boolean }) {
  const { account, accountId, service, encrypted } = props;
  const { params, hasKey } = usePassphraseState(account, accountId);
  return (
    <>
      <h2>Encrypted backups</h2>
      {!params ? (
        <div class="card" aria-label="Set a backup passphrase">
          <p>Encrypted backups hold no readable files. They need a passphrase, which you set once.</p>
          <div class="row">
            <Button variant="primary" onClick={() => void withAccountKey({ verb: 'continue', run: async () => undefined })}>
              Create a passphrase…
            </Button>
          </div>
        </div>
      ) : !hasKey ? (
        <div class="card" aria-label="Unlock encrypted backups">
          <p>This account has a passphrase. Enter it once to let this device write and read encrypted backups.</p>
          <div class="row">
            <Button variant="primary" onClick={() => void withAccountKey({ verb: 'continue', fresh: true, run: async () => undefined })}>
              Enter passphrase…
            </Button>
          </div>
        </div>
      ) : (
        <div class="card">
          <label class="row">
            <input type="checkbox" checked={encrypted} onChange={(e) => service.setEncrypted((e.target as HTMLInputElement).checked)} />
            Write only encrypted backups from this device
          </label>
          <p class="hint">
            Files already in the folder stay as they are; delete older backups there if they must not stay readable. Downloaded backup files are not encrypted, so downloads are off while this is on.
          </p>
        </div>
      )}
    </>
  );
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** `YYYY-MM-DDTHH:mm` local, the value of a datetime-local input. */
function localInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function BackupsView({ params }: ViewProps) {
  const { state, service, folder, store, deviceId, accountId } = useBackup();
  const { account, spaces } = useApp();
  // The passphrase of an encrypted backup being restored, asked for in the passphrase sheet only when the folder needs one and this device does not hold it.
  const restorePass = useRef('');
  const needPass = async <T,>(fn: (pass: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(restorePass.current);
    } catch (e) {
      if (!(e instanceof EncryptedError || e instanceof WrongPassphraseError)) throw e;
      const asked = await askBackupPassphrase('restore');
      if (!asked) throw e;
      restorePass.current = asked;
      return fn(asked);
    }
  };
  const now = useNow(60_000);
  const [history, setHistory] = useState<{ items: BackupListing[]; total: number } | undefined>();
  const [historyError, setHistoryError] = useState('');
  const [opened, setOpened] = useState<{ backup: OpenedBackup; source: string } | undefined>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<BeforeReplace | undefined>();
  const [timeSource, setTimeSource] = useState<{ dir: BackupDir; accounts: string[] } | undefined>();
  const picker = folderPickerSupported();
  const { hasKey } = usePassphraseState(account, accountId);
  const health = backupHealth(state, now, hasData(store.opened()));
  const fileTotal = (() => {
    const all = listBlobs(store.opened());
    return { count: all.length, bytes: totalBlobBytes(all) };
  })();

  const loadHistory = async (): Promise<void> => {
    setHistoryError('');
    const f = await folder.current();
    if (!f.dir) {
      setHistory(undefined);
      return;
    }
    try {
      // Restore points of this account, and the full backups older versions made directly in the folder.
      const view = await readableFolder(f.dir, accountId, accountId, restorePass.current);
      const points = await listBackups(new SubDir(view, `${accountId}/${RESTORE_POINTS}`));
      const older = await listBackups(f.dir);
      const items = [...points.items.map((i) => ({ ...i, path: `${accountId}/${RESTORE_POINTS}/${i.name}` })), ...older.items].sort((a, b) => (a.name < b.name ? 1 : -1));
      setHistory({ items: items.slice(0, 50), total: points.total + older.total });
    } catch (e) {
      setHistoryError(errText(e));
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [state.lastBackupName, state.folder.state, state.folder.id]);

  useEffect(() => {
    void beforeReplace().then(setBefore, () => undefined);
  }, []);

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Every outcome of a backup run is said on the page, next to the button (#77). */
  const report = (r: RunResult): void => {
    if (r.status === 'written') setMessage(`Backed up to ${r.manifest.name}.`);
    else if (r.status === 'unchanged') setMessage('Nothing has changed since the last backup.');
    else if (r.status === 'failed') throw new Error(r.error);
    else if (r.status === 'busy') throw new Error('Another Yak tab is backing up right now. Try again in a moment.');
    else throw new Error('No backup folder is available. Choose one.');
  };
  const chooseAndBackUp = async (): Promise<void> => {
    if (!(await folder.choose())) {
      setMessage('No folder was chosen.');
      return;
    }
    await service.refreshFolder();
    report(await service.run('manual', { force: true }));
  };
  const backUpNow = async (): Promise<void> => {
    // Without a usable folder the button leads to one: the picker for none or a lost folder, the permission prompt for a paused one.
    if (picker && state.folder.state === 'prompt') {
      await folder.requestAccess();
      await service.refreshFolder();
    } else if (picker && state.folder.state !== 'granted') {
      return chooseAndBackUp();
    }
    report(await service.run('manual', { force: true }));
  };
  /** Why Back up now cannot run, or what pressing it does when the folder is not ready. */
  const lockedOut = state.encrypted === true && !hasKey;
  const backUpNote = !picker
    ? 'This browser cannot write to a folder. Use a download below.'
    : lockedOut
      ? 'Encrypted backups are on, but this device does not have the passphrase. Enter it under Encrypted backups below.'
      : state.folder.state === 'none'
        ? 'No backup folder yet. This button asks you to choose one, then backs up to it.'
        : state.folder.state === 'prompt'
          ? 'The browser needs permission again for the backup folder. This button asks for it, then backs up.'
          : state.folder.state === 'denied' || state.folder.state === 'error'
            ? 'The backup folder cannot be reached. This button asks you to choose a folder, then backs up to it.'
            : '';

  const open = async (dir: BackupDir, source: string, blobs?: BlobSource): Promise<void> => {
    setOpened({ backup: await openBackup(dir, blobs), source });
  };

  /** A picked folder can be one backup (has a manifest) or a folder of backups. */
  const openPickedFolder = async (): Promise<void> => {
    const dir = await pickReadFolder();
    if (!dir) return;
    if (await dir.exists(ENCRYPTION_FILE)) {
      // An encrypted account folder picked directly.
      const params = await readParamsAt(dir);
      if (!params) throw new Error('This folder has a damaged encryption.json.');
      const key = await needPass((p) => (p ? keyFor(p, params) : Promise.reject(new EncryptedError())));
      const current = new SubDir(withKey(dir, key), 'current');
      return open(current, 'the latest state in a picked account folder', folderBlobSource(withKey(dir, key), key, current));
    }
    if (await readIndex(dir)) {
      const current = new SubDir(dir, 'current');
      return open(current, 'the latest state in a picked account folder', folderBlobSource(dir, undefined, current));
    }
    if (await dir.exists(MANIFEST)) return open(dir, 'a picked folder');
    const accounts = await findAccounts(dir);
    const acct = accounts[0];
    if (acct) {
      setTimeSource({ dir, accounts });
      const view = await needPass((p) => readableFolder(dir, acct, accountId, p));
      const current = new SubDir(view, `${acct}/current`);
      return open(current, 'the latest state in a picked folder', accountBlobSource(view, acct, current));
    }
    const { items } = await listBackups(dir, 1);
    const newest = items.find((i) => i.manifest);
    if (!newest) throw new Error('No backups found in that folder.');
    await open(new SubDir(dir, newest.name), `the newest backup in a picked folder (${newest.name})`);
  };

  const fromFile = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // A zip (with files) or the JSON file (without). The zip is read lazily: its files stay on disk until restored.
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') return open(new ZipDir(await readZip(file)), `file ${file.name}`);
    await open(bundleToDir(await file.text()), `file ${file.name}`);
  };

  return (
    <Page width="settings" class="backups">
      <PageHeader title="Backup & restore" />
      <p class="help-link"><a href="#/help/backups">How this works</a></p>
      <p class={`backup-health ${health.ok ? 'ok' : 'warn'}`}>{health.text}</p>
      {state.notice ? <p class="hint">{state.notice}</p> : null}
      <StorageLine />

      <h2>Backup folder</h2>
      {picker ? (
        <div class="card">
          <p>
            {state.folder.state === 'none' && 'No folder chosen. Pick a folder that is itself backed up, for example in OneDrive.'}
            {state.folder.state === 'granted' && (
              <>
                Backing up to <strong>{state.folder.name}</strong> after each stopped timer and every hour while the app is open.
              </>
            )}
            {state.folder.state === 'prompt' && <>The browser needs permission again to write to {state.folder.name}.</>}
            {(state.folder.state === 'denied' || state.folder.state === 'error') && (
              <>
                The folder {state.folder.name} cannot be reached{state.folder.error ? `: ${state.folder.error}` : ''}. Choose it again.
              </>
            )}
          </p>
          <div class="row">
            <Button
              disabled={busy}
              onClick={() =>
                void act(chooseAndBackUp)
              }
            >
              {state.folder.state === 'none' ? 'Choose folder…' : 'Change folder…'}
            </Button>
            {state.folder.state === 'prompt' && (
              <Button
                onClick={() =>
                  void act(async () => {
                    await folder.requestAccess();
                    await service.refreshFolder();
                    report(await service.run('permission-granted'));
                  })
                }
              >
                Allow access
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p class="hint">
          This browser cannot write to a folder, so backups are not automatic here. Download a backup regularly; Chrome or Edge can
          back up to a folder by themselves.
        </p>
      )}

      <div class="row">
        <Button variant="primary" disabled={busy || lockedOut || !picker} onClick={() => void act(backUpNow)}>
          Back up now
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const d = await service.downloadZip();
              saveBlobFile(d.fileName, d.blob);
              setMessage(`Downloaded ${d.fileName}${d.manifest.blobs.length > 0 ? `, with ${d.manifest.blobs.length} file${d.manifest.blobs.length === 1 ? '' : 's'}` : ''}.`);
            })
          }
        >
          Download backup (zip, with files)
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const d = await service.downloadable();
              saveTextFile(d.fileName, d.text);
              setMessage(`Downloaded ${d.fileName}.${d.leftOut.count > 0 ? ` It leaves out the ${d.leftOut.count} file${d.leftOut.count === 1 ? '' : 's'} in your notes (${bytes(d.leftOut.bytes)}); the zip download and folder backups include them.` : ''}`);
            })
          }
        >
          Download backup (JSON, without files)
        </Button>
        {state.running && <span class="hint">Backing up…</span>}
      </div>
      {backUpNote ? (
        <p class="hint" data-backup-now-note>
          {backUpNote}
        </p>
      ) : null}
      {message ? (
        <p class="hint" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
      {fileTotal.count > 0 && (
        <p class="hint" data-testid="backup-files">
          Your notes hold {fileTotal.count} file{fileTotal.count === 1 ? '' : 's'} ({bytes(fileTotal.bytes)}). Folder backups and the zip download include them; the JSON download is text only and leaves them out.
        </p>
      )}
      <p class="hint">
        Last backup: {when(state.lastBackupAt)}
        {state.lastDownloadAt ? `. Last download: ${when(state.lastDownloadAt)}` : ''}.
      </p>
      <label class="row">
        Warn when the last backup is older than
        <select
          value={String(state.staleAfterHours ?? DEFAULT_STALE_HOURS)}
          onChange={(e) => service.setStaleAfterHours(Number((e.target as HTMLSelectElement).value))}
        >
          {STALE_CHOICES.map((h) => (
            <option key={h} value={String(h)}>
              {h < 48 ? `${h} hours` : `${h / 24} days`}
            </option>
          ))}
        </select>
      </label>

      {/* Keyed, like EncryptionPanel: a change in the conditional lines above must never remount a panel that holds typed input or an error. */}
      {opened && (
        <RestorePanel
          key="restore"
          backup={opened.backup}
          source={opened.source}
          onClose={() => setOpened(undefined)}
          onDone={(text) => {
            setOpened(undefined);
            setMessage(text);
          }}
        />
      )}

      <EncryptionPanel key="encryption" account={account} accountId={accountId} service={service} encrypted={state.encrypted === true} />

      <PassphraseSection key="passphrase" />

      <h2>Restore</h2>
      <p class="hint">Restoring checks every file's checksum first and shows what the backup holds before anything changes.</p>
      <div class="row">
        <FileButton label="Restore from a backup file…" inputLabel="Backup file" accept=".json,.zip,application/json,application/zip" onChange={(e) => void act(() => fromFile(e.target as HTMLInputElement))} />
        {picker && (
          <Button disabled={busy} onClick={() => void act(openPickedFolder)}>
            Restore from a folder…
          </Button>
        )}
      </div>
      <div class="row">
        {state.folder.state === 'granted' && (
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const f = await folder.current();
                if (!f.dir) throw new Error('The backup folder is not available.');
                const found = await findAccounts(f.dir);
                if (found.length === 0) throw new Error('This folder has no incremental backups yet. Back up first.');
                setTimeSource({ dir: f.dir, accounts: found.includes(accountId) ? [accountId, ...found.filter((a) => a !== accountId)] : found });
              })
            }
          >
            Restore to a time…
          </Button>
        )}
      </div>
      {timeSource && (
        <TimeRestore
          source={timeSource}
          deviceId={deviceId}
          accountId={accountId}
          readable={(dir, acct) => needPass((p) => readableFolder(dir, acct, accountId, p))}
          onClose={() => setTimeSource(undefined)}
          onOpen={(backup, text) => {
            setTimeSource(undefined);
            setOpened({ backup, source: text });
          }}
        />
      )}
      {before && (
        <p class="hint">
          The data from before the replace on {when(before.at)} is kept on this device.{' '}
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const ids = await recoverBeforeReplace((id) => store.open(id));
                setMessage(`Merged the earlier data back into ${ids.length} documents.`);
              })
            }
          >
            Merge it back
          </Button>
        </p>
      )}

      <h3>Backups in the folder</h3>
      {historyError ? <p class="error">{historyError}</p> : null}
      {!history ? (
        <p class="empty">{state.folder.state === 'granted' ? 'Loading…' : 'Backups made to a folder are listed here.'}</p>
      ) : history.items.length === 0 ? (
        <p class="empty">No backups in this folder yet.</p>
      ) : (
        <>
          <table class="backup-history">
            <thead>
              <tr>
                <th>When</th>
                <th>Device</th>
                <th>Why</th>
                <th>Contents</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.items.map((item) => (
                <tr key={item.name} data-name={item.name}>
                  {item.manifest ? (
                    <>
                      <td>{when(item.manifest.created_at)}</td>
                      <td>{item.manifest.device_id === deviceId ? 'This device' : item.manifest.device_id.slice(0, 8)}</td>
                      <td>{REASONS[item.manifest.reason] ?? item.manifest.reason}</td>
                      <td>
                        <CountsLine counts={item.manifest.counts} />
                        {item.manifest.blobs.length > 0 ? <span>, {item.manifest.blobs.length} files ({bytes(totalBlobBytes(item.manifest.blobs))})</span> : null}
                      </td>
                      <td>{bytes(totalBytes(item.manifest))}</td>
                      <td>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const f = await folder.current();
                              if (!f.dir) throw new Error('The backup folder is not available.');
                              const view = await needPass((p) => readableFolder(f.dir as BackupDir, accountId, accountId, p));
                              const backup = new SubDir(view, item.path ?? item.name);
                              await open(backup, `the backup folder (${item.name})`, accountBlobSource(view, accountId, backup));
                            })
                          }
                        >
                          Restore…
                        </Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{item.name}</td>
                      <td colSpan={5} class="hint">
                        {item.error}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {history.total > history.items.length && (
            <p class="hint">
              Showing the newest {history.items.length} of {history.total} backups. All of them stay in the folder.
            </p>
          )}
        </>
      )}

      {spaces.length > 0 && <HistorySection params={params} />}
    </Page>
  );
}
