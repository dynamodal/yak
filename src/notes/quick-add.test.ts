import { describe, expect, it } from 'vitest';
import { EMPTY_FIELDS, mergeFields, parseDateWords, parseLine, quickTask, without } from './quick-add';
import { parseNote } from './frontmatter';

// A Friday.
const NOW = new Date(2026, 9, 30, 10, 0);

describe('parseDateWords', () => {
  const day = (s: string): string | null => parseDateWords(s.split(' '), NOW)?.date ?? null;
  it.each([
    ['today', '2026-10-30'],
    ['tomorrow', '2026-10-31'],
    ['mon', '2026-11-02'],
    ['fri', '2026-11-06'],
    ['Friday', '2026-11-06'],
    ['next week', '2026-11-02'],
    ['next fri', '2026-11-06'],
    ['next sun', '2026-11-08'],
    ['next month', '2026-11-01'],
    ['in 3 days', '2026-11-02'],
    ['in 2 weeks', '2026-11-13'],
    ['2026-12-24', '2026-12-24'],
  ])('%s', (words, date) => expect(day(words)).toBe(date));
  it('says how many words it used', () => expect(parseDateWords(['next', 'week', 'x'], NOW)?.used).toBe(2));
  it.each(['2026-02-30', 'next', 'in 3', 'in x days', 'friendly', 'ma'])('does not read %s', (w) => expect(day(w)).toBeNull());
  it('moves with the clock', () => expect(parseDateWords(['tomorrow'], new Date(2026, 11, 31))?.date).toBe('2027-01-01'));
});

describe('parseLine', () => {
  it('plain text is the title', () => {
    const p = parseLine('Buy milk', NOW);
    expect(p.tokens).toEqual([]);
    expect(p.title).toBe('Buy milk');
  });
  it('reads every kind of token and leaves the title', () => {
    const p = parseLine('Call Bob tomorrow +Acme @phone #client !high now', NOW);
    expect(p.title).toBe('Call Bob now');
    expect(p.tokens.map((t) => [t.kind, t.value])).toEqual([['due', '2026-10-31'], ['project', 'Acme'], ['context', 'phone'], ['tag', 'client'], ['priority', 'high']]);
  });
  it('reads a project with spaces written as a link', () => {
    const p = parseLine('Plan +[[Big Job]] next week', NOW);
    expect(p.tokens.map((t) => [t.kind, t.value])).toEqual([['project', 'Big Job'], ['due', '2026-11-02']]);
    expect(p.title).toBe('Plan');
  });
  it('keeps the old due: and adds scheduled:', () => {
    const p = parseLine('Report due:2026-11-20 sched:mon', NOW);
    expect(p.tokens.map((t) => [t.kind, t.value])).toEqual([['due', '2026-11-20'], ['scheduled', '2026-11-02']]);
  });
  it('leaves issue numbers and a lone # or + in the title', () => {
    expect(parseLine('Fix #12 and 1 + 1 # nothing', NOW).tokens).toEqual([]);
  });
  it('records where each token sits, so it can be cut out', () => {
    const line = 'a  @x b #y';
    const p = parseLine(line, NOW);
    expect(without(line, [p.tokens[0]!])).toBe('a b #y');
  });
});

describe('mergeFields', () => {
  it('lists add up without repeats and a picked single value wins', () => {
    const p = parseLine('x #a @home due:2026-11-20 !low', NOW);
    const f = mergeFields(p.tokens, { tags: ['A', 'b'], due: '2026-12-01' });
    expect(f.tags).toEqual(['A', 'b']);
    expect(f.contexts).toEqual(['home']);
    expect(f.due).toBe('2026-12-01');
    expect(f.priority).toBe('low');
  });
  it('is empty for no tokens', () => expect(mergeFields([], {})).toEqual(EMPTY_FIELDS));
});

describe('quickTask', () => {
  it('names the note after the title in Tasks and writes TaskNotes front matter', () => {
    const f = { ...EMPTY_FIELDS, due: '2026-10-31', scheduled: '2026-10-30', priority: 'high', projects: ['Acme'], contexts: ['phone'], tags: ['client'] };
    const { path, text } = quickTask('Call: Bob', f, [], NOW);
    expect(path).toBe('Tasks/Call- Bob.md');
    const props = parseNote(text).properties;
    expect(props).toMatchObject({ title: 'Call: Bob', status: 'open', priority: 'high', due: '2026-10-31', scheduled: '2026-10-30', contexts: ['phone'], projects: ['[[Acme]]'], tags: ['task', 'client'] });
  });
  it('defaults to normal priority and only the task tag', () => {
    const props = parseNote(quickTask('x', EMPTY_FIELDS, [], NOW).text).properties;
    expect(props).toMatchObject({ priority: 'normal', tags: ['task'] });
    expect(props.due).toBeUndefined();
    expect(props.projects).toBeUndefined();
  });
  it('avoids a name that is taken', () => {
    expect(quickTask('Same', EMPTY_FIELDS, ['tasks/same.md'], NOW).path).toBe('Tasks/Same 1.md');
  });
});
