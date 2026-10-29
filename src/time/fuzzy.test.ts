import { describe, expect, it } from 'vitest';
import { startTimer, stopTimer, liveEntries } from './entries';
import { buildCandidates, matchCandidates, withinOne } from './fuzzy';
import { at, makeSpaceDocs } from './testing';

function setup(items: { d: string; p?: string; tags?: string[]; day?: number }[]) {
  const docs = makeSpaceDocs();
  for (const [i, it] of items.entries()) {
    const t = at(2026, 10, it.day ?? 1 + i, 9, 0);
    const { id } = startTimer(docs, 'personal', 'dev', { description: it.d, project_id: it.p ?? null, tags: it.tags ?? [] }, t);
    stopTimer(docs.get('personal')!, id, t + 60_000);
  }
  return buildCandidates(docs, (_s, p) => (p === 'web' ? 'Website' : p));
}
const names = (q: string, c: ReturnType<typeof setup>) => matchCandidates(q, c).map((x) => x.entry.description);

describe('withinOne', () => {
  it('allows one edit or swap', () => {
    expect(withinOne('review', 'reveiw')).toBe(true);
    expect(withinOne('review', 'reviw')).toBe(true);
    expect(withinOne('review', 'reviews')).toBe(true);
    expect(withinOne('review', 'rexiew')).toBe(true);
    expect(withinOne('review', 'rewiev1')).toBe(false);
  });
});

describe('matchCandidates', () => {
  const c = setup([{ d: 'Review onboarding', p: 'web', tags: ['ux'] }, { d: 'Write report' }, { d: 'Onboarding call' }]);

  it('matches prefixes in any word order', () => {
    expect(names('rev onb', c)).toEqual(['Review onboarding']);
    expect(names('onb rev', c)).toEqual(['Review onboarding']);
  });
  it('matches inside words, project names and tolerates a typo', () => {
    expect(names('boarding', c)).toContain('Onboarding call');
    expect(names('website', c)).toEqual(['Review onboarding']);
    expect(names('reveiw', c)).toEqual(['Review onboarding']);
  });
  it('needs every word, ignores case and accents, and nothing for an empty query', () => {
    expect(names('rev xyz', c)).toEqual([]);
    expect(names('ÓNBOARD', c)).toHaveLength(2);
    expect(names('  ', c)).toEqual([]);
  });
  it('ranks a start-of-description match first, then the newer', () => {
    expect(names('onboarding', c)[0]).toBe('Onboarding call');
  });
});

describe('buildCandidates', () => {
  it('keeps one per description and project, the newest fields, and counts uses', () => {
    const c = setup([{ d: 'Plan', p: 'web', tags: ['a'] }, { d: ' plan ', p: 'web', tags: ['b'] }, { d: 'Plan' }]);
    expect(c).toHaveLength(2);
    const web = c.find((x) => x.entry.project_id === 'web')!;
    expect(web.count).toBe(2);
    expect(web.entry.tags).toEqual(['b']);
  });
  it('skips running and empty descriptions', () => {
    const docs = makeSpaceDocs();
    const t = at(2026, 10, 1, 10, 0);
    const { id } = startTimer(docs, 'personal', 'd', { description: '' }, t);
    stopTimer(docs.get('personal')!, id, t + 1000);
    startTimer(docs, 'personal', 'd', { description: 'live' }, t + 5000);
    expect(liveEntries(docs.get('personal')!)).toHaveLength(2);
    expect(buildCandidates(docs, () => '')).toEqual([]);
  });
  it('is fast on a year of entries', () => {
    const items = Array.from({ length: 2500 }, (_, i) => ({ d: `Task ${i % 700} review notes`, day: 1 + (i % 28) }));
    const docs = makeSpaceDocs();
    const doc = docs.get('personal')!;
    for (const [i, it] of items.entries()) {
      const t = at(2026, 10, it.day, 9, 0) + i;
      const { id } = startTimer(docs, 'personal', 'd', { description: it.d }, t);
      stopTimer(doc, id, t + 1000);
    }
    const cands = buildCandidates(docs, () => '');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) matchCandidates('rev tsk 12', cands);
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});
