import { useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { useSyncStatus, useNow } from '../app/hooks';
import { eraseEverything } from '../app/erase-device';
import { safeStorage } from '../app/join';
import { Button } from '../app/ui';
import { backupHealth } from '../backup/service';
import { hasData, saveBlobFile, useBackup } from '../backup/runtime';

/** What the app holds on this device and what an erase removes: the confirmation lists exactly this. */
const ERASE_LIST: readonly string[] = [
  'every space, note, time entry and setting, and the account on this device',
  'the history log and restore points',
  'files attached to notes',
  'the backup folder choice (the folder and its files are not touched) and the backup history',
  'the sync code, device keys and the passphrase check',
  'settings: theme, hidden tabs, views and notices',
  'the offline copy of the app (cache) and its service worker',
];

/** What stays: copies on other devices, backups and anything outside the browser. */
const ERASE_KEEPS: readonly string[] = ['other devices and their copies', 'backup files you saved, in your backup folder or downloads', 'a Mirror folder and its files'];

/** The safety backup before an erase: a zip with the files, and whether this device has data no backup holds. */
function useSafetyZip(): { saveZip: () => Promise<string>; unbackedUp: boolean; health: string } {
  const { service, state, store } = useBackup();
  const now = useNow(60_000);
  const health = backupHealth(state, now, hasData(store.opened()));
  return {
    saveZip: async () => {
      const d = await service.downloadZip();
      saveBlobFile(d.fileName, d.blob);
      return d.fileName;
    },
    unbackedUp: !health.ok && (health.kind === 'never' || health.kind === 'stale' || health.kind === 'failed'),
    health: health.text,
  };
}

/** Advanced: erase every store of Yak on this device, so it looks like a first visit. */
export default function EraseDevicePart() {
  const { store, spaces } = useApp();
  const { onlyHere, unsyncedKnown } = useUnsynced();
  const safety = useSafetyZip();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const [skip, setSkip] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      setFile(await safety.saveZip());
    } catch (e) {
      setError(`Could not make the backup: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details class="danger-zone" aria-label="Erase everything on this device" data-adv="erase">
      <summary>Erase everything on this device</summary>
      <p class="hint">Remove every trace of Yak from this browser, so it starts as on a first visit. Other devices and backup files are not touched.</p>
      {!open && <Button variant="danger" onClick={() => setOpen(true)}>Erase everything…</Button>}
      {open && (
        <div class="confirm-panel">
          <p>This erases, on this device only:</p>
          <ul>
            {ERASE_LIST.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p>This stays:</p>
          <ul>
            {ERASE_KEEPS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p role="status">
            {unsyncedKnown && onlyHere > 0 && <strong>About {onlyHere} change{onlyHere === 1 ? '' : 's'} exist only on this device. </strong>}
            {safety.unbackedUp ? <strong>This device has data that is not backed up. </strong> : null}
            {safety.health} Save the safety backup first: it is a zip with your files, and you can restore it on the Backups page.
          </p>
          <div class="row">
            <Button disabled={busy} onClick={() => void save()}>Save a safety backup (zip, with files)</Button>
            {file && <span class="hint">Saved {file}.</span>}
          </div>
          {error && <p class="error">{error}</p>}
          {!file && (
            <label>
              <input type="checkbox" checked={skip} onChange={(e) => setSkip((e.target as HTMLInputElement).checked)} /> Erase without a safety backup from here (I have another backup)
            </label>
          )}
          <p class="hint">Other open Yak tabs reload. If your browser keeps anything, Yak says what; "Clear site data" in the browser's site settings removes the rest.</p>
          <div class="row">
            <Button
              variant="danger"
              disabled={busy || (!file && !skip)}
              onClick={() =>
                eraseEverything({
                  storage: safeStorage(),
                  docIds: [...store.opened().keys()],
                  unitIds: spaces.map((s) => s.id),
                })
              }
            >
              Erase everything and reload
            </Button>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </details>
  );
}

/** Changes that exist only on this device, when the linked devices have said what they hold. */
function useUnsynced(): { onlyHere: number; unsyncedKnown: boolean } {
  const { sync, store } = useApp();
  const status = useSyncStatus(sync);
  if (!status.peers.some((p) => p.state === 'connected')) return { onlyHere: 0, unsyncedKnown: false };
  const r = sync.onlyHere([...store.opened().keys()]);
  return { onlyHere: r.count, unsyncedKnown: r.unknown.length === 0 || r.count > 0 };
}
