import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, navModel, legacyRoute, type NavGroupDef } from './nav';
import type { ViewDef } from './registry';

// The Time page keeps the view id `timer` and has the path `time`.
const v = (id: string, order: number, group?: string, hidden?: boolean, joins?: string): ViewDef => ({ id, title: id, path: id === 'timer' ? 'time' : id, order, group, hidden, joins, component: () => null });
const all = [
  v('timer', 10),
  v('entries', 20, undefined, true),
  v('reports', 30, undefined, false, 'timer'),
  v('notes', 50),
  v('tasks', 60),
  v('backup', 80, 'settings'),
  v('mirror', 85, undefined, true),
  v('devices', 90, 'settings'),
  v('organize', 92, undefined, true),
  v('settings', 95, 'settings'),
  v('space', 96, 'settings', true),
];
const ids = (m: ReturnType<typeof navModel>): string[] => m.places.map((p) => p.id);

// The shell has no menu group today; the support stays for a module that needs one.
const menu: NavGroupDef[] = [...NAV_GROUPS, { id: 'time', title: 'Time', order: 70 }];
const grouped = [v('timer', 10), v('entries', 20, 'time'), v('reports', 30, 'time'), v('notes', 50)];


describe('navModel', () => {
  it('shows four tabs: Time, Notes, Tasks and Settings; Reports joins the Time page (R-335)', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['settings']);
    expect(ids(navModel(all, ['time']))).toEqual(['timer', 'notes', 'tasks', 'settings']);
    expect(navModel(all, ['time', 'reports']).activePlace).toBe('timer');
  });

  it('keeps menu groups working', () => {
    const m = navModel(grouped, ['reports'], menu);
    expect(ids(m)).toEqual(['timer', 'notes', 'time']);
    expect(m.places.find((p) => p.id === 'time')).toMatchObject({ kind: 'group', pages: [{ id: 'entries' }, { id: 'reports' }] });
    expect(m.activePlace).toBe('time');
  });

  it('keeps Organize routable but in no tab', () => {
    const m = navModel(all, ['organize']);
    expect(m.current?.id).toBe('organize');
    expect(m.activePlace).toBeUndefined();
  });

  it('keeps the hidden Entries route routable but in no tab', () => {
    const m = navModel(all, ['entries']);
    expect(m.current?.id).toBe('entries');
    expect(m.activePlace).toBeUndefined();
  });

  it('lists a group\'s pages by order and leaves out hidden ones', () => {
    const manage = navModel(all, ['time']).places.find((p) => p.id === 'settings');
    expect(manage).toEqual({ kind: 'link', id: 'settings', title: 'Settings', href: '#/settings' });
    expect(navModel(all, ['settings']).current?.id).toBe('settings');
  });

  it('opens the section a landing route names, and lights the landing tab', () => {
    const m = navModel(all, ['settings', 'devices']);
    expect(m.current?.id).toBe('devices');
    expect(m.activePlace).toBe('settings');
    expect(navModel(all, ['settings', 'space', 'abc']).current?.id).toBe('space');
    expect(navModel(all, ['settings', 'space', 'abc']).activePlace).toBe('settings');
    expect(navModel(all, ['settings', 'gone']).current?.id).toBe('settings');
  });

  it('marks a top-level page as its own place', () => {
    expect(navModel(all, ['notes', 'abc']).activePlace).toBe('notes');
  });

  it('falls back to the first visible page for an unknown or empty route', () => {
    expect(navModel(all, []).current?.id).toBe('timer');
    expect(navModel(all, ['nope']).activePlace).toBe('timer');
  });

  it('keeps a hidden page routable but in no place', () => {
    const m = navModel(all, ['mirror']);
    expect(m.current?.id).toBe('mirror');
    expect(m.activePlace).toBeUndefined();
  });

  it('shows a menu group with one visible page as that page', () => {
    const m = navModel([v('a', 10, 'time'), v('b', 20, 'time', true)], ['a'], menu);
    expect(m.places.map((p) => [p.id, p.kind])).toEqual([['a', 'page']]);
    expect(m.activePlace).toBe('a');
  });

  it('treats a view with an unknown group as top level', () => {
    expect(ids(navModel([v('a', 10, 'nope')], ['a']))).toEqual(['a']);
  });
});

describe('legacyRoute', () => {
  const views = [v('projects', 1, 'settings'), v('backup', 2, 'settings'), v('settings', 3, 'settings'), v('timer', 4)];
  it('moves the old Manage and page addresses into Settings', () => {
    expect(legacyRoute(['manage', 'projects'], views)).toEqual(['organize']);
    expect(legacyRoute(['manage'], views)).toEqual(['settings']);
    expect(legacyRoute(['manage', 'settings'], views)).toEqual(['settings']);
    expect(legacyRoute(['projects'], views)).toEqual(['organize']);
    expect(legacyRoute(['settings', 'projects'], views)).toEqual(['organize']);
    expect(legacyRoute(['settings', 'notes-settings'], views)).toEqual(['note-settings']);
    expect(legacyRoute(['settings', 'note-settings'], views)).toEqual(['note-settings']);
    expect(legacyRoute(['settings', 'mirror'], views)).toEqual(['note-settings']);
    expect(legacyRoute(['mirror'], views)).toEqual(['note-settings']);
    expect(legacyRoute(['settings', 'shortcuts'], views)).toEqual(['help', 'shortcuts']);
    expect(legacyRoute(['shortcuts'], views)).toEqual(['help', 'shortcuts']);
    expect(legacyRoute(['note-settings'], views)).toBeUndefined();
    expect(legacyRoute(['organize'], views)).toBeUndefined();
    expect(legacyRoute(['manage', 'help', 'devices'], views)).toEqual(['help', 'devices']);
    expect(legacyRoute(['manage', 'devices'], views)).toEqual(['settings', 'devices']);
  });
  it('sends the pages folded into the Settings page, and the old Backups and History routes, to their new place', () => {
    for (const old of ['general', 'spaces', 'sharing', 'security', 'features', 'home']) {
      expect(legacyRoute(['settings', old], views)).toEqual(['settings']);
      expect(legacyRoute(['manage', old], views)).toEqual(['settings']);
      expect(legacyRoute([old], views)).toEqual(['settings']);
    }
    expect(legacyRoute(['backups'], views)).toEqual(['settings', 'backup']);
    expect(legacyRoute(['history', '1700000000000'], views)).toEqual(['settings', 'backup', '1700000000000']);
    expect(legacyRoute(['manage', 'history'], views)).toEqual(['settings', 'backup']);
  });
  it('leaves current routes alone', () => {
    expect(legacyRoute(['settings'], views)).toBeUndefined();
    expect(legacyRoute(['settings', 'devices', 'add'], views)).toBeUndefined();
    expect(legacyRoute(['settings', 'space', 'abc'], views)).toBeUndefined();
    expect(legacyRoute(['time'], views)).toBeUndefined();
  });
});

describe('a view that joins another', () => {
  it('redirects its old address to the parent, keeping the section', () => {
    expect(legacyRoute(['reports'], all)).toEqual(['time', 'reports']);
    expect(legacyRoute(['reports', 'detailed'], all)).toEqual(['time', 'reports', 'detailed']);
    expect(legacyRoute(['reports', 'weekly'], all)).toEqual(['time', 'reports', 'weekly']);
    expect(legacyRoute(['time', 'reports'], all)).toBeUndefined();
  });
});
