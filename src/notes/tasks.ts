import { formatValue, serializeFrontMatter, type FrontMatterValue, type Properties } from './frontmatter';
import { frontMatterTags } from './links';
import { noteTitle } from './paths';
import { dayNumber, dayString, nextOccurrence, parseRule, simpleRule, type Freq } from './recurrence';

/**
 * Tasks are notes, compatible with TaskNotes (https://tasknotes.dev): a note is a task when its
 * front matter `tags` contains `task`. Fields keep TaskNotes' names and value formats.
 */

export const TASK_TAG = 'task';
export const TASK_FOLDER = 'Tasks';
/** TaskNotes' archive tag. */
const ARCHIVE_TAG = 'archived';
export const DEFAULT_STATUSES = ['open', 'in-progress', 'done'] as const;
/** Statuses that count as finished for filters and the done checkbox. */
const COMPLETED = new Set(['done', 'completed', 'complete', 'cancelled', 'canceled']);

export interface TaskSource {
  id: string;
  path: string;
  properties: Properties;
  /** The note body (after the front matter); gives the task its checklist progress. */
  body?: string;
}

export interface Progress {
  done: number;
  total: number;
}

export interface Task {
  id: string;
  path: string;
  title: string;
  status: string;
  priority: string;
  /** `YYYY-MM-DD` (TaskNotes may add a time: `YYYY-MM-DDTHH:mm`). */
  due: string;
  scheduled: string;
  contexts: string[];
  projects: string[];
  /** Minutes, or null. */
  timeEstimate: number | null;
  tags: string[];
  properties: Properties;
  /** Checkbox lines in the note body, or null when it has none. */
  checklist: Progress | null;
  /** The RRULE text, or '' for a task that does not repeat. */
  recurrence: string;
  archived: boolean;
  /** Dates of finished and skipped occurrences. */
  completeInstances: string[];
  skippedInstances: string[];
}

/** Count `- [ ]` and `- [x]` lines in a Markdown body; fenced code is skipped. Null when there are none. */
export function checklistProgress(body: string): Progress | null {
  let done = 0;
  let total = 0;
  let fence = '';
  for (const line of body.split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      const mark = (f[1] as string).slice(0, 3);
      if (!fence) fence = mark;
      else if (fence === mark) fence = '';
      continue;
    }
    if (fence) continue;
    const m = /^\s*[-*+]\s+\[([ xX])\]\s/.exec(line + ' ');
    if (!m) continue;
    total++;
    if (m[1] !== ' ') done++;
  }
  return total > 0 ? { done, total } : null;
}

export function isTaskProps(props: Properties): boolean {
  return frontMatterTags(props.tags).some((t) => t.toLowerCase() === TASK_TAG);
}

export function isCompleted(status: string): boolean {
  return COMPLETED.has(status.toLowerCase());
}

function str(v: FrontMatterValue): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(String).join(', ');
  return String(v);
}

