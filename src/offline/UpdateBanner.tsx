import { useEffect, useState } from 'preact/hooks';
import { Button } from '../app/ui';
import { applyUpdate, onUpdateReady } from './client';

/** Shown on every screen once a new version has been downloaded and is waiting. */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [backupFirst, setBackupFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      onUpdateReady((r, b) => {
        setReady(r);
        setBackupFirst(b);
      }),
    [],
  );
  if (!ready) return null;
  return (
    <div class="update-banner" role="status">
      <span>
        A new version is available.
        {backupFirst ? (
          <>
            {' '}
            <strong>Make a backup before reloading.</strong> <a href="#/settings/backups">Open Backups</a>.
          </>
        ) : null}
      </span>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          applyUpdate();
        }}
      >
        Reload
      </Button>
    </div>
  );
}
