import { DataLine } from '../app/ui';
import { useBackupHealth } from './runtime';

/** The backup status line in Backup and safety on Settings: how old the last backup is, linking to Backup & restore. */
export function BackupLine() {
  const health = useBackupHealth();
  const text = health.covered ? health.text.slice(0, -1) : health.kind === 'ok' ? health.text.replace(/^Backed up /, '').slice(0, -1) : health.kind === 'stale' ? (/^The last backup was ([^.]*)/.exec(health.text)?.[1] ?? 'needs attention') : health.kind === 'never' ? 'none yet' : health.kind === 'empty' ? 'nothing to back up yet' : 'needs attention';
  const tone = health.ok ? (health.kind === 'ok' ? 'ok' : 'off') : health.kind === 'never' ? 'off' : 'warn';
  return (
    <DataLine id="backup" tone={tone} label="Backup" text={text}>
      <a href="#/settings/backup">{health.kind === 'never' ? 'Set up' : 'Open'}</a>
    </DataLine>
  );
}
