import { describe, expect, it } from 'vitest';
import { commandHidden, effectiveHidden, featureBlock, hiddenRoute, landingRoute, readHiddenModules, searchKindHidden, setFeatureBlock, viewHidden } from './features';

const store = (v: string | null) => ({ getItem: () => v });
const views = [
  { id: 'timer', path: 'time', order: 10 },
  { id: 'entries', path: 'entries', order: 20, hidden: true },
  { id: 'notes', path: 'notes', order: 50 },
  { id: 'tasks', path: 'tasks', order: 60 },
  { id: 'reports', path: 'reports', order: 30, joins: 'timer' },
  { id: 'import', path: 'import', order: 85, group: 'settings' },
  { id: 'settings', path: 'settings', order: 95, group: 'settings' },
  { id: 'backup', path: 'backup', order: 80, group: 'settings' },
];

describe('hidden modules', () => {
  it('everything is on when the list is absent, empty or unreadable', () => {
    expect(readHiddenModules(store(null))).toEqual([]);
    expect(readHiddenModules(store('not json'))).toEqual([]);
    expect(readHiddenModules(store('{"a":1}'))).toEqual([]);
    expect(readHiddenModules(undefined)).toEqual([]);
  });
  it('keeps only known ids', () => {
    expect(readHiddenModules(store('["mirror","bogus",3]'))).toEqual(['mirror']);
  });
  it('Notes and Tasks are independent switches (F-33n)', () => {
    expect([...effectiveHidden(['notes'])]).toEqual(['notes']);
    expect([...effectiveHidden(['tasks'])]).toEqual(['tasks']);
    expect([...effectiveHidden(['notes', 'tasks'])].sort()).toEqual(['notes', 'tasks']);
  });
  it('an old list with `notes` but not `tasks` (which used to hide both) now shows Tasks', () => {
    const old = effectiveHidden(readHiddenModules(store('["notes"]')));
    expect(['notes', 'notes-settings', 'tasks'].map((id) => viewHidden(id, old))).toEqual([true, true, false]);
    expect(searchKindHidden('task', old)).toBe(false);
  });
  it('Reports has no switch of its own: an old stored `reports` entry is dropped and hides nothing', () => {
    expect(readHiddenModules(store('["reports"]'))).toEqual([]);
    expect(readHiddenModules(store('["reports","time"]'))).toEqual(['time']);
    const old = effectiveHidden(readHiddenModules(store('["reports"]')));
    expect(['timer', 'reports'].map((id) => viewHidden(id, old))).toEqual([false, false]);
    expect(hiddenRoute(['time', 'reports'], views, old)).toBe(false);
    expect(commandHidden('go.reports', old)).toBe(false);
  });
  it('knows the time id', () => {
    expect(readHiddenModules(store('["time","notes"]'))).toEqual(['time', 'notes']);
  });
});

