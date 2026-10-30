import type { NeedItem } from '../app/needs';
import { testMode } from '../core/test-build';
import { useBackupHealth } from './runtime';

/** "No backup yet" in Settings › Needs you (F-33): a device with data and no backup. The bar above the pages (`BackupBanner`) says the same until the first backup succeeds. */
export function useBackupNeed(): NeedItem | undefined {
  const health = useBackupHealth();
  // In a test build the bar stays away unless the URL has `backupbar` (see BackupBanner); so does this, so it never shifts the pages a suite measures.
  if (testMode() && !new URLSearchParams(location.search).has('backupbar')) return undefined;
  return health.kind === 'never'
    ? { id: 'backup-never', text: 'No backup yet · clearing this site\'s data in the browser deletes everything here', href: '#/settings/backups', action: 'Set up', tone: 'warn' }
    : undefined;
}
