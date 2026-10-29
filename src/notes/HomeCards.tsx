import { useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { effectiveHidden, useHiddenModules } from '../app/features';
import { HomeCard } from '../app/home-cards';
import { useNow, useYVersion } from '../app/hooks';
import { changedLabel, dueLabel, dueSoon, noteExcerpt, noteFolder, recentNotes } from './home';
import { setNoteProperties } from './note-store';
import { readTaskRules } from './task-rules';
import { completionChanges, isCompleted, isRecurring, recurringCompletion, tasksFrom, type Task } from './tasks';
import { taskHref } from './task-route';
import { useNoteIndexes } from './views/common';

const SHOWN_TASKS = 6;
const SHOWN_NOTES = 5;

/** The documents of the spaces this device keeps. */
function useKeptDocs(): ReadonlyMap<string, Y.Doc> {
  const { spaces, spaceDocs } = useApp();
  return useMemo(() => new Map(spaces.filter((s) => spaceDocs.has(s.id)).map((s) => [s.id, spaceDocs.get(s.id) as Y.Doc] as const)), [spaces, spaceDocs]);
}

/** Home's "Due soon": late tasks and those due within a week, across spaces, each with a checkbox. */
export function DueSoonCard() {
  const { account } = useApp();
  useYVersion(account.getMap('settings') as Y.AbstractType<unknown>);
  const docs = useKeptDocs();
  const indexes = useNoteIndexes(docs);
  const notesHidden = effectiveHidden(useHiddenModules()).has('notes');
  const minute = Math.floor(useNow(60_000) / 60_000);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const { tasks, spaceOf } = useMemo(() => {
    const spaceOf = new Map<string, string>();
    const all: Task[] = [];
    for (const [sid, ix] of indexes) {
      for (const n of ix.notes) spaceOf.set(n.id, sid);
      all.push(...tasksFrom(ix.notes.map((n) => ({ id: n.id, path: n.path, properties: n.parsed.properties, body: n.parsed.body }))));
    }
    return { tasks: all, spaceOf };
  }, [indexes]);
  const now = useMemo(() => new Date(minute * 60_000), [minute]);
  const due = useMemo(() => dueSoon(tasks, now, kept), [tasks, now, kept]);
  if (due.length === 0) return null;
  const rules = readTaskRules(account);

  const check = (t: Task, done: boolean): void => {
    const doc = docs.get(spaceOf.get(t.id) ?? '');
    if (!doc) return;
    const recurring = done && isRecurring(t);
    setNoteProperties(doc, t.id, recurring ? recurringCompletion(t) : completionChanges(done, new Date(), rules.completed_date));
    if (recurring) setMessage(`Finished this round of “${t.title}”; the next one is scheduled.`);
    else {
      setKept((k) => new Set(k).add(t.id));
      setMessage(done ? `Marked “${t.title}” done.` : `Reopened “${t.title}”.`);
    }
  };

  return (
    <HomeCard id="due" title="Due soon" link={{ href: '#/tasks', label: 'Tasks' }}>
      <ul class="hm-list">
        {due.slice(0, SHOWN_TASKS).map((t) => {
          const done = isCompleted(t.status);
          const when = dueLabel(t.due, now);
          return (
            <li key={t.id} class={done ? 'hm-done' : undefined} data-task={t.id}>
              <input type="checkbox" checked={done} aria-label={`Mark “${t.title}” done`} onChange={(e) => check(t, (e.target as HTMLInputElement).checked)} />
              <a class="hm-main" href={taskHref(t.id, notesHidden)} title={t.title}>
                {t.title}
              </a>
              <span class={when.late && !done ? 'hm-late' : 'hm-meta'}>{when.text}</span>
            </li>
          );
        })}
      </ul>
      {due.length > SHOWN_TASKS ? (
        <p class="hm-sub">
          <a href="#/tasks">{due.length - SHOWN_TASKS} more</a>
        </p>
      ) : null}
      <p class="visually-hidden" role="status">
        {message}
      </p>
    </HomeCard>
  );
}

/** Home's "Recent notes": the notes (not tasks) changed last, across spaces. */
export function RecentNotesCard() {
  const docs = useKeptDocs();
  const indexes = useNoteIndexes(docs);
  const minute = Math.floor(useNow(60_000) / 60_000);
  const now = useMemo(() => new Date(minute * 60_000), [minute]);
  const notes = useMemo(() => recentNotes([...indexes.values()].flatMap((ix) => ix.notes), SHOWN_NOTES), [indexes]);
  if (notes.length === 0) return null;
  return (
    <HomeCard id="notes" title="Recent notes" link={{ href: '#/notes', label: 'Notes' }}>
      <ul class="hm-list">
        {notes.map((n) => {
          // The folder and a line of the text tell notes apart; either is left out when there is none.
          const sub = [noteFolder(n.path), noteExcerpt(n.parsed.body, n.title)].filter(Boolean).join(' · ');
          return (
            <li key={n.id} data-note={n.id} class={sub ? 'hm-two' : undefined}>
              <div class="hm-stack">
                <a class="hm-main" href={`#/notes/${encodeURIComponent(n.id)}`} title={n.title}>
                  {n.title}
                </a>
                {sub ? <span class="hm-sub-line">{sub}</span> : null}
              </div>
              <span class="hm-meta">{changedLabel(n.updated_at, now)}</span>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
