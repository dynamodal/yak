import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { formatDate, readPeriodic, writePeriodic, type PeriodKind } from '../core/templates';
import type * as Y from 'yjs';

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'daily', label: 'Daily' },
  { kind: 'weekly', label: 'Weekly' },
  { kind: 'monthly', label: 'Monthly' },
];

/** Where each periodic note goes, what it is called, and the template note it starts from: one table. */
export function PeriodicNotesTable() {
  const { account } = useApp();
  useYVersion(account.getMap('settings') as Y.AbstractType<unknown>);
  return (
    <div class="card st-group">
      <table class="st-table st-periodic">
        <thead>
          <tr>
            <th scope="col">Note</th>
            <th scope="col">Folder</th>
            <th scope="col">Name</th>
            <th scope="col">Template note</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map(({ kind, label }) => {
            const p = readPeriodic(account, kind);
            return (
              <tr key={kind}>
                <th scope="row">{label}</th>
                <td data-label="Folder">
                  <input type="text" aria-label={`${label} notes folder`} defaultValue={p.folder} key={`${kind}f${p.folder}`} onChange={(e) => writePeriodic(account, kind, 'folder', (e.target as HTMLInputElement).value)} />
                </td>
                <td data-label="Name">
                  <input type="text" aria-label={`${label} note name`} defaultValue={p.format} key={`${kind}n${p.format}`} onChange={(e) => writePeriodic(account, kind, 'format', (e.target as HTMLInputElement).value)} />
                  <span class="hint">Now: {formatDate(new Date(), p.format)}</span>
                </td>
                <td data-label="Template note">
                  <input type="text" aria-label={`${label} template note`} defaultValue={p.template} key={`${kind}t${p.template}`} onChange={(e) => writePeriodic(account, kind, 'template', (e.target as HTMLInputElement).value)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="hint">“Today's note” (the “+” menu in Notes, or the command) makes the note from its template when it does not exist yet.</p>
      <details class="st-open">
        <summary>Name tokens and templates (advanced)</summary>
        <p class="hint">
          Name tokens: YYYY YY MM DD ddd dddd GGGG (week year) WW (ISO week); put other text in [brackets]. Weeks follow ISO 8601: they start on Monday, and week 1 holds the year's first Thursday. A template is a note in the same space; use {'{{date}}'}, {'{{time}}'}, {'{{title}}'} or {'{{date:DD/MM}}'}. Without one, a new note is empty.
        </p>
      </details>
    </div>
  );
}
