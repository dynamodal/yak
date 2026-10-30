import { describe, expect, it } from 'vitest';
import { SETTINGS_ENTRIES, settingsCommands, settingsHref, visibleSettingsEntries } from './settings-index';
import { SETTINGS_SECTIONS } from './nav';
import type { FeatureId } from './features';

const words = (c: { title: string; keywords?: readonly string[] }): string => [c.title, ...(c.keywords ?? [])].join(' ').toLowerCase();
const find = (query: string, hidden: FeatureId[] = []): string[] =>
  settingsCommands((f) => hidden.includes(f))
    .filter((c) => query.split(/\s+/).every((w) => words(c).includes(w)))
    .map((c) => c.id);

describe('Settings in the palette (F-55)', () => {
  it('lists every section of the page except Needs you', () => {
    const ids = new Set(SETTINGS_ENTRIES.filter((e) => !e.row && !e.href).map((e) => e.section));
    for (const s of SETTINGS_SECTIONS) if (s !== 'needs-you') expect(ids.has(s)).toBe(true);
  });
  it('opens a section or a row of it', () => {
    const href = (id: string): string => settingsHref(SETTINGS_ENTRIES.find((e) => e.id === id)!);
    expect(href('notes')).toBe('#/settings/notes');
    expect(href('notes-mirror')).toBe('#/settings/notes/mirror');
    expect(href('backups')).toBe('#/settings/backups');
    expect(href('passphrase-manage')).toBe('#/settings/passphrase/manage');
    expect(href('add-device')).toBe('#/settings/devices/add');
  });
  it('finds Mirror by mirror, folder and obsidian', () => {
    for (const q of ['mirror', 'folder obsidian', 'obsidian']) expect(find(q)).toContain('settings.notes-mirror');
  });
  it('finds the other places by what people call them', () => {
    expect(find('passphrase')).toContain('settings.passphrase');
    expect(find('backup')).toContain('settings.backups');
    expect(find('sync')).toContain('settings.devices-sync');
    expect(find('theme')).toContain('settings.theme');
    expect(find('dark')).toContain('settings.display');
  });
  it('titles read as a Settings group', () => {
    expect(settingsCommands().every((c) => c.title.startsWith('Settings › '))).toBe(true);
    expect(settingsCommands().find((c) => c.id === 'settings.notes-mirror')?.title).toBe('Settings › Notes › Mirror to a folder');
  });
  it('leaves out Notes entries while Notes is off and Mirror while Mirror is off', () => {
    expect(find('mirror', ['notes'])).toEqual(['settings.features']);
    const noMirror = visibleSettingsEntries((f) => f === 'mirror').map((e) => e.id);
    expect(noMirror).toContain('notes-links');
    expect(noMirror).not.toContain('notes-mirror');
    expect(visibleSettingsEntries((f) => f === 'import').map((e) => e.id)).not.toContain('import');
  });
});
