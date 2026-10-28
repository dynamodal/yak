import { useState } from 'preact/hooks';
import { FEATURES, effectiveHidden, featureBlock, setHiddenModules, useHiddenModules, type FeatureId } from '../app/features';
import { useSettings } from '../app/hooks';
import { Field } from '../app/ui';
import { HistoryCard } from './HistoryCard';
import { type HoursFormat, parseHoursFormat, parseWeekStart } from '../core/settings';
import { applyTheme, parseTheme, readTheme, saveTheme, type Theme } from './theme';

/** What this device shows (F-309): per device; hiding keeps all data and syncing. One folded row so Preferences stays short on a phone. */
function TabsShown() {
  const stored = useHiddenModules();
  const hidden = effectiveHidden(stored);
  const toggle = (id: FeatureId, on: boolean): void => setHiddenModules(on ? stored.filter((x) => x !== id) : [...stored, id]);
  const shown = FEATURES.filter((f) => !hidden.has(f.id)).map((f) => f.title).join(', ') || 'none';
  return (
    <details class="st-fold st-tabs-shown">
      <summary>
        <span class="st-fold-text" title={shown}>
          <strong>Tabs shown:</strong> {shown}
        </span>
      </summary>
      <p class="hint">
        Per device. Hiding a feature only hides its pages and controls: your time entries, notes, tasks and other data are kept, keep syncing, and are still in backups. Hiding Time also hides the timer in the header, its shortcut and Reports, and the app opens on the first tab still shown. Settings, Backup &amp; restore and the sync status are always shown.
      </p>
      <ul class="features-list">
        {FEATURES.map((f) => {
          const off = hidden.has(f.id);
          const byNotes = f.id === 'tasks' && stored.includes('notes');
          const byTime = f.id === 'reports' && stored.includes('time');
          // A running timer must be stopped before Time is hidden, so it is never left running out of sight.
          const block = !off ? featureBlock(f.id) : undefined;
          return (
            <li key={f.id} data-feature={f.id}>
              <label class="row">
                <input type="checkbox" aria-label={f.title} checked={!off} disabled={byNotes || byTime || !!block} onChange={(e) => toggle(f.id, (e.target as HTMLInputElement).checked)} />
                <strong>{f.title}</strong>
              </label>
              <span class="hint">{byNotes ? 'Hidden because Notes is hidden.' : byTime ? 'Hidden because Time is hidden.' : (block ?? f.hint)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The Preferences card on Settings: week start, hours format, theme, tabs shown, history warnings and the Organize link. */
export function PreferencesCard() {
  const { settings, set } = useSettings();
  const [theme, setTheme] = useState<Theme>(readTheme());
  return (
    <section class="card st-card st-group" aria-labelledby="st-prefs-h">
      <h2 id="st-prefs-h">Preferences</h2>
      <a class="st-fold-link" href="#/organize" title="Projects, clients, tags and task values">
        <span>
          <strong>Organize:</strong> projects, clients, tags
        </span>
      </a>
      <Field layout="split" class="st-field" label="Week starts on">
        <select value={settings.week_start} onChange={(e) => set('week_start', parseWeekStart((e.target as HTMLSelectElement).value))}>
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </select>
      </Field>
      <Field layout="split" class="st-field" label="Hours shown as">
        <select value={settings.hours_format} onChange={(e) => set('hours_format', parseHoursFormat((e.target as HTMLSelectElement).value) as HoursFormat)}>
          <option value="decimal">Decimal (1.25 h)</option>
          <option value="hm">Hours and minutes (1:15)</option>
        </select>
      </Field>
      <Field layout="split" class="st-field" label="Theme">
        <select
          value={theme}
          onChange={(e) => {
            const next = parseTheme((e.target as HTMLSelectElement).value);
            setTheme(next);
            saveTheme(next);
            applyTheme(next);
          }}
        >
          <option value="system">Follow the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <p class="hint">Week and hours sync with your other devices; the theme is for this device only.</p>
      <TabsShown />
      <details class="advanced">
        <summary>History warnings (advanced)</summary>
        <p class="hint">A warning appears when a lot of entries are deleted or changed at once, so a mistake or a bad sync can be undone from Backup &amp; restore while it is fresh. Shared across your devices.</p>
        <HistoryCard />
      </details>
    </section>
  );
}
