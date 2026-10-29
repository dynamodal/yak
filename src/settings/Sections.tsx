import { useEffect, useRef, useState } from 'preact/hooks';
import { FEATURES, effectiveHidden, featureBlock, setHiddenModules, useHiddenModules, type FeatureId } from '../app/features';
import { useSettings } from '../app/hooks';
import { settingsParts } from '../app/settings-parts';
import { useNeeds } from '../app/needs';
import { Field } from '../app/ui';
import { APP_NAME } from '../constants';
import { type HoursFormat, parseHoursFormat, parseWeekStart } from '../core/settings';
import { HistoryCard } from './HistoryCard';
import { DataLines } from './DataLines';
import { applyTheme, parseTheme, readTheme, saveTheme, type Theme } from './theme';

declare const __APP_VERSION__: string | undefined;

export { NeedsSection } from './NeedsList';
export { useNeeds };

/** Backup and safety: the Backup, Passphrase and Import lines, always shown, each ending in the place to change it. */
export function BackupSection() {
  return (
    <>
      <p class="hint">Backups copy everything to a folder you choose. The passphrase protects backups and approves devices and shares.</p>
      <DataLines />
      <p class="hint">
        <a href="#/settings/backup">Backup and restore</a> also holds the history: go back in time to an earlier version.
      </p>
    </>
  );
}

/** Display: week start, hours format and the theme; the hours and week sync, the theme is this device's. */
export function DisplaySection() {
  const { settings, set } = useSettings();
  const [theme, setTheme] = useState<Theme>(readTheme());
  return (
    <div class="st-group">
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
      <details class="st-fold">
        <summary>History warnings</summary>
        <p class="hint">A warning appears when a lot of entries are deleted or changed at once, so a mistake or a bad sync can be undone from Backup &amp; restore while it is fresh. Shared across your devices.</p>
        <HistoryCard />
      </details>
    </div>
  );
}

/** Features: what this device shows (F-309); per device. Hiding keeps all data and syncing. */
export function FeaturesSection() {
  const stored = useHiddenModules();
  const hidden = effectiveHidden(stored);
  const toggle = (id: FeatureId, on: boolean): void => setHiddenModules(on ? stored.filter((x) => x !== id) : [...stored, id]);
  return (
    <div class="st-tabs-shown">
      <p class="hint">Per device. Hiding only hides: your data is kept, keeps syncing and stays in backups.</p>
      <p class="hint">The app opens on the first tab still shown. Settings, Backup &amp; restore and the sync status are always shown.</p>
      <ul class="features-list">
        {FEATURES.map((f) => {
          const off = hidden.has(f.id);
          // A running timer must be stopped before Time is hidden, so it is never left running out of sight.
          const block = !off ? featureBlock(f.id) : undefined;
          return (
            <li key={f.id} data-feature={f.id}>
              <label class="row">
                <input type="checkbox" aria-label={f.title} checked={!off} disabled={!!block} onChange={(e) => toggle(f.id, (e.target as HTMLInputElement).checked)} />
                <strong>{f.title}</strong>
              </label>
              <span class="hint">{block ?? f.hint}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Help: the guide, what is new, shortcuts, reporting a problem, licenses and the version. */
export function HelpSection() {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development';
  return (
    <>
      <ul class="st-links">
        <li>
          <a href="#/help">Guide and About</a>
        </li>
        <li>
          <a href="#/help/whats-new">What's new</a>
        </li>
        <li>
          <a href="#/help/shortcuts">Keyboard shortcuts</a>
        </li>
        <li>
          <a href="#/help/report">Report a problem</a>
        </li>
        <li>
          <a href="#/help/open-source">Open source licenses</a>
        </li>
      </ul>
      <p class="hint" data-about>
        {APP_NAME}, build {version}. Everything is stored on this device; sync is optional.
      </p>
    </>
  );
}

/**
 * Organize (F-33x): projects, clients, tags and task values, one fold that opens in place (and is open when the address names it).
 * The body comes from the time module (`registerSettingsPart`), so this page imports no feature; it renders only while open.
 */
export function OrganizeSection(props: { open: boolean }) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const parts = settingsParts('organize');
  useEffect(() => {
    if (props.open && ref.current) {
      ref.current.open = true;
      setShown(true);
    }
  }, [props.open]);
  return (
    <details class="st-open" ref={ref} onToggle={(e) => setShown((e.target as HTMLDetailsElement).open)}>
      <summary>Projects, clients, tags and task values</summary>
      {shown ? parts.map((p) => <p.component key={p.id} />) : null}
    </details>
  );
}

/**
 * Advanced (F-33b): the internals, kept off the main path and apart from Help. It is one fold that opens in place (and is open when the address
 * names it); the pieces come from the modules that own them (device keys and ids, the connection, reset), so this page names none of them.
 * They render only while open: the connection part asks the relay for numbers.
 */
export function AdvancedSection(props: { open: boolean }) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const parts = settingsParts('advanced');
  useEffect(() => {
    if (props.open && ref.current) {
      ref.current.open = true;
      setShown(true);
    }
  }, [props.open]);
  return (
    <details class="advanced" ref={ref} onToggle={(e) => setShown((e.target as HTMLDetailsElement).open)}>
      <summary>Device keys and ids, connection, logs, reset</summary>
      {shown ? parts.map((p) => <p.component key={p.id} />) : null}
    </details>
  );
}
