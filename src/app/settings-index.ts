import type { CommandDef } from './commands';
import { isFeatureHidden, type FeatureId } from './features';
import type { SettingsSection } from './nav';

/** The headings of the Settings page's sections; the page and the palette both read them. */
export const SETTINGS_TITLES: Readonly<Record<SettingsSection, string>> = {
  'needs-you': 'Needs you',
  backups: 'Backups',
  'version-history': 'Version history',
  'recently-deleted': 'Recently deleted',
  passphrase: 'Passphrase and import',
  'devices-sync': 'Devices and sync',
  spaces: 'Spaces',
  sharing: 'Sharing',
  organize: 'Organize',
  notes: 'Notes',
  display: 'Display',
  features: 'Features',
  help: 'Help',
  advanced: 'Advanced',
};

/** One place in Settings the palette can open: a section, or a row of one (`#/settings/<section>[/<row>]`) or a page of its own (`href`). */
export interface SettingsEntry {
  id: string;
  title: string;
  /** Opens `#/settings/<section>` (and `/<row>`) unless `href` is set. */
  section: SettingsSection;
  row?: string;
  href?: string;
  keywords: readonly string[];
  /** Left out while this device hides any of these features. */
  features?: readonly FeatureId[];
}

const section = (s: SettingsSection, keywords: string[], features?: FeatureId[]): SettingsEntry => ({
  id: s,
  title: SETTINGS_TITLES[s],
  section: s,
  keywords,
  ...(features ? { features } : {}),
});

/** Sections and rows by title plus the words people search by (F-55). Rows with a `row` scroll to that part of the section. */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  section('backups', ['backup', 'backups', 'restore', 'encrypt', 'folder', 'download', 'merge', 'replace', 'zip']),
  section('version-history', ['history', 'earlier version', 'go back in time', 'undo', 'warn', 'deleted', 'changed']),
  section('recently-deleted', ['trash', 'deleted', 'undelete', 'restore', 'bin', 'delete for good', 'delete files straight away']),
  section('passphrase', ['passphrase', 'password', 'unlock', 'encryption', 'key', 'import', 'toggl', 'csv']),
  { id: 'passphrase-manage', title: 'Passphrase › Manage', section: 'passphrase', row: 'manage', keywords: ['forget', 'unlock', 'account key', 'protect'] },
  { id: 'import', title: 'Import', section: 'passphrase', href: '#/settings/import', keywords: ['toggl', 'csv', 'bring in'], features: ['import'] },
  section('devices-sync', ['devices', 'device', 'sync', 'relay', 'phone', 'pair', 'connect']),
  { id: 'add-device', title: 'Add a device', section: 'devices-sync', href: '#/settings/devices/add', keywords: ['pair', 'join', 'code', 'qr', 'link', 'phone', 'sync'] },
  section('spaces', ['space', 'workspace', 'keep', 'archive']),
  section('sharing', ['share', 'account', 'invite', 'collaborate', 'people']),
  section('organize', ['projects', 'clients', 'tags', 'task values', 'colors']),
  section('notes', ['note settings', 'links', 'files', 'daily', 'folder', 'obsidian', 'mirror'], ['notes']),
  { id: 'notes-links', title: 'Notes › Links', section: 'notes', row: 'links', keywords: ['wiki', 'link', 'backlinks', 'rename'], features: ['notes'] },
  { id: 'notes-files', title: 'Notes › Files', section: 'notes', row: 'files', keywords: ['attachments', 'images', 'unused', 'delete files', 'size'], features: ['notes'] },
  { id: 'notes-periodic', title: 'Notes › Daily, weekly and monthly notes', section: 'notes', row: 'periodic', keywords: ['daily', 'weekly', 'monthly', 'journal', 'template', 'periodic', 'today'], features: ['notes'] },
  { id: 'notes-mirror', title: 'Notes › Mirror to a folder', section: 'notes', row: 'mirror', keywords: ['mirror', 'folder', 'obsidian', 'markdown', 'files', 'vault', 'disk'], features: ['notes', 'mirror'] },
  section('display', ['theme', 'dark', 'light', 'week', 'hours', 'format', 'appearance']),
  { id: 'theme', title: 'Display › Theme', section: 'display', keywords: ['dark', 'light', 'appearance', 'colors'] },
  { id: 'week-start', title: 'Display › Week starts on', section: 'display', keywords: ['monday', 'sunday', 'calendar'] },
  { id: 'hours-format', title: 'Display › Hours shown as', section: 'display', keywords: ['decimal', 'duration', 'time format'] },
  section('features', ['hide', 'show', 'tabs', 'modules', 'turn off', 'mirror', 'tasks', 'import']),
  section('help', ['guide', 'about', 'version', 'licenses', 'report a problem', 'whats new']),
  section('advanced', ['connection', 'relay', 'server', 'logs', 'debug', 'reset', 're-sync', 'erase', 'wipe', 'start over', 'clear data', 'device keys', 'ids']),
];

/** Where an entry opens. */
export function settingsHref(e: SettingsEntry): string {
  return e.href ?? `#/settings/${e.section}${e.row ? `/${e.row}` : ''}`;
}

/** The entries to list while this device hides some features (pure, so it is tested without a window). */
export function visibleSettingsEntries(hidden: (f: FeatureId) => boolean = isFeatureHidden): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((e) => !(e.features ?? []).some(hidden));
}

/** The palette's Settings group: "Settings › Mirror to a folder" and so on, opening the section or row. */
export function settingsCommands(hidden?: (f: FeatureId) => boolean): CommandDef[] {
  return visibleSettingsEntries(hidden).map((e) => ({
    id: `settings.${e.id}`,
    title: `Settings › ${e.title}`,
    keywords: ['settings', ...e.keywords],
    run: () => {
      const href = settingsHref(e);
      if (location.hash === href) window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = href;
    },
  }));
}
