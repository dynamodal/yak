import { useNow } from '../app/hooks';
import { DataLine } from '../app/ui';
import { hasData, useBackup } from './runtime';
import { backupHealth } from './service';

/** The backup status line in Backup and safety on Settings: how old the last backup is, linking to Backup & restore. */
export function BackupLine() {
  const { state, store } = useBackup();
  const now = useNow(60_000);
  const health = backupHealth(state, now, hasData(store.opened()));
  const text = health.kind === 'ok' ? health.text.replace(/^Backed up /, '').replace(/\.$/, '') : health.kind === 'stale' ? health.text.replace(/^The last backup was /, '').replace(/\.$/, '') : health.kind === 'never' ? 'none yet' : health.kind === 'empty' ? 'nothing to back up yet' : 'needs attention';
  const tone = health.ok ? (health.kind === 'ok' ? 'ok' : 'off') : health.kind === 'never' ? 'off' : 'warn';
  return (
    <DataLine id="backup" tone={tone} label="Backup" text={text}>
      <a href="#/settings/backup">{health.kind === 'never' ? 'Set up' : 'Open'}</a>
    </DataLine>
  );
}
