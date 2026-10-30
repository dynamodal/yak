import { useHiddenModules } from '../app/features';
import { DataLine } from '../app/ui';

/** A line in Passphrase and import on Settings: bring in a Toggl or CSV export (hidden while this device hides Import). */
export function ImportLine() {
  const hidden = useHiddenModules();
  if (hidden.includes('import')) return null;
  return (
    <DataLine id="import" tone="off" label="Import" text="Toggl or CSV">
      <a href="#/settings/import">Import…</a>
    </DataLine>
  );
}
