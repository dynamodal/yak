import '../notes.css';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { effectiveHidden, useHiddenModules } from '../../app/features';
import { taskHref } from '../task-route';
import { TaskDetail } from './TaskDetail';
import { useAllSpaces, useYVersion } from '../../app/hooks';
import { collection } from '../../core/schema';
import { SpacePicker } from '../../app/views/SpacePicker';
import { useApp } from '../../app/context';
import type { ViewProps } from '../../app/registry';
import { navigate, parseHash } from '../../app/router';
import { Button, FiltersButton, IconArchive, IconButton, IconMore, IconPlay, IconRestore, MenuButton, Page, PageHeader, Pill } from '../../app/ui';
import { formatTracked, trackedByTask } from '../../core/tracked';
import { formatValue, parseInput } from '../frontmatter';
import { ARCHIVE_AFTER_DAYS, readTaskRules } from '../task-rules';
import { createNote, setNoteProperties, setNoteProperty } from '../note-store';
import { joinPath, safeName, uniquePath } from '../paths';
import {
  allContexts,
  archiveChanges,
  dueForArchive,
  checklistProgress,
  cell,
  completionChanges,
  dueDay,
  filterRows,
  filterTasks,
  groupByProject,
  groupByStatus,
  isCompleted,
  isRecurring,
  localDate,
  newTaskText,
  parseQuickAdd,
  progressText,
  recurringCompletion,
  sortRows,
  sortTasks,
  statusChanges,
  statusColumns,
  statusLabel,
  tableColumns,
  tasksFrom,
  TASK_FOLDER,
  type DueFilter,
  type ProjectGroup,
  type Progress,
  type Row,
  type Task,
  type TaskFilter,
} from '../tasks';
import { buildAgenda, type AgendaItem } from '../agenda';
import { CommitInput, useNoteIndexes } from './common';
import { BulkNotes, useNoteRow } from './NoteBulk';
import type { NoteIndex } from '../note-store';

/** The routes under `#/tasks/`. The switch offers List, Board and Table; Agenda and Projects are ways to group the list (F-33v). */
type Mode = 'agenda' | 'list' | 'board' | 'projects' | 'table';
const MODES: { id: Mode; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'table', label: 'Table' },
];
const ROUTES: readonly string[] = ['list', 'board', 'table', 'agenda', 'projects'];
/** The switch segment a route belongs to. */
const viewOf = (m: Mode): Mode => (m === 'agenda' || m === 'projects' ? 'list' : m);

/** `#/tasks/<id>` is one task; `#/tasks/list|board|…` is a view of them. A task id is a UUID, so it never matches a view name. */
export function TasksView({ params }: ViewProps) {
  const hidden = effectiveHidden(useHiddenModules());
  const detail = params[0] && !ROUTES.includes(params[0]) ? params[0] : undefined;
  // With Notes on a task opens in Notes, as it always did.
  useEffect(() => {
    if (detail && !hidden.has('notes') && parseHash(location.hash).join('/') === ['tasks', detail].join('/')) location.replace(`#/notes/${encodeURIComponent(detail)}`);
  }, [detail, hidden.has('notes')]);
  if (detail) return hidden.has('notes') ? <TaskDetail id={detail} /> : null;
  return <TasksList params={params} />;
}

