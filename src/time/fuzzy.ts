// Fuzzy matching of past entries for the description combobox (#60): pure, so it is unit tested without a DOM.
import { type EntryRecord, isRunning, liveEntries, startMs, type TimeDocs } from './entries';

/** One suggestion: the latest entry of a description + project (+ space) pair, with how often it was used. */
export interface Candidate {
  entry: EntryRecord;
  spaceId: string;
  /** Lowercase, accent-free words of the description and of the project's name. */
  words: string[];
  pwords: string[];
  text: string;
  count: number;
  latest: number;
}

export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const split = (s: string): string[] => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Distinct past work: one candidate per description + project + space, the newest entry's fields, most used counted. */
export function buildCandidates(docs: TimeDocs, projectName: (spaceId: string, projectId: string) => string): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const [spaceId, doc] of docs) {
    for (const entry of liveEntries(doc)) {
      const text = norm(entry.description.trim().replace(/\s+/g, ' '));
      if (!text || isRunning(entry)) continue;
      const key = `${text}\u0000${entry.project_id ?? ''}\u0000${spaceId}`;
      const at = startMs(entry);
      const hit = by.get(key);
      if (hit) {
        hit.count++;
        if (at > hit.latest) Object.assign(hit, { entry: { ...entry, spaceId }, latest: at });
      } else {
        const pname = entry.project_id ? projectName(spaceId, entry.project_id) : '';
        by.set(key, { entry: { ...entry, spaceId }, spaceId, words: split(text), pwords: split(pname), text, count: 1, latest: at });
      }
    }
  }
  return [...by.values()];
}

/** True when `a` and `b` differ by at most one insertion, deletion, substitution or swap of neighbours. */
export function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Points for one query word against one candidate word: exact, prefix, inside, then a typo in the start of it. */
function wordScore(t: string, w: string): number {
  if (w === t) return 100;
  if (w.startsWith(t)) return 90;
  if (t.length >= 2 && w.includes(t)) return 60;
  if (t.length >= 4 && (withinOne(t, w) || withinOne(t, w.slice(0, t.length)) || withinOne(t, w.slice(0, t.length + 1)))) return 40;
  return 0;
}

const best = (t: string, words: readonly string[]): number => {
  let s = 0;
  for (const w of words) s = Math.max(s, wordScore(t, w));
  return s;
};

/** Candidates for what is typed: every typed word must match (in any order), best first, then most used, then newest. */
export function matchCandidates(query: string, candidates: readonly Candidate[], limit = 8): Candidate[] {
  const tokens = split(query);
  if (tokens.length === 0) return [];
  const q = tokens.join(' ');
  const scored: { c: Candidate; score: number }[] = [];
  for (const c of candidates) {
    let score = 0;
    for (const t of tokens) {
      const s = Math.max(best(t, c.words), best(t, c.pwords) * 0.6);
      if (s === 0) {
        score = -1;
        break;
      }
      score += s;
    }
    if (score < 0) continue;
    if (c.text.startsWith(q)) score += 50;
    scored.push({ c, score: score + Math.min(c.count, 5) });
  }
  scored.sort((a, b) => b.score - a.score || b.c.latest - a.c.latest);
  return scored.slice(0, limit).map((s) => s.c);
}
