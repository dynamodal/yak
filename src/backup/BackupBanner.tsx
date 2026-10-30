import { useEffect, useState } from 'preact/hooks';
import { useNow } from '../app/hooks';
import { navigate } from '../app/router';
import { Button } from '../app/ui';
import { reportHealth } from '../core/health';
import { testMode } from '../core/test-build';
import { remindTomorrow, remindUntil, useBackup, useBackupHealth } from './runtime';

/**
 * Shown on every screen while backups are stale, failing, never made, or folder access was lost.
 * A device with data and no backup yet always shows "No backup yet · Set up" until the first backup succeeds (F-20). "Remind me tomorrow" hides the other warnings for a day on this device; the status dot in the header keeps
 * reporting the problem (this component reports it, so the shell needs no backup code).
 */
export function BackupBanner() {
  const { state, folder, service } = useBackup();
  const now = useNow(60_000);
  const [until, setUntil] = useState(remindUntil);
  const health = useBackupHealth();
  const text = health.ok ? undefined : health.text;
  useEffect(() => {
    reportHealth('backup', text ? [{ level: 'warn', text }] : []);
  }, [text]);
  if (health.ok && !state.notice) return null;
  if (health.ok) {
    return (
      <div class="backup-banner info" role="status">
        <span>{state.notice}</span>
        <Button onClick={() => service.setNotice(undefined)}>
          Dismiss
        </Button>
      </div>
    );
  }
  // No backup yet is not snoozed: the bar stays until the first backup succeeds, because a cleared browser would take everything.
  // In a test build the bar stays away unless the URL has `backupbar`, so it never shifts the pages a suite measures (as the alpha notice does).
  if (health.kind === 'never')
    return testMode() && !new URLSearchParams(location.search).has('backupbar') ? null : (
      <div class="backup-banner warn" role="alert" data-backup-never>
        <span>No backup yet · clearing this site's data in the browser deletes everything here.</span>
        <Button variant="primary" onClick={() => navigate('settings', 'backups')}>
          Set up
        </Button>
      </div>
    );
  if (now < until) return null;
  return (
    <div class="backup-banner warn" role="alert">
      <span>{health.text}</span>
      {health.kind === 'permission' ? (
        <Button
          onClick={() =>
            void folder.requestAccess().then(async () => {
              await service.refreshFolder();
              await service.run('permission-granted');
            })
          }
        >
          Allow access
        </Button>
      ) : null}
      <Button onClick={() => navigate('settings', 'backups')}>
        Open backups
      </Button>
      <Button variant="quiet" onClick={() => setUntil(remindTomorrow())}>
        Remind me tomorrow
      </Button>
    </div>
  );
}
