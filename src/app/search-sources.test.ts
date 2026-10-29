import { describe, expect, it } from 'vitest';
import { effectiveHidden } from './features';
import { collectVisible, type SearchEntry } from './search-sources';

const e = (kind: string, id: string): SearchEntry => ({ kind, spaceId: 's', id, title: id, names: [], text: '', tags: [], open: () => undefined }) as SearchEntry;
const all = [e('note', 'n1'), e('task', 't1'), e('entry', 'e1')];
const shown = (hidden: Parameters<typeof effectiveHidden>[0]): string[] => collectVisible(all, effectiveHidden(hidden)).map((x) => `${x.kind}:${x.id}`);

describe('collectVisible (#44)', () => {
  it('lists everything when nothing is hidden, with no duplicates', () => {
    expect(shown([])).toEqual(['note:n1', 'task:t1', 'entry:e1']);
  });
  it('lists a task as a note when only Tasks is off', () => {
    expect(shown(['tasks'])).toEqual(['note:n1', 'note:t1', 'entry:e1']);
  });
  it('keeps tasks and drops plain notes when only Notes is off', () => {
    expect(shown(['notes'])).toEqual(['task:t1', 'entry:e1']);
  });
  it('drops both when Notes and Tasks are off', () => {
    expect(shown(['notes', 'tasks'])).toEqual(['entry:e1']);
  });
  it('opens the same item: only the kind changes', () => {
    const open = () => undefined;
    const t = { ...e('task', 't2'), open };
    expect(collectVisible([t], effectiveHidden(['tasks']))[0]?.open).toBe(open);
  });
});