function list(v: FrontMatterValue): string[] {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

export function toTask(src: TaskSource): Task {
  const p = src.properties;
  const est = typeof p.timeEstimate === 'number' ? p.timeEstimate : Number.parseFloat(str(p.timeEstimate));
  return {
    id: src.id,
    path: src.path,
    title: str(p.title).trim() || noteTitle(src.path),
    status: str(p.status).trim() || 'open',
    priority: str(p.priority).trim() || 'normal',
    due: str(p.due).trim(),
    scheduled: str(p.scheduled).trim(),
    contexts: list(p.contexts),
    projects: list(p.projects),
    timeEstimate: Number.isFinite(est) ? est : null,
    tags: frontMatterTags(p.tags),
    properties: p,
    recurrence: str(p.recurrence).trim(),
    archived: frontMatterTags(p.tags).some((t) => t.toLowerCase() === ARCHIVE_TAG),
    completeInstances: list(p.complete_instances),
    skippedInstances: list(p.skipped_instances),
    checklist: src.body ? checklistProgress(src.body) : null,
  };
}

/** A project as shown: `[[Acme|The Acme job]]` and `Acme` both give `Acme`. */
export function projectName(raw: string): string {
  const m = /^\s*!?\[\[([^\]|#]*)/.exec(raw);
  const name = (m ? (m[1] as string) : raw).trim();
  return name.split('/').pop() ?? name;
}

export interface ProjectGroup {
  /** Lower-case name; empty for tasks with no project. */
  key: string;
  name: string;
  tasks: Task[];
  progress: Progress;
}

/** Tasks grouped by project (a task with several projects is in each), named projects first, then "No project". Done counts finished tasks. */
export function groupByProject(tasks: readonly Task[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const add = (key: string, name: string, t: Task): void => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name, tasks: [], progress: { done: 0, total: 0 } }));
    g.tasks.push(t);
    g.progress.total++;
    if (isCompleted(t.status)) g.progress.done++;
  };
  for (const t of sortTasks(tasks)) {
    const names = [...new Map(t.projects.map(projectName).filter(Boolean).map((n) => [n.toLowerCase(), n] as const))];
    if (names.length === 0) add('', 'No project', t);
    else for (const [k, n] of names) add(k, n, t);
  }
  return [...groups.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name)));
}

export function progressText(p: Progress): string {
  return `${p.done} of ${p.total}`;
}