function TasksList({ params }: ViewProps) {
  const notesHidden = effectiveHidden(useHiddenModules()).has('notes');
  const { doc, bus, spaceId, spaces, spaceDocs, privateDocs, account } = useApp();
  useYVersion(account.getMap('settings') as Y.AbstractType<unknown>);
  const rules = readTaskRules(account);
  const [showArchived, setShowArchived] = useState(false);
  const [showAll, setShowAll] = useAllSpaces('tasks');
  const all = showAll && spaces.length > 1;
  /** The spaces on show: every kept space, or the chosen one. */
  const scopeDocs = useMemo(() => {
    const docs = new Map<string, Y.Doc>();
    if (all) for (const s of spaces) docs.set(s.id, spaceDocs.get(s.id) ?? doc);
    else docs.set(spaceId, doc);
    return docs;
  }, [all, spaces, spaceDocs, spaceId, doc]);
  const indexes = useNoteIndexes(scopeDocs);
  const spaceName = (sid: string): string => spaces.find((s) => s.id === sid)?.name ?? sid;
  const mode: Mode = ROUTES.includes(params[0] ?? '') ? (params[0] as Mode) : 'list';
  const [message, setMessage] = useState('');
  const [listFilter, setListFilter] = useState<TaskFilter>({ status: 'active', due: 'any', context: '' });
  const [boardProject, setBoardProject] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [tableSource, setTableSource] = useState<'tasks' | 'notes'>('tasks');
  const [tableExtra, setTableExtra] = useState<readonly string[]>([]);
  /** Where new tasks go: the last used space, until another is picked here. */
  const [addTo, setAddTo] = useState<string | null>(null);
  const addSid = addTo && scopeDocs.has(addTo) ? addTo : scopeDocs.has(spaceId) ? spaceId : ([...scopeDocs.keys()][0] as string);
  const everyTask = useMemo(() => sortTasks([...indexes.values()].flatMap((ix) => tasksFrom(ix.notes.map((n) => ({ id: n.id, path: n.path, properties: n.parsed.properties, body: n.parsed.body }))))), [indexes]);
  const archivedCount = everyTask.filter((t) => t.archived).length;
  const tasks = useMemo(() => everyTask.filter((t) => t.archived === showArchived), [everyTask, showArchived]);
  const spaceOfNote = useMemo(() => new Map([...indexes].flatMap(([sid, ix]) => ix.notes.map((n) => [n.id, sid] as const))), [indexes]);
  const docOf = (noteId: string): Y.Doc => scopeDocs.get(spaceOfNote.get(noteId) ?? '') ?? doc;

  const addTask = (input: string, projects: string[] = []): void => {
    const q = parseQuickAdd(input);
    if (!q.title) return;
    q.projects = projects;
    const ix = indexes.get(addSid) as NoteIndex;
    const path = uniquePath(joinPath(TASK_FOLDER, `${safeName(q.title)}.md`), ix.notes.map((n) => n.path));
    createNote(scopeDocs.get(addSid) as Y.Doc, path, newTaskText(q));
    const where = all ? ` to ${spaceName(addSid)}` : '';
    setMessage(`Added “${q.title}”${projects[0] ? ` to ${projects[0]}` : where}.`);
  };

  // With Time hidden (F-33l) a task has no timer button; the tasks and their time entries are kept.
  const timeOn = !effectiveHidden(useHiddenModules()).has('time');
  const tracked = useTracked(privateDocs, timeOn, mode);
  const tableSourceNow = notesHidden ? 'tasks' : tableSource;
  const table = useTableData(indexes, tableSourceNow, tableQuery, mode === 'table');
  const actions: TaskActions = {
    timeOn,
    tracked: (t) => (timeOn ? formatTracked(tracked.get(t.id)) : ''),
    open: (id) => navigate(notesHidden ? 'tasks' : 'notes', id),
    href: (id) => taskHref(id, notesHidden),
    spaceLabel: (t) => (all ? spaceName(spaceOfNote.get(t.id) ?? '') : undefined),
    setDone: (t, done) => {
      setNoteProperties(docOf(t.id), t.id, done && isRecurring(t) ? recurringCompletion(t) : completionChanges(done, new Date(), rules.completed_date));
      if (done && isRecurring(t)) setMessage(`Finished this round of “${t.title}”; the next one is scheduled.`);
    },
    setStatus: (t, status) => {
      if (t.status.toLowerCase() === status.toLowerCase()) return;
      setNoteProperties(docOf(t.id), t.id, isCompleted(status) && isRecurring(t) ? recurringCompletion(t) : statusChanges(status, new Date(), rules.completed_date));
      setMessage(`Moved “${t.title}” to ${status}.`);
    },
    archive: (t, archived) => {
      setNoteProperties(docOf(t.id), t.id, archiveChanges(t, archived));
      setMessage(archived ? `Archived “${t.title}”.` : `Restored “${t.title}”.`);
    },
    startTimer: (t) => {
      if (rules.start_on_timer && t.status.toLowerCase() === 'open') setNoteProperties(docOf(t.id), t.id, statusChanges('in-progress', new Date(), false));
      bus.emit('timer:start-request', { spaceId: spaceOfNote.get(t.id) ?? spaceId, description: t.title, taskId: t.id });
      setMessage(`Asked the timer to start for “${t.title}”.`);
    },
  };

  // Rule: archive tasks long finished. Idempotent, so devices doing it at once agree.
  useEffect(() => {
    if (!rules.archive_old_done) return;
    for (const t of dueForArchive(everyTask, ARCHIVE_AFTER_DAYS)) setNoteProperties(docOf(t.id), t.id, archiveChanges(t, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules.archive_old_done, everyTask]);

  const finished = tasks.filter((t) => !t.archived && isCompleted(t.status));
  return (
    <Page width={mode === 'board' || mode === 'table' ? 'workspace' : 'list'} class="tasks-page">
      <PageHeader
        title="Tasks"
        hideTitle
        filters={
          viewOf(mode) === 'list' ? (
            <ListFilters mode={mode} tasks={tasks} filter={listFilter} onChange={setListFilter} />
          ) : mode === 'board' ? (
            <BoardFilter tasks={tasks} project={boardProject} onChange={setBoardProject} />
          ) : (
            <TableFilters
              source={tableSource}
              onSource={setTableSource}
              query={tableQuery}
              onQuery={setTableQuery}
              extra={tableExtra}
              onExtra={setTableExtra}
              optional={tableOptional(table.columns, tableSource)}
              rows={table.rows.length}
              of={table.allRows.length}
              notesHidden={notesHidden}
            />
          )
        }
        views={
          <nav class="seg" aria-label="Task views">
            {MODES.map((m) => (
              <a key={m.id} href={`#/tasks/${m.id}`} class={m.id === viewOf(mode) ? 'active' : ''} aria-current={m.id === viewOf(mode) ? 'page' : undefined}>
                {m.label}
              </a>
            ))}
          </nav>
        }
        space={<SpacePicker all={all} onAll={setShowAll} />}
      />
      <QuickAdd
        spaces={all ? spaces : []}
        addTo={addSid}
        onAddTo={setAddTo}
        onAdd={(input) => addTask(input)}
      />
      <div class="row archive-bar">
        <label>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)} /> Show archived ({archivedCount})
        </label>
        {!showArchived && finished.length > 0 && (
          <Button
            onClick={() => {
              for (const t of finished) actions.archive(t, true);
              setMessage(`Archived ${finished.length} finished task${finished.length === 1 ? '' : 's'}.`);
            }}
          >
            Archive finished ({finished.length})
          </Button>
        )}
      </div>
      <p class="sr-status" role="status" aria-live="polite">
        {message}
      </p>
      <BulkNotes docs={scopeDocs} indexes={indexes} tasks>
        {mode === 'agenda' && <TaskAgenda tasks={tasks} actions={actions} />}
        {mode === 'list' && <TaskList tasks={tasks} actions={actions} filter={listFilter} />}
        {mode === 'board' && <TaskBoard tasks={tasks} actions={actions} project={boardProject} />}
        {mode === 'projects' && <TaskProjects tasks={tasks} actions={actions} onAdd={addTask} />}
        {mode === 'table' && (
          <TaskTable
            scopeDocs={scopeDocs}
            indexes={indexes}
            spaceName={all ? spaceName : undefined}
            notesHidden={notesHidden}
            source={tableSourceNow}
            rows={table.rows}
            allCount={table.allRows.length}
            columns={table.columns}
            extra={tableExtra}
            tracked={timeOn ? tracked : undefined}
          />
        )}
      </BulkNotes>
    </Page>
  );
}

