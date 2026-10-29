import { useNow } from '../app/hooks';
import type { NeedItem } from '../app/needs';
import { testMode } from '../core/test-build';
import { hasData, useBackup } from './runtime';
import { backupHealth } from './service';

/** "No backup yet" in Settings › Needs you (F-33): a device with data and no backup. The bar above the pages (`BackupBanner`) says the same until the first backup succeeds. */
export function useBackupNeed(): NeedItem | undefined {
  const { state, store } = useBackup();
  const now = useNow(60_000);
  const health = backupHealth(state, now, hasData(store.opened()));
  // In a test build the bar stays away unless the URL has `backupbar` (see BackupBanner); so does this, so it never shifts the pages a suite measures.
  if (testMode() && !new URLSearchParams(location.search).has('backupbar')) return undefined;
  return health.kind === 'never'
    ? { id: 'backup-never', text: 'No backup yet · clearing this site\'s data in the browser deletes everything here', href: '#/settings/backup', action: 'Set up', tone: 'warn' }
    : undefined;
}