export function tasksFrom(sources: readonly TaskSource[]): Task[] {
  return sources.filter((s) => isTaskProps(s.properties)).map(toTask);
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Last day (Sunday) of the Monday-based week containing `d`. */
export function endOfWeek(d: Date): string {
  const e = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  e.setDate(e.getDate() + ((7 - e.getDay()) % 7));
  return localDate(e);
}

type StatusFilter = 'all' | 'active' | string;
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none';

export interface TaskFilter {
  status: StatusFilter;
  due: DueFilter;
  /** A context name, or '' for any. */
  context: string;
}

export function dueDay(t: Task): string {
  return t.due.slice(0, 10);
}

export function filterTasks(tasks: readonly Task[], f: TaskFilter, now = new Date()): Task[] {
  const today = localDate(now);
  const weekEnd = endOfWeek(now);
  return tasks.filter((t) => {
    if (f.status === 'active' && isCompleted(t.status)) return false;
    if (f.status !== 'all' && f.status !== 'active' && t.status.toLowerCase() !== f.status.toLowerCase()) return false;
    if (f.context && !t.contexts.some((c) => c.toLowerCase() === f.context.toLowerCase())) return false;
    const d = dueDay(t);
    switch (f.due) {
      case 'overdue':
        return d !== '' && d < today && !isCompleted(t.status);
      case 'today':
        return d === today;
      case 'week':
        return d !== '' && d >= today && d <= weekEnd;
      case 'none':
        return d === '';
      default:
        return true;
    }
  });
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, medium: 1, low: 2, none: 3 };

/** Open before done, then by due date (none last), priority, title. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ca = isCompleted(a.status) ? 1 : 0;
    const cb = isCompleted(b.status) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const da = dueDay(a) || '9999';
    const db = dueDay(b) || '9999';
    if (da !== db) return da < db ? -1 : 1;
    const pa = PRIORITY_RANK[a.priority.toLowerCase()] ?? 1.5;
    const pb = PRIORITY_RANK[b.priority.toLowerCase()] ?? 1.5;
    return pa - pb || a.title.localeCompare(b.title);
  });
}

/** Every context used by the tasks, sorted. */
export function allContexts(tasks: readonly Task[]): string[] {
  const set = new Map<string, string>();
  for (const t of tasks) for (const c of t.contexts) if (!set.has(c.toLowerCase())) set.set(c.toLowerCase(), c);
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

/** Board columns: the default statuses, then any other status found, in first-seen order. */
/** A status as people read it: `in-progress` is "In progress". The stored value is unchanged. */
export function statusLabel(status: string): string {
  const words = status.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function statusColumns(tasks: readonly Task[]): string[] {
  const cols: string[] = [...DEFAULT_STATUSES];
  for (const t of tasks) if (!cols.some((c) => c.toLowerCase() === t.status.toLowerCase())) cols.push(t.status);
  return cols;
}

export function groupByStatus(tasks: readonly Task[]): Map<string, Task[]> {
  const cols = statusColumns(tasks);
  const out = new Map<string, Task[]>(cols.map((c) => [c, []]));
  for (const t of sortTasks(tasks)) {
    const col = cols.find((c) => c.toLowerCase() === t.status.toLowerCase()) ?? t.status;
    out.get(col)?.push(t);
  }
  return out;
}

/** Front matter changes for marking a task done or open again (TaskNotes `completedDate`). */
export function completionChanges(done: boolean, now = new Date(), setDate = true): Properties {
  if (!setDate) return { status: done ? 'done' : 'open' };
  return done ? { status: 'done', completedDate: localDate(now) } : { status: 'open', completedDate: undefined };
}

/** Is the task a repeating one we can step forward? */
export function isRecurring(t: Pick<Task, 'recurrence'>): boolean {
  return parseRule(t.recurrence) !== null;
}

/**
 * Finishing a repeating task finishes one occurrence (TaskNotes): its date joins `complete_instances`,
 * `scheduled` moves to the next open occurrence and the status stays open. `due` is left as it is.
 * The occurrence is the scheduled day, else the due day, else today.
 */
export function recurringCompletion(t: Task, now = new Date()): Properties {
  const rule = parseRule(t.recurrence);
  if (!rule) return completionChanges(true, now);
  const today = dayNumber(localDate(now)) as number;
  const current = dayNumber(t.scheduled) ?? dayNumber(t.due) ?? today;
  const done = [...new Set([...t.completeInstances, dayString(current)])].sort();
  const exclude = new Set([...done, ...t.skippedInstances].map(dayNumber).filter((n): n is number => n !== null));
  const next = nextOccurrence(rule, current, current, exclude);
  const time = /T\d{2}:\d{2}/.exec(t.scheduled)?.[0] ?? '';
  return { complete_instances: done, scheduled: next === null ? undefined : dayString(next) + time, status: next === null ? 'done' : 'open' };
}

/** Front matter changes that archive a task (add the tag) or restore it. */
export function archiveChanges(t: Task, archived: boolean): Properties {
  const rest = t.tags.filter((x) => x.toLowerCase() !== ARCHIVE_TAG);
  return { tags: archived ? [...rest, ARCHIVE_TAG] : rest };
}

/** Finished tasks completed `days` or more days before `now`, not yet archived. */
export function dueForArchive(tasks: readonly Task[], days: number, now = new Date()): Task[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const limit = localDate(cutoff);
  return tasks.filter((t) => {
    const done = str(t.properties.completedDate).slice(0, 10);
    return !t.archived && isCompleted(t.status) && done !== '' && done <= limit;
  });
}

/** Front matter changes for moving a task to a board column. */
export function statusChanges(status: string, now = new Date(), setDate = true): Properties {
  if (!setDate) return { status };
  return isCompleted(status) ? { status, completedDate: localDate(now) } : { status, completedDate: undefined };
}

export interface QuickAdd {
  title: string;
  contexts: string[];
  tags: string[];
  due: string;
  priority: string;
  /** Project names; written as `[[Name]]` links, TaskNotes' form. */
  projects: string[];
  /** `repeat:daily|weekly|monthly|yearly`, or null. */
  repeat: Freq | null;
  /** `YYYY-MM-DD`, set by the quick-add modal (#138). */
  scheduled?: string;
}

/** Parse quick-add text: `Call Bob @phone #client due:2026-10-20 !high`. */
export function parseQuickAdd(input: string): QuickAdd {
  const contexts: string[] = [];
  const tags: string[] = [];
  let due = '';
  let priority = '';
  let repeat: Freq | null = null;
  const words: string[] = [];
  for (const w of input.trim().split(/\s+/)) {
    if (/^@[^\s@]+$/.test(w)) contexts.push(w.slice(1));
    else if (/^#[^\s#]+$/.test(w) && !/^#\d+$/.test(w)) tags.push(w.slice(1));
    else if (/^due:\d{4}-\d{2}-\d{2}$/i.test(w)) due = w.slice(4);
    else if (/^repeat:(daily|weekly|monthly|yearly)$/i.test(w)) repeat = w.slice(7).toUpperCase() as Freq;
    else if (/^!(none|low|normal|high)$/i.test(w)) priority = w.slice(1).toLowerCase();
    else if (w) words.push(w);
  }
  return { title: words.join(' '), contexts, tags, due, priority, projects: [], repeat };
}

/** The Markdown text of a new task note. */
export function newTaskText(q: QuickAdd, now = new Date()): string {
  const props: Properties = { title: q.title, status: 'open', priority: q.priority || 'normal' };
  if (q.due) props.due = q.due;
  if (q.contexts.length) props.contexts = q.contexts;
  if (q.projects.length) props.projects = q.projects.map((p) => `[[${p}]]`);
  if (q.scheduled) props.scheduled = q.scheduled;
  if (q.repeat) {
    const start = q.due || localDate(now);
    props.scheduled = start;
    props.recurrence = simpleRule(q.repeat, start);
  }
  props.tags = [TASK_TAG, ...q.tags.filter((t) => t.toLowerCase() !== TASK_TAG)];
  props.dateCreated = now.toISOString();
  return serializeFrontMatter(props) + '\n';
}

// Table view (in the spirit of Obsidian Bases): rows are notes, columns are front matter properties.

export interface Row {
  id: string;
  path: string;
  title: string;
  properties: Properties;
}

const PREFERRED = ['status', 'priority', 'due', 'scheduled', 'recurrence', 'contexts', 'projects', 'timeEstimate', 'tags'];

/** Columns for a set of rows: preferred task fields first, then every other property by name. */
export function tableColumns(rows: readonly Row[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.properties)) keys.add(k);
  keys.delete('title');
  const first = PREFERRED.filter((k) => keys.has(k));
  const rest = [...keys].filter((k) => !PREFERRED.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...first, ...rest];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Value of a column for sorting and filtering; the `title` column is the row's title. */
export function cell(row: Row, column: string): FrontMatterValue {
  return column === 'title' ? row.title : row.properties[column];
}

export function sortRows(rows: readonly Row[], column: string, dir: 'asc' | 'desc'): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = cell(a, column);
    const vb = cell(b, column);
    const ea = va === undefined || va === null || formatValue(va) === '';
    const eb = vb === undefined || vb === null || formatValue(vb) === '';
    if (ea || eb) return ea === eb ? collator.compare(a.title, b.title) : ea ? 1 : -1; // empty cells last
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign || collator.compare(a.title, b.title);
    return collator.compare(formatValue(va), formatValue(vb)) * sign || collator.compare(a.title, b.title);
  });
}

/**
 * Filter rows with a Bases-like query: `key:value` terms match a property (lists match any item,
 * `key:` alone means the property is empty, `key:*` means it is set), other words match the title
 * or any value. All terms must match; case-insensitive.
 */
export function filterRows(rows: readonly Row[], query: string): Row[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter((r) =>
    terms.every((term) => {
      const m = /^([^:]+):(.*)$/.exec(term);
      if (m) {
        const key = Object.keys(r.properties).find((k) => k.toLowerCase() === m[1]) ?? (m[1] === 'title' ? 'title' : m[1]!);
        const v = cell(r, key);
        const text = formatValue(v).toLowerCase();
        if (m[2] === '') return text === '';
        if (m[2] === '*') return text !== '';
        if (Array.isArray(v)) return v.some((x) => formatValue(x).toLowerCase().includes(m[2]!));
        return text.includes(m[2]!);
      }
      if (r.title.toLowerCase().includes(term)) return true;
      return Object.values(r.properties).some((v) => formatValue(v).toLowerCase().includes(term));
    }),
  );
}