interface TaskActions {
  open(id: string): void;
  /** The address a task's title links to. */
  href(id: string): string;
  setDone(t: Task, done: boolean): void;
  setStatus(t: Task, status: string): void;
  /** The Time feature is on, so tasks offer a timer. */
  timeOn: boolean;
  /** Time tracked on the task as "1 h 30 m"; empty when none or Time is off. */
  tracked(t: Task): string;
  startTimer(t: Task): void;
  archive(t: Task, archived: boolean): void;
  /** The task's space name, when several spaces are on show. */
  spaceLabel(t: Task): string | undefined;
}

function QuickAdd({ onAdd, spaces, addTo, onAddTo }: { onAdd(input: string): void; spaces: readonly { id: string; name: string }[]; addTo: string; onAddTo(id: string): void }) {
  const [text, setText] = useState('');
  return (
    <form
      class="row quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text);
        setText('');
      }}
    >
      <input
        aria-label="New task"
        placeholder="New task…"
        title="Add details as you type: @context  #tag  due:2026-10-20  !high  repeat:weekly"
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      {spaces.length > 1 && (
        <select aria-label="Space for the new task" value={addTo} onChange={(e) => onAddTo((e.target as HTMLSelectElement).value)}>
          {spaces.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" variant="primary" disabled={!text.trim()}>
        Add task
      </Button>
    </form>
  );
}

function TaskMeta({ t, space, tracked }: { t: Task; space?: string; tracked?: string }) {
  const today = localDate(new Date());
  const d = dueDay(t);
  return (
    <span class="task-meta">
      {space && <span class="task-space">{space}</span>}
      {d && <span class={`due${d < today && !isCompleted(t.status) ? ' overdue' : ''}`}>due {t.due}</span>}
      {t.scheduled && <span>scheduled {t.scheduled}</span>}
      {t.priority !== 'normal' && t.priority !== 'none' && <span class={`prio prio-${t.priority}`}>{t.priority}</span>}
      {t.contexts.map((c) => (
        <span key={c} class="ctx">
          @{c}
        </span>
      ))}
      {t.checklist && (
        <span class="checklist" aria-label={`Checklist: ${progressText(t.checklist)} done`}>
          {progressText(t.checklist)}
        </span>
      )}
      {t.timeEstimate !== null && <span>{t.timeEstimate} min</span>}
      {tracked && <span class="tracked">{tracked} tracked</span>}
    </span>
  );
}

/** The list's filters and grouping, behind the header's one Filters button. Agenda and Projects are groupings of the list. */
function ListFilters({ mode, tasks, filter, onChange }: { mode: Mode; tasks: Task[]; filter: TaskFilter; onChange(f: TaskFilter): void }) {
  const contexts = allContexts(tasks);
  const statuses = statusColumns(tasks);
  const flat = mode === 'list';
  const active = flat ? (filter.status !== 'active' ? 1 : 0) + (filter.due !== 'any' ? 1 : 0) + (filter.context !== '' ? 1 : 0) : 0;
  return (
    <FiltersButton count={active} onClear={() => onChange({ status: 'active', due: 'any', context: '' })}>
      <label>
        Group
        <select aria-label="Group" value={mode} onChange={(e) => navigate('tasks', (e.target as HTMLSelectElement).value)}>
          <option value="list">One list</option>
          <option value="agenda">By day (agenda)</option>
          <option value="projects">By project</option>
        </select>
      </label>
      {flat && (
        <>
          <label>
            Status
            <select aria-label="Status" value={filter.status} onChange={(e) => onChange({ ...filter, status: (e.target as HTMLSelectElement).value })}>
              <option value="active">Not done</option>
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due
            <select aria-label="Due" value={filter.due} onChange={(e) => onChange({ ...filter, due: (e.target as HTMLSelectElement).value as DueFilter })}>
              <option value="any">Any time</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="none">No date</option>
            </select>
          </label>
          <label>
            Context
            <select aria-label="Context" value={filter.context} onChange={(e) => onChange({ ...filter, context: (e.target as HTMLSelectElement).value })}>
              <option value="">Any context</option>
              {contexts.map((c) => (
                <option key={c} value={c}>
                  @{c}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </FiltersButton>
  );
}

function TaskList({ tasks, actions, filter }: { tasks: Task[]; actions: TaskActions; filter: TaskFilter }) {
  const shown = filterTasks(tasks, filter);
  return (
    <>
      {shown.length === 0 ? (
        <p class="empty">{tasks.length === 0 ? 'No tasks yet. Add one above, or tag any note with “task”.' : 'No tasks match these filters.'}</p>
      ) : (
        <ul class="task-list" aria-label="Tasks">
          {shown.map((t) => (
            <TaskItem key={t.id} t={t} actions={actions} />
          ))}
        </ul>
      )}
    </>
  );
}

/** One task in the list: ticks done, opens its note, or joins the selection (checkbox, Ctrl/Cmd/Shift click, long press). */
function TaskItem({ t, actions }: { t: Task; actions: TaskActions }) {
  const row = useNoteRow(t.id);
  return (
    <li
      class={`row-host${isCompleted(t.status) ? ' done' : ''}${row.picked ? ' selected' : ''}`}
      data-note-id={t.id}
      {...row.handlers}
      onClick={(e) => {
        if ((row.sel?.active || e.ctrlKey || e.metaKey || e.shiftKey) && !(e.target as Element).closest('button, input, select, a')) row.consume(e);
      }}
    >
      {row.checkbox}
      <input type="checkbox" aria-label={`Done: ${t.title}`} checked={isCompleted(t.status)} onChange={(e) => actions.setDone(t, (e.target as HTMLInputElement).checked)} />
      <div class="task-body">
        <a
          href={actions.href(t.id)}
          class="task-title"
          onClick={(e) => {
            if (row.consume(e)) e.preventDefault();
          }}
        >
          {t.title}
        </a>
        {t.status.toLowerCase() !== 'open' && (
          <Pill tone="quiet" class="status-pill">
            {statusLabel(t.status)}
          </Pill>
        )}
        <TaskMeta t={t} space={actions.spaceLabel(t)} tracked={actions.tracked(t)} />
      </div>
      <span class="row-actions">
        {actions.timeOn && <IconButton icon={<IconPlay />} label={`Start timer for ${t.title}`} onClick={() => actions.startTimer(t)} />}
        <MenuButton
          label={`More actions for ${t.title}`}
          icon={<IconMore />}
          items={[{ label: t.archived ? 'Restore' : 'Archive', icon: t.archived ? <IconRestore /> : <IconArchive />, onSelect: () => actions.archive(t, !t.archived) }]}
        />
      </span>
    </li>
  );
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

function dayLabel(day: string, today: string): string {
  const n = Date.parse(`${day}T00:00:00Z`);
  const diff = Math.round((n - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const base = dayFormat.format(n);
  return diff === 0 ? `Today, ${base}` : diff === 1 ? `Tomorrow, ${base}` : base;
}

/** What is due or scheduled today and in the next two weeks; overdue tasks first. */
function TaskAgenda({ tasks, actions }: { tasks: Task[]; actions: TaskActions }) {
  const today = localDate(new Date());
  const agenda = buildAgenda(tasks);
  const row = (i: AgendaItem) => (
    <li key={`${i.task.id}-${i.kind}-${i.day}`} class={i.future ? 'future' : undefined} data-note-id={i.task.id}>
      {!i.future && <input type="checkbox" aria-label={`Done: ${i.task.title}`} checked={false} onChange={() => actions.setDone(i.task, true)} />}
      <a href={actions.href(i.task.id)} class="task-title">
        {i.task.title}
      </a>
      <span class="task-meta">
        <span>{i.kind}</span>
        {isRecurring(i.task) && <span class="repeat">repeats</span>}
      </span>
    </li>
  );
  if (agenda.overdue.length === 0 && agenda.days.length === 0) return <p class="empty">Nothing due or scheduled in the next two weeks.</p>;
  return (
    <div class="agenda">
      {agenda.overdue.length > 0 && (
        <section aria-label="Overdue">
          <h2>
            Overdue <span class="count">{agenda.overdue.length}</span>
          </h2>
          <ul class="task-list">{agenda.overdue.map(row)}</ul>
        </section>
      )}
      {agenda.days.map((d) => (
        <section key={d.day} aria-label={dayLabel(d.day, today)} data-day={d.day}>
          <h2>{dayLabel(d.day, today)}</h2>
          <ul class="task-list">{d.items.map(row)}</ul>
        </section>
      ))}
    </div>
  );
}

/** Tasks grouped by project, each group with "2 of 5" progress and a field to add a task to it. */
function TaskProjects({ tasks, actions, onAdd }: { tasks: Task[]; actions: TaskActions; onAdd(input: string, projects: string[]): void }) {
  const groups = groupByProject(tasks);
  if (groups.length === 0) return <p class="empty">No tasks yet. Add one above.</p>;
  return (
    <div class="project-groups">
      {groups.map((g) => (
        <ProjectSection key={g.key} g={g} actions={actions} onAdd={onAdd} />
      ))}
    </div>
  );
}

function ProjectSection({ g, actions, onAdd }: { g: ProjectGroup; actions: TaskActions; onAdd(input: string, projects: string[]): void }) {
  const [text, setText] = useState('');
  return (
    <section class="project-group" aria-label={g.name} data-project={g.name}>
      <h2>
        {g.name}{' '}
        <span class="count" aria-label={`${progressText(g.progress)} tasks done`}>
          {progressText(g.progress)}
        </span>
      </h2>
      <progress value={g.progress.done} max={g.progress.total} aria-hidden="true" />
      <ul class="task-list" aria-label={`Tasks in ${g.name}`}>
        {g.tasks.map((t) => (
          <TaskItem key={t.id} t={t} actions={actions} />
        ))}
      </ul>
      {g.key !== '' && (
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onAdd(text, [g.name]);
            setText('');
          }}
        >
          <input aria-label={`Add a task to ${g.name}`} placeholder={`Add a task to ${g.name}`} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          <Button type="submit" disabled={!text.trim()}>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

const NO_PROJECT = '\u0000none';
const DRAG_TYPE = 'application/x-task-id';

/** Kanban grouped by status. Native drag and drop, plus a card menu to move a card with the keyboard or on a phone. */
function TaskBoard({ tasks: all, actions, project }: { tasks: Task[]; actions: TaskActions; project: string }) {
  const tasks = project === '' ? all : groupByProject(all).find((g) => g.key === (project === NO_PROJECT ? '' : project))?.tasks ?? [];
  const groups = groupByStatus(tasks);
  const columns = [...groups.keys()];
  const [over, setOver] = useState<string | null>(null);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const drop = (e: DragEvent, status: string): void => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer?.getData(DRAG_TYPE) || e.dataTransfer?.getData('text/plain');
    const t = id ? byId.get(id) : undefined;
    if (t) actions.setStatus(t, status);
  };

  return (
    <>
    <div class="board">
      {columns.map((status, ci) => {
        const items = groups.get(status) ?? [];
        return (
          <section
            key={status}
            class={`board-col${over === status ? ' over' : ''}`}
            aria-label={`${statusLabel(status)} (${items.length})`}
            data-status={status}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
              setOver(status);
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => drop(e, status)}
          >
            <h2>
              {statusLabel(status)} <span class="count">{items.length}</span>
            </h2>
            <ul>
              {items.map((t) => (
                <TaskCard key={t.id} t={t} ci={ci} columns={columns} actions={actions} onDragEnd={() => setOver(null)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
    </>
  );
}

/** The board's project filter, behind the header's one Filters button. */
function BoardFilter({ tasks, project, onChange }: { tasks: Task[]; project: string; onChange(p: string): void }) {
  const projects = groupByProject(tasks).filter((g) => g.key !== '');
  const hasNone = tasks.some((t) => t.projects.length === 0);
  return (
    <FiltersButton count={project === '' ? 0 : 1} onClear={() => onChange('')}>
      <label>
        Project
        <select aria-label="Board project" value={project} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
          <option value="">All projects</option>
          {projects.map((g) => (
            <option key={g.key} value={g.key}>
              {g.name} ({progressText(g.progress)})
            </option>
          ))}
          {hasNone && <option value={NO_PROJECT}>No project</option>}
        </select>
      </label>
    </FiltersButton>
  );
}

/** A table row that joins the selection; its first cell holds the checkbox while selecting, then the title link. */
function SelectableRow({ id, title, href, children }: { id: string; title: string; href: string; children: ComponentChildren }) {
  const row = useNoteRow(id);
  return (
    <tr
      data-id={id}
      data-note-id={id}
      class={row.picked ? 'selected' : undefined}
      {...row.handlers}
      onClick={(e) => {
        if ((row.sel?.active || e.ctrlKey || e.metaKey || e.shiftKey) && !(e.target as Element).closest('button, input, select, a')) row.consume(e);
      }}
    >
      {row.sel?.active && <td class="sel">{row.checkbox}</td>}
      <td>
        <a
          href={href}
          onClick={(e) => {
            if (row.consume(e)) e.preventDefault();
          }}
        >
          {title}
        </a>
      </td>
      {children}
    </tr>
  );
}

/** The header cell that lines up with the row checkboxes while selecting. */
function SelectHead() {
  const row = useNoteRow('');
  return row.sel?.active ? <th class="sel" aria-label="Select" /> : null;
}

function TaskCard({ t, ci, columns, actions, onDragEnd }: { t: Task; ci: number; columns: string[]; actions: TaskActions; onDragEnd(): void }) {
  const row = useNoteRow(t.id);
  return (
    <li
      class={`card task-card row-host${row.picked ? ' selected' : ''}`}
      draggable
      data-task-id={t.id}
      data-note-id={t.id}
      {...row.handlers}
      onClick={(e) => {
        if ((row.sel?.active || e.ctrlKey || e.metaKey || e.shiftKey) && !(e.target as Element).closest('button, input, select, a')) row.consume(e);
      }}
      onDragStart={(e) => {
        e.dataTransfer?.setData(DRAG_TYPE, t.id);
        e.dataTransfer?.setData('text/plain', t.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEnd}
    >
      {row.checkbox}
      <a
        href={actions.href(t.id)}
        class="task-title"
        draggable={false}
        onClick={(e) => {
          if (row.consume(e)) e.preventDefault();
        }}
      >
        {t.title}
      </a>
      <TaskMeta t={t} space={actions.spaceLabel(t)} tracked={actions.tracked(t)} />
      <span class="row-actions card-actions">
        {actions.timeOn && <IconButton icon={<IconPlay />} label={`Start timer for ${t.title}`} title="Start timer" onClick={() => actions.startTimer(t)} />}
        <MenuButton
          label={`More actions for ${t.title}`}
          icon={<IconMore />}
          items={[
            ...columns.filter((_, i) => i !== ci).map((c) => ({ label: `Move to ${statusLabel(c)}`, onSelect: () => actions.setStatus(t, c) })),
            { label: t.archived ? 'Restore' : 'Archive', icon: t.archived ? <IconRestore /> : <IconArchive />, onSelect: () => actions.archive(t, !t.archived) },
          ]}
        />
      </span>
    </li>
  );
}

/** The task table's leading columns, after the title: the task fields people scan (F-33v). Other properties are optional columns. */
const FIXED_COLUMNS = ['status', 'due', 'projects'];
const COLUMN_LABEL: Record<string, string> = { status: 'Status', due: 'Due', projects: 'Project', checklist: 'Checklist' };
const columnLabel = (c: string): string => COLUMN_LABEL[c] ?? c;

/** The columns the Filters panel can add to the task table; none for the all-notes table, which shows every property. */
function tableOptional(columns: readonly string[], source: 'tasks' | 'notes'): string[] {
  return source === 'tasks' ? ['checklist', ...columns.filter((c) => !FIXED_COLUMNS.includes(c))] : [];
}

/**
 * Seconds tracked per task id, from the time entries of every space; nothing while Time is off. Recomputed when entries
 * change, when `refresh` does (the view switched) and every 30 s, so a running entry's time moves on.
 */
function useTracked(docs: ReadonlyMap<string, Y.Doc>, on: boolean, refresh: string): Map<string, number> {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!on) return;
    const maps = [...docs.values()].map((d) => collection(d, 'time_entries'));
    const bump = (): void => setVersion((v) => v + 1);
    for (const m of maps) m.observeDeep(bump);
    const tick = setInterval(bump, 30_000);
    return () => {
      for (const m of maps) m.unobserveDeep(bump);
      clearInterval(tick);
    };
  }, [docs, on]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (on ? trackedByTask(docs.values(), Date.now()) : new Map<string, number>()), [docs, on, version, refresh]);
}

/** The rows of the table (tasks, or every note), the columns they have between them, and those the query keeps. */
function useTableData(indexes: ReadonlyMap<string, NoteIndex>, source: 'tasks' | 'notes', query: string, on: boolean) {
  const allRows: Row[] = useMemo(() => {
    if (!on) return [];
    return [...indexes.values()].flatMap((ix) => {
      const props = (n: { parsed: { properties: Row['properties'] } }): Row['properties'] => n.parsed.properties;
      if (source === 'notes') return ix.notes.map((n) => ({ id: n.id, path: n.path, title: n.title, properties: props(n) }));
      return tasksFrom(ix.notes.map((n) => ({ id: n.id, path: n.path, properties: props(n) }))).map((t) => ({ id: t.id, path: t.path, title: t.title, properties: t.properties }));
    });
  }, [indexes, source, on]);
  const columns = useMemo(() => tableColumns(allRows), [allRows]);
  const rows = useMemo(() => filterRows(allRows, query), [allRows, query]);
  return { allRows, columns, rows };
}

/** The table's controls, behind the header's one Filters button. */
function TableFilters(p: {
  source: 'tasks' | 'notes';
  onSource(s: 'tasks' | 'notes'): void;
  query: string;
  onQuery(q: string): void;
  extra: readonly string[];
  onExtra(c: readonly string[]): void;
  optional: readonly string[];
  rows: number;
  of: number;
  notesHidden: boolean;
}) {
  const source = p.notesHidden ? 'tasks' : p.source;
  const count = (p.query.trim() ? 1 : 0) + (source === 'notes' ? 1 : 0);
  return (
    <FiltersButton
      count={count}
      onClear={() => {
        p.onQuery('');
        p.onSource('tasks');
      }}
    >
      {!p.notesHidden && (
        <label>
          Rows
          <select aria-label="Rows" value={source} onChange={(e) => p.onSource((e.target as HTMLSelectElement).value as 'tasks' | 'notes')}>
            <option value="tasks">Tasks</option>
            <option value="notes">All notes</option>
          </select>
        </label>
      )}
      <label>
        Filter rows
        <input
          type="search"
          aria-label="Filter rows"
          placeholder="words or property:value"
          title="status:open, due:, contexts:*"
          value={p.query}
          onInput={(e) => p.onQuery((e.target as HTMLInputElement).value)}
        />
      </label>
      {p.optional.length > 0 && (
        <fieldset class="filters-columns">
          <legend>More columns</legend>
          {p.optional.map((c) => (
            <label key={c} class="check">
              <input type="checkbox" checked={p.extra.includes(c)} onChange={(e) => p.onExtra((e.target as HTMLInputElement).checked ? [...p.extra, c] : p.extra.filter((x) => x !== c))} /> {columnLabel(c)}
            </label>
          ))}
        </fieldset>
      )}
      <span class="hint" aria-live="polite">
        {p.rows} of {p.of} rows
      </span>
    </FiltersButton>
  );
}

/**
 * The tasks as a table, in the spirit of Obsidian Bases: Task, Status, Due, Project and, with Time on, Tracked. Other
 * properties are columns the Filters panel adds; the all-notes table shows every property. Cells edit in place.
 */
function TaskTable(p: {
  scopeDocs: ReadonlyMap<string, Y.Doc>;
  indexes: ReadonlyMap<string, NoteIndex>;
  spaceName?: (sid: string) => string;
  notesHidden: boolean;
  source: 'tasks' | 'notes';
  rows: readonly Row[];
  allCount: number;
  columns: readonly string[];
  extra: readonly string[];
  tracked?: ReadonlyMap<string, number>;
}) {
  const { scopeDocs, indexes, spaceName, notesHidden, columns: found, tracked } = p;
  // Plain notes are Notes' to show: with Notes off the table lists tasks only.
  const source = notesHidden ? 'tasks' : p.source;
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'due', dir: 'asc' });
  const [editing, setEditing] = useState<{ id: string; col: string } | null>(null);
  const [error, setError] = useState('');

  const spaceOfRow = useMemo(() => new Map([...indexes].flatMap(([sid, ix]) => ix.notes.map((n) => [n.id, sid] as const))), [indexes]);
  const optional = tableOptional(found, source);
  const columns = source === 'tasks' ? [...FIXED_COLUMNS, ...optional.filter((c) => c !== 'checklist' && p.extra.includes(c))] : found;
  const showChecklist = source === 'tasks' && p.extra.includes('checklist');
  const showTracked = source === 'tasks' && tracked !== undefined;
  const progressOf = useMemo(() => new Map([...indexes.values()].flatMap((ix) => ix.notes.map((n) => [n.id, checklistProgress(n.parsed.body)] as const))), [indexes]);
  const rows = useMemo(() => {
    if (sort.col !== 'tracked' || !tracked) return sortRows(p.rows, sort.col, sort.dir);
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...p.rows].sort((a, b) => ((tracked.get(a.id) ?? 0) - (tracked.get(b.id) ?? 0)) * sign || a.title.localeCompare(b.title));
  }, [p.rows, sort, tracked]);

  const commit = (row: Row, col: string, input: string): void => {
    setEditing(null);
    const old = row.properties[col];
    const value = parseInput(input, old);
    const doc = scopeDocs.get(spaceOfRow.get(row.id) ?? '');
    if (!doc) return;
    const ok = setNoteProperty(doc, row.id, col, value === undefined ? (Array.isArray(old) ? [] : null) : value);
    setError(ok ? '' : `Could not edit ${row.path}: its front matter is not valid YAML.`);
  };

  const header = (col: string, label: string) => {
    const active = sort.col === col;
    return (
      <th key={col} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <Button class="th-sort" onClick={() => setSort({ col, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}>
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
        </Button>
      </th>
    );
  };

  return (
    <>
      {error ? <p class="error">{error}</p> : null}
      <div class="table-wrap">
        <table class="bases-table">
          <thead>
            <tr>
              <SelectHead />
              {header('title', source === 'tasks' ? 'Task' : 'Title')}
              {spaceName && <th>Space</th>}
              {columns.map((c) => header(c, columnLabel(c)))}
              {showTracked && header('tracked', 'Tracked')}
              {showChecklist && <th>Checklist</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SelectableRow key={r.id} id={r.id} title={r.title} href={taskHref(r.id, notesHidden)}>
                {spaceName && <td>{spaceName(spaceOfRow.get(r.id) ?? '')}</td>}
                {columns.map((c) => {
                  const v = cell(r, c);
                  const complex = v !== null && typeof v === 'object' && !Array.isArray(v);
                  if (editing?.id === r.id && editing.col === c) {
                    return (
                      <td key={c} class="editing">
                        <CommitInput label={`${c} of ${r.title}`} value={formatValue(v)} autoFocus onCommit={(s) => commit(r, c, s)} onCancel={() => setEditing(null)} />
                      </td>
                    );
                  }
                  return (
                    <td key={c}>
                      {complex ? (
                        <code>{formatValue(v)}</code>
                      ) : (
                        <Button class="cell" aria-label={`Edit ${c} of ${r.title}`} onClick={() => setEditing({ id: r.id, col: c })}>
                          {formatValue(v) || <span class="placeholder">—</span>}
                        </Button>
                      )}
                    </td>
                  );
                })}
                {showTracked && <td class="tracked">{formatTracked(tracked?.get(r.id)) || <span class="placeholder">—</span>}</td>}
                {showChecklist && <td class="checklist">{progressOf.get(r.id) ? progressText(progressOf.get(r.id) as Progress) : <span class="placeholder">—</span>}</td>}
              </SelectableRow>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p class="empty">{p.allCount === 0 ? 'No tasks yet.' : 'No rows.'}</p>}
    </>
  );
}
