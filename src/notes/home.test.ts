import { describe, expect, it } from 'vitest';
import { changedLabel, dueLabel, dueSoon, recentNotes } from './home';
import { toTask } from './tasks';

const NOW = new Date(2026, 9, 28, 10, 0); // Wed 28 Oct 2026, local
const task = (id: string, props: Record<string, string | string[]>) => toTask({ id, path: `Tasks/${id}.md`, properties: { tags: ['task'], ...props }, body: '' });

describe('dueSoon', () => {
  const tasks = [
    task('late', { due: '2026-10-25' }),
    task('today', { due: '2026-10-28' }),
    task('week', { due: '2026-11-04' }),
    task('far', { due: '2026-11-05' }),
    task('none', {}),
    task('done', { due: '2026-10-27', status: 'done' }),
    task('arch', { due: '2026-10-27', tags: ['task', 'archived'] }),
  ];
  it('lists late and next-seven-day open tasks, soonest first', () => {
    expect(dueSoon(tasks, NOW).map((t) => t.id)).toEqual(['late', 'today', 'week']);
  });
  it('keeps a task just checked off in place', () => {
    expect(dueSoon(tasks, NOW, new Set(['done'])).map((t) => t.id)).toEqual(['late', 'done', 'today', 'week']);
  });
});

describe('dueLabel', () => {
  it('marks late days and names today and tomorrow', () => {
    expect(dueLabel('2026-10-25', NOW)).toEqual({ text: 'Late · Sun 25 Oct', late: true });
    expect(dueLabel('2026-10-28', NOW)).toEqual({ text: 'Today', late: false });
    expect(dueLabel('2026-10-29T09:00', NOW)).toEqual({ text: 'Tomorrow', late: false });
    expect(dueLabel('2026-10-31', NOW)).toEqual({ text: 'Sat 31 Oct', late: false });
  });
});

describe('recentNotes', () => {
  const note = (id: string, updated_at: string, tags: string[] = []) => ({ id, updated_at, parsed: { properties: { tags }, body: '' } as never });
  it('skips tasks and orders newest first', () => {
    const out = recentNotes([note('a', '2026-10-01T00:00:00Z'), note('t', '2026-10-27T00:00:00Z', ['task']), note('b', '2026-10-20T00:00:00Z')], 5);
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
  });
  it('limits the list', () => {
    expect(recentNotes([note('a', '2026-10-01T00:00:00Z'), note('b', '2026-10-02T00:00:00Z')], 1).map((n) => n.id)).toEqual(['b']);
  });
});

describe('changedLabel', () => {
  it('says today, yesterday, else the date', () => {
    expect(changedLabel(new Date(2026, 9, 28, 8).toISOString(), NOW)).toBe('Today');
    expect(changedLabel(new Date(2026, 9, 27, 8).toISOString(), NOW)).toBe('Yesterday');
    expect(changedLabel(new Date(2026, 9, 3, 8).toISOString(), NOW)).toBe('3 Oct');
    expect(changedLabel('', NOW)).toBe('');
  });
});
