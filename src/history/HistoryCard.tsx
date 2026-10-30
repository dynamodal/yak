import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { Field } from '../app/ui';
import { readThresholds, writeThreshold } from '../core/history/settings';

/** How big a sudden batch of deletions or edits must be before a warning appears. */
export function HistoryCard() {
  const { account } = useApp();
  useYVersion(account.getMap('settings') as Y.AbstractType<unknown>);
  const th = readThresholds(account);
  const field = (key: 'deleted' | 'changed', label: string, value: number) => (
    <Field layout="split" class="st-field" label={label}>
      <input
        type="number"
        min={1}
        aria-label={label}
        defaultValue={value}
        key={`${key}${value}`}
        onChange={(e) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(n) && n >= 1) writeThreshold(account, key, n);
        }}
      />
    </Field>
  );
  return (
    <div class="card st-group">
      {field('deleted', 'Warn when this many entries are deleted within a minute', th.deleted)}
      {field('changed', 'Warn when this many older entries change within a minute', th.changed)}
      <p class="hint">Older means started more than {th.oldDays} days ago. Imports and restores never warn.</p>
    </div>
  );
}
