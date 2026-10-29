import { beforeEach, describe, expect, it } from 'vitest';
import { changeToken, changesSeen, hasNewChanges, markChangesSeen, mergeChanges, parseChanges } from './changes';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});

describe('changes', () => {
  it('parses entries newest first', () => {
    const c = parseChanges('# What\'s new\n\n## 2026-10-17: Older\n\n- a\n\n## 2026-10-19: Newer\n\n- b\n- c\n');
    expect(c.map((x) => x.id)).toEqual(['2026-10-19', '2026-10-17']);
    expect(c[0]).toMatchObject({ title: 'Newer', body: '- b\n- c' });
  });
  it('keeps entries of one date in the file order', () => {
    const c = parseChanges('## 2026-10-25: Third\n\n- c\n\n## 2026-10-25: Second\n\n- b\n\n## 2026-10-25: First\n\n- a\n\n## 2026-10-24: Older\n\n- o\n');
    expect(c.map((x) => x.title)).toEqual(['Third', 'Second', 'First', 'Older']);
  });
  it('merges fragments and the archive: newest date first, fragments before the archive, names descending', () => {
    const archive = '## 2026-10-29: Archived\n\n- a\n\n## 2026-10-28: Old\n\n- o\n';
    const c = mergeChanges(archive, {
      '/x/docs/user/changes/2026-10-29-0900-early.md': '## 2026-10-29: Early\n\n- e\n',
      '/x/docs/user/changes/2026-10-29-1500-late.md': '## 2026-10-29: Late\n\n- l\n',
      '/x/docs/user/changes/2026-10-30-0800-next.md': '## 2026-10-30: Next\n\n- n\n',
      '/x/docs/user/changes/README.md': '## 2026-12-01: Ignored\n',
    });
    expect(c.map((x) => x.title)).toEqual(['Next', 'Late', 'Early', 'Archived', 'Old']);
  });
  it('a new fragment on a seen date shows the dot', () => {
    const archive = '## 2026-10-29: Archived\n\n- a\n';
    markChangesSeen(changeToken(mergeChanges(archive, {})[0]));
    const after = changeToken(mergeChanges(archive, { 'changes/2026-10-29-1000-new.md': '## 2026-10-29: New\n\n- n\n' })[0]);
    expect(after).toBe('2026-10-29 New');
    expect(hasNewChanges(after)).toBe(true);
  });
  it('a device with no record starts up to date', () => {
    expect(hasNewChanges('2026-10-19')).toBe(false);
    expect(changesSeen('2026-10-20')).toBe('2026-10-19');
    expect(hasNewChanges('2026-10-20')).toBe(true);
  });
  it('a stored value later than the newest entry is stale, so the dot shows until seen', () => {
    store.set('app-changes-seen', '2026-11-02');
    expect(hasNewChanges('2026-10-29')).toBe(true);
    markChangesSeen('2026-10-29');
    expect(hasNewChanges('2026-10-29')).toBe(false);
  });
  it('a new entry on an already seen date shows the dot', () => {
    const before = changeToken(parseChanges('## 2026-10-29: First\n\n- a\n')[0]);
    markChangesSeen(before);
    expect(hasNewChanges(before)).toBe(false);
    const after = changeToken(parseChanges('## 2026-10-29: Second\n\n- b\n\n## 2026-10-29: First\n\n- a\n')[0]);
    expect(hasNewChanges(after)).toBe(true);
    store.set('app-changes-seen', '2026-10-29');
    expect(hasNewChanges(after)).toBe(true);
  });
  it('the dot clears once seen', () => {
    store.set('app-changes-seen', '2026-10-17');
    expect(hasNewChanges('2026-10-19')).toBe(true);
    markChangesSeen('2026-10-19');
    expect(hasNewChanges('2026-10-19')).toBe(false);
  });
});
