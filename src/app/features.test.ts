import { describe, expect, it } from 'vitest';
import { commandHidden, effectiveHidden, hiddenRoute, readHiddenModules, searchKindHidden, viewHidden } from './features';

const store = (v: string | null) => ({ getItem: () => v });
const views = [
  { id: 'timer', path: 'time' },
  { id: 'notes', path: 'notes' },
  { id: 'tasks', path: 'tasks' },
  { id: 'reports', path: 'reports', joins: 'timer' },
  { id: 'import', path: 'import', group: 'settings' },
  { id: 'backup', path: 'backup', group: 'settings' },
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
  it('hiding Notes also hides Tasks', () => {
    expect([...effectiveHidden(['notes'])].sort()).toEqual(['notes', 'tasks']);
    expect([...effectiveHidden(['tasks'])]).toEqual(['tasks']);
  });
});

describe('registry filter', () => {
  const hidden = effectiveHidden(['notes', 'reports']);
  it('hides the views of hidden features, never the timer or backups', () => {
    expect(['notes', 'tasks', 'reports', 'notes-settings'].map((id) => viewHidden(id, hidden))).toEqual([true, true, true, true]);
    expect(['timer', 'backup', 'devices', 'mirror', 'import'].map((id) => viewHidden(id, hidden))).toEqual([false, false, false, false, false]);
  });
  it('hides commands: notes commands and "Go to" of hidden views', () => {
    expect(commandHidden('notes.find', hidden)).toBe(true);
    expect(commandHidden('go.tasks', hidden)).toBe(true);
    expect(commandHidden('go.reports', hidden)).toBe(true);
    expect(commandHidden('go.timer', hidden)).toBe(false);
    expect(commandHidden('timer.toggle', hidden)).toBe(false);
  });
  it('filters search results by kind', () => {
    expect(searchKindHidden('note', hidden)).toBe(true);
    expect(searchKindHidden('task', hidden)).toBe(true);
    expect(searchKindHidden('entry', hidden)).toBe(false);
    expect(searchKindHidden('task', effectiveHidden(['tasks']))).toBe(true);
    expect(searchKindHidden('note', effectiveHidden(['tasks']))).toBe(false);
  });
  it('knows a hidden page by its route, in Settings too', () => {
    expect(hiddenRoute(['notes', 'abc'], views, hidden)).toBe(true);
    expect(hiddenRoute(['time'], views, hidden)).toBe(false);
    expect(hiddenRoute(['settings', 'import'], views, effectiveHidden(['import']))).toBe(true);
    expect(hiddenRoute(['settings', 'backup'], views, effectiveHidden(['import']))).toBe(false);
    expect(hiddenRoute(['settings', 'nothing'], views, hidden)).toBe(false);
  });
  it('knows a hidden view that joins the Time page', () => {
    const noReports = effectiveHidden(['reports']);
    expect(hiddenRoute(['time', 'reports'], views, noReports)).toBe(true);
    expect(hiddenRoute(['time', 'reports', 'detailed'], views, noReports)).toBe(true);
    expect(hiddenRoute(['reports'], views, noReports)).toBe(true);
    expect(hiddenRoute(['time', 'reports'], views, effectiveHidden([]))).toBe(false);
    expect(hiddenRoute(['time', 'week'], views, noReports)).toBe(false);
  });
});