describe('registry filter', () => {
  const hidden = effectiveHidden(['notes', 'time']);
  it('hides the views of hidden features, never Settings or backups', () => {
    expect(['notes', 'tasks', 'reports', 'notes-settings', 'timer'].map((id) => viewHidden(id, hidden))).toEqual([true, false, true, true, true]);
    expect(['backup', 'devices', 'mirror', 'import', 'settings'].map((id) => viewHidden(id, hidden))).toEqual([false, false, false, false, false]);
  });
  it('Time off hides the Time page, its old Entries route, Reports and the timer commands', () => {
    const noTime = effectiveHidden(['time']);
    expect(['timer', 'entries', 'reports'].map((id) => viewHidden(id, noTime))).toEqual([true, true, true]);
    expect(['notes', 'tasks', 'settings'].map((id) => viewHidden(id, noTime))).toEqual([false, false, false]);
    expect(commandHidden('timer.toggle', noTime)).toBe(true);
    expect(commandHidden('go.timer', noTime)).toBe(true);
    expect(commandHidden('go.entries', noTime)).toBe(true);
    expect(commandHidden('go.reports', noTime)).toBe(true);
    expect(commandHidden('notes.find', noTime)).toBe(false);
    expect(hiddenRoute(['time'], views, noTime)).toBe(true);
    expect(hiddenRoute(['time', 'week'], views, noTime)).toBe(true);
    expect(hiddenRoute(['time', 'reports'], views, noTime)).toBe(true);
    expect(hiddenRoute(['notes'], views, noTime)).toBe(false);
  });
  it('hides commands: notes commands and "Go to" of hidden views', () => {
    expect(commandHidden('notes.find', hidden)).toBe(true);
    expect(['notes.today', 'notes.insert-date', 'go.notes'].map((id) => commandHidden(id, hidden))).toEqual([true, true, true]);
    expect(commandHidden('go.tasks', hidden)).toBe(false);
    expect(commandHidden('go.tasks', effectiveHidden(['tasks']))).toBe(true);
    expect(commandHidden('notes.find', effectiveHidden(['tasks']))).toBe(false);
    expect(commandHidden('go.reports', hidden)).toBe(true);
    expect(commandHidden('go.timer', hidden)).toBe(true);
    expect(commandHidden('timer.toggle', hidden)).toBe(true);
  });
  it('filters search results by kind', () => {
    expect(searchKindHidden('note', hidden)).toBe(true);
    expect(searchKindHidden('task', hidden)).toBe(false);
    expect(searchKindHidden('task', effectiveHidden(['notes', 'tasks']))).toBe(true);
    expect(searchKindHidden('entry', hidden)).toBe(false);
    expect(searchKindHidden('task', effectiveHidden(['tasks']))).toBe(true);
    expect(searchKindHidden('note', effectiveHidden(['tasks']))).toBe(false);
  });
  it('knows a hidden page by its route, in Settings too', () => {
    expect(hiddenRoute(['notes', 'abc'], views, hidden)).toBe(true);
    expect(hiddenRoute(['time'], views, hidden)).toBe(true);
    expect(hiddenRoute(['time'], views, effectiveHidden(['notes']))).toBe(false);
    expect(hiddenRoute(['settings', 'import'], views, effectiveHidden(['import']))).toBe(true);
    expect(hiddenRoute(['settings', 'backup'], views, effectiveHidden(['import']))).toBe(false);
    expect(hiddenRoute(['settings', 'nothing'], views, hidden)).toBe(false);
  });
  it('knows a hidden view that joins the Time page: Reports follows Time', () => {
    const noTime = effectiveHidden(['time']);
    expect(hiddenRoute(['time', 'reports'], views, noTime)).toBe(true);
    expect(hiddenRoute(['time', 'reports', 'detailed'], views, noTime)).toBe(true);
    expect(hiddenRoute(['reports'], views, noTime)).toBe(true);
    expect(hiddenRoute(['time', 'reports'], views, effectiveHidden([]))).toBe(false);
    expect(hiddenRoute(['time', 'week'], views, effectiveHidden([]))).toBe(false);
  });
});

describe('landing route', () => {
  it('is the first tab this device shows', () => {
    expect(landingRoute(effectiveHidden([]), views)).toBe('#/time');
    expect(landingRoute(effectiveHidden(['time']), views)).toBe('#/notes');
    expect(landingRoute(effectiveHidden(['time', 'notes']), views)).toBe('#/tasks');
    expect(landingRoute(effectiveHidden(['time', 'tasks']), views)).toBe('#/notes');
    expect(landingRoute(effectiveHidden(['time', 'notes', 'tasks']), views)).toBe('#/settings');
    expect(landingRoute(effectiveHidden(['notes']), views)).toBe('#/time');
  });
  it('is Settings when every other feature is off, and skips hidden, joined and grouped views', () => {
    expect(landingRoute(effectiveHidden(['time', 'notes', 'tasks']), views)).toBe('#/settings');
    expect(landingRoute(new Set(), [])).toBe('#/settings');
    expect(landingRoute(effectiveHidden(['time']), views.filter((v) => v.id !== 'notes' && v.id !== 'tasks'))).toBe('#/settings');
  });
});

describe('feature blocks', () => {
  it('a feature can say why it cannot be hidden now', () => {
    expect(featureBlock('time')).toBeUndefined();
    setFeatureBlock('time', 'A timer is running.');
    expect(featureBlock('time')).toBe('A timer is running.');
    setFeatureBlock('time', null);
    expect(featureBlock('time')).toBeUndefined();
  });
});
