import { localDate, newTaskText, TASK_FOLDER, type QuickAdd } from './tasks';
import { joinPath, safeName, uniquePath } from './paths';

/**
 * The quick-add line (#138): TaskNotes-style shorthand recognised as you type. `due:` takes a date,
 * `+project`, `@context`, `#tag` and `!priority` fill their fields, and the rest is the title.
 * A date written plainly ("tomorrow", "fri", "next week", "in 3 days", 2026-11-02) is the due date.
 * Everything here is pure: the clock is a parameter.
 */

export const PRIORITIES = ['none', 'low', 'normal', 'high'] as const;

export type TokenKind = 'due' | 'scheduled' | 'project' | 'context' | 'tag' | 'priority';

export interface Token {
  kind: TokenKind;
  /** The value the token stands for: a date, a name, a priority. */
  value: string;
  /** Where the token's text sits in the line (end exclusive). */
  start: number;
  end: number;
}

export interface ParsedLine {
  tokens: Token[];
  /** The line without its tokens, spaces tidied. */
  title: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function weekday(word: string): number {
  const w = word.toLowerCase();
  return WEEKDAYS.findIndex((d) => d === w || d.slice(0, 3) === w || (w.length === 4 && d.slice(0, 4) === w));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function realDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDate(d) === s;
}

/** A day written in words or ISO: the date as `YYYY-MM-DD` and how many words it used, or null. */
export function parseDateWords(words: readonly string[], now: Date): { date: string; used: number } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const w0 = (words[0] ?? '').toLowerCase();
  const w1 = (words[1] ?? '').toLowerCase();
  const w2 = (words[2] ?? '').toLowerCase();
  const out = (d: Date, used: number): { date: string; used: number } => ({ date: localDate(d), used });
  if (realDate(w0)) return { date: w0, used: 1 };
  if (w0 === 'today' || w0 === 'tonight') return out(today, 1);
  if (w0 === 'tomorrow' || w0 === 'tmrw') return out(addDays(today, 1), 1);
  if (w0 === 'next' && w1 === 'week') return out(addDays(today, 8 - (today.getDay() || 7)), 2);
  if (w0 === 'next' && w1 === 'month') return out(new Date(today.getFullYear(), today.getMonth() + 1, 1), 2);
  if (w0 === 'next' && weekday(w1) >= 0) {
    // That weekday in the coming Monday-based week.
    const monday = addDays(today, 8 - (today.getDay() || 7));
    return out(addDays(monday, (weekday(w1) + 6) % 7), 2);
  }
  if (w0 === 'in' && /^\d{1,3}$/.test(w1)) {
    const n = Number(w1);
    if (/^days?$/.test(w2)) return out(addDays(today, n), 3);
    if (/^weeks?$/.test(w2)) return out(addDays(today, n * 7), 3);
    if (/^months?$/.test(w2)) return out(new Date(today.getFullYear(), today.getMonth() + n, today.getDate()), 3);
  }
  const wd = weekday(w0);
  if (wd >= 0) return out(addDays(today, ((wd - today.getDay() + 6) % 7) + 1), 1); // the next such day, never today
  return null;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

/** Words as they sit in the line; `+[[Two words]]` is one word. */
function wordsOf(line: string): Word[] {
  const out: Word[] = [];
  for (const m of line.matchAll(/\+\[\[[^\]]+\]\]|\S+/g)) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

const PREFIXED = /^(due|sched|scheduled):(.+)$/i;

export function parseLine(line: string, now: Date): ParsedLine {
  const words = wordsOf(line);
  const tokens: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const t = w.text;
    const add = (kind: TokenKind, value: string, last = w): void => void tokens.push({ kind, value, start: w.start, end: last.end });
    const link = /^\+\[\[([^\]]+)\]\]$/.exec(t);
    const prefixed = PREFIXED.exec(t);
    if (link) add('project', (link[1] as string).trim());
    else if (/^\+[^\s+]+$/.test(t)) add('project', t.slice(1));
    else if (/^@[^\s@]+$/.test(t)) add('context', t.slice(1));
    else if (/^#[^\s#]+$/.test(t) && !/^#\d+$/.test(t)) add('tag', t.slice(1));
    else if (/^!(none|low|normal|high)$/i.test(t)) add('priority', t.slice(1).toLowerCase());
    else if (prefixed && parseDateWords([prefixed[2] as string], now)) add(/^due$/i.test(prefixed[1] as string) ? 'due' : 'scheduled', (parseDateWords([prefixed[2] as string], now) as { date: string }).date);
    else {
      const d = parseDateWords(words.slice(i, i + 3).map((x) => x.text), now);
      if (!d) continue;
      const last = words[i + d.used - 1] as Word;
      tokens.push({ kind: 'due', value: d.date, start: w.start, end: last.end });
      i += d.used - 1;
    }
  }
  return { tokens, title: without(line, tokens) };
}

/** The line with some tokens cut out and the spaces tidied. */
export function without(line: string, tokens: readonly Pick<Token, 'start' | 'end'>[]): string {
  let out = '';
  let at = 0;
  for (const t of [...tokens].sort((a, b) => a.start - b.start)) {
    out += line.slice(at, t.start);
    at = t.end;
  }
  return (out + line.slice(at)).replace(/\s+/g, ' ').trim();
}

/** What the chips hold: what the line says, joined with what was picked by hand. */
export interface Fields {
  due: string;
  scheduled: string;
  priority: string;
  projects: string[];
  contexts: string[];
  tags: string[];
}

export const EMPTY_FIELDS: Fields = { due: '', scheduled: '', priority: '', projects: [], contexts: [], tags: [] };

function union(...lists: (readonly string[])[]): string[] {
  const seen = new Map<string, string>();
  for (const v of lists.flat()) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()];
}

/** A picked value wins over the line for a single value (the last token wins in the line); lists add up. */
export function mergeFields(tokens: readonly Token[], picked: Partial<Fields>): Fields {
  const last = (kind: TokenKind): string => [...tokens].reverse().find((t) => t.kind === kind)?.value ?? '';
  const all = (kind: TokenKind): string[] => tokens.filter((t) => t.kind === kind).map((t) => t.value);
  return {
    due: picked.due || last('due'),
    scheduled: picked.scheduled || last('scheduled'),
    priority: picked.priority || last('priority'),
    projects: union(picked.projects ?? [], all('project')),
    contexts: union(picked.contexts ?? [], all('context')),
    tags: union(picked.tags ?? [], all('tag')),
  };
}

/** The Markdown file for a new task, and the path it takes in the space's tasks folder next to `existing` paths. */
export function quickTask(title: string, f: Fields, existing: Iterable<string>, now: Date): { path: string; text: string } {
  const q: QuickAdd = { title, contexts: f.contexts, tags: f.tags, due: f.due, priority: f.priority, projects: f.projects, repeat: null, scheduled: f.scheduled };
  return { path: uniquePath(joinPath(TASK_FOLDER, `${safeName(title)}.md`), existing), text: newTaskText(q, now) };
}
