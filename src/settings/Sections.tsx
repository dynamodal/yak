import { useEffect, useRef, useState } from 'preact/hooks';
import { FEATURES, effectiveHidden, featureBlock, setHiddenModules, useHiddenModules, type FeatureId } from '../app/features';
import { useSettings } from '../app/hooks';
import { settingsParts } from '../app/settings-parts';
import { useNeeds } from '../app/needs';
import { Field, OpenDetails } from '../app/ui';
import { lazyView } from '../app/lazy';
import { Sections } from '../app/views/Sections';
import { FilesCard } from './FilesCard';
import { LinksCard } from './LinksCard';
import { PeriodicNotesTable } from './DailyCard';
import { APP_NAME } from '../constants';
import { type HoursFormat, parseHoursFormat, parseWeekStart } from '../core/settings';
import { DataLines } from './DataLines';
import { applyTheme, parseTheme, readTheme, saveTheme, type Theme } from './theme';

// Loaded when the section is shown: the list of unused files is not needed to start the app.
const UnusedFiles = lazyView(() => import('./UnusedFiles').then((m) => ({ default: m.UnusedFiles })));

declare const __APP_VERSION__: string | undefined;

export { NeedsSection } from './NeedsList';
export { useNeeds };

/**
 * Passphrase and import: the Passphrase and Import lines, always shown. The passphrase is its own line, not part of Backups, because it also approves
 * devices and shares (F-309, F-324); Manage opens what it protects and its state on this device (a part the backup module adds).
 */
export function PassphraseSection(props: { open: boolean }) {
  const parts = settingsParts('passphrase');
  return (
    <>
      <DataLines />
      <OpenDetails class="st-manage" summary="Manage passphrase" open={props.open}>
        {parts.map((p) => (
          <p.component key={p.id} />
        ))}
      </OpenDetails>
    </>
  );
}

/** Backups and Version history: parts the modules that own them add (`registerSettingsPart`), so this page names no feature module. */
export function PartsSection(props: { section: 'backups' | 'version-history' }) {
  return (
    <>
      {settingsParts(props.section).map((p) => (
        <p.component key={p.id} />
      ))}
    </>
  );
}

/** Recently deleted: what can be brought back today, where, and for how long. The lists themselves stay where the items live; the model is in the user guide. */
export function RecentlyDeletedSection() {
  return (
    <ul class="st-links" data-recently-deleted>
      <li>
        <strong>Time entries:</strong> restorable for 45 days from <a href="#/time/list">Time › Recently deleted</a>, or with Undo right after deleting.
      </li>
      <li>
        <strong>Notes and tasks:</strong> restorable for 45 days from <a href="#/notes">Notes › Recently deleted</a>.
      </li>
      <li>
        <strong>Projects, clients, tags and files in notes:</strong> not listed yet; a delete is final for now. <a href="#/help/backups">How the three layers fit together</a>
      </li>
    </ul>
  );
}

/**
 * Notes (F-55): links, files and unused files, daily, weekly and monthly notes, and the sections other modules add (Mirror).
 * They were a page of their own behind the gear on Notes; each part has an id (`section-<row>`) that `#/settings/notes/<row>` scrolls to.
 */
export function NotesSection() {
  return (
    <>
      <section id="section-links" aria-labelledby="section-links-h">
        <h3 id="section-links-h">Links</h3>
        <LinksCard />
      </section>
      <section id="section-files" aria-labelledby="section-files-h">
        <h3 id="section-files-h">Files</h3>
        <FilesCard />
        <h4>Unused files</h4>
        <p class="hint">Files that no note refers to. Yak never deletes a file by itself: removing a link from a note keeps the file, and you delete it here.</p>
        <UnusedFiles params={[]} />
      </section>
      <section id="section-periodic" aria-labelledby="section-periodic-h">
        <h3 id="section-periodic-h">Daily, weekly and monthly notes</h3>
        <PeriodicNotesTable />
      </section>
      <Sections page="note-settings" level={3} />
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
          <option value="decimal">Decimal, 2 places (1.25 h)</option>
          <option value="decimal1">Decimal, 1 place (1.3 h)</option>
          <option value="decimal0">Decimal, whole hours (1 h)</option>
          <option value="hm">Hours and minutes (1:15)</option>
        </select>
      </Field>
      {settings.hours_format !== 'hm' && <p class="hint">Only the display is rounded, so totals may not add up exactly.</p>}
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
      <p class="hint">The app opens on the first tab still shown. Settings and the sync status are always shown.</p>
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
