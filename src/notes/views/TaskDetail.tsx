import { useEffect, useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../../app/context';
import { shares } from '../../app/shares-runtime';
import { navigate } from '../../app/router';
import { IconArrowLeft, IconClock, IconCheck, IconMore, IconTrash, IconButton, MenuButton, Page, toast, type MenuItem } from '../../app/ui';
import { createAttachmentHost } from '../../core/blobs/host';
import { visibleTags } from '../../core/hidden-tags';
import { applyLinkEdits, moveWithLinks, readLinkMode, summarise } from '../link-update';
import { deleteNote, noteText, restoreNote, touchNote, createNote, type NoteInfo } from '../note-store';
import { joinPath, noteTitle, normalizePath, pathKey, pathProblem, safeName, uniquePath, folderOf } from '../paths';
import { propertyChoices } from '../property-choices';
import { parseSpaceTarget } from '../space-move';
import { newTaskText, parseQuickAdd, TASK_FOLDER, TASK_TAG, isTaskProps } from '../tasks';
import { taskLinkTitle } from '../task-route';
import { CommitInput, useNoteIndexes } from './common';
import { NoteEditor } from './NoteEditor';
import { NoteHistory } from './NoteHistory';
import { Properties, readDisplay, writeDisplay, type PropertiesDisplay } from './Properties';

/**
 * One task, at `#/tasks/<id>`, for when Notes is off (F-33n): the same editor, properties and history as a note in Notes,
 * without the tree. A `[[link]]` to another task opens it; anything else is inert (plain notes need Notes).
 */
export function TaskDetail({ id }: { id: string }) {
  const app = useApp();
  const { spaces, spaceDocs, spaceId, setSpaceId } = app;
  const scopeDocs = useMemo(() => new Map(spaces.map((s) => [s.id, spaceDocs.get(s.id) ?? app.doc] as const)), [spaces, spaceDocs, app.doc]);
  const indexes = useNoteIndexes(scopeDocs);
  const found = [...indexes].find(([, ix]) => ix.byId.has(id));
  const sid = found?.[0] ?? spaceId;
  const index = found?.[1];
  const note = index?.byId.get(id) ?? null;
  const doc = scopeDocs.get(sid) ?? app.doc;
  const [display, setDisplayState] = useState<PropertiesDisplay>(readDisplay);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState('');
  const setDisplay = (d: PropertiesDisplay): void => {
    writeDisplay(d);
    setDisplayState(d);
  };

  // A task in another space switches to it, as a note does.
  useEffect(() => {
    if (found && sid !== spaceId) setSpaceId(sid);
  }, [id, sid, spaceId, !!found]);
  useEffect(() => setError(''), [id]);

  if (!note || !index) {
    return (
      <Page width="list" class="task-detail">
        <h1 class="visually-hidden">Task</h1>
        <p class="empty">This task does not exist, or it was deleted.</p>
        <a href="#/tasks">Back to Tasks</a>
      </Page>
    );
  }

  /** What a link reaches: this space, or the space it names (`Work:Plan`). */
  const lookup = (target: string): NoteInfo | null => {
    const p = parseSpaceTarget(target, spaces.map((s) => s.name));
    const named = p.space !== null ? spaces.find((s) => s.name.toLowerCase() === p.space?.toLowerCase()) : undefined;
    const ix = named ? indexes.get(named.id) : index;
    const hit = ix?.resolve(named ? p.rest : target, named && named.id !== sid ? '' : note.path);
    return (hit && ix?.byId.get(hit.id)) || null;
  };
  const linkTitle = (target: string): string | undefined => {
    const hit = lookup(target);
    return taskLinkTitle(hit ? { isTask: isTaskProps(hit.parsed.properties) } : null);
  };
  const openLink = (target: string): void => {
    const hit = lookup(target);
    const title = taskLinkTitle(hit ? { isTask: isTaskProps(hit.parsed.properties) } : null);
    if (hit && title === undefined) navigate('tasks', hit.id);
    else toast(title as string);
  };

  const rename = (title: string): void => {
    const clean = title.trim();
    if (!clean) return;
    const path = normalizePath(joinPath(folderOf(note.path), `${safeName(clean)}.md`));
    const problem = pathProblem(path) ?? (index.notes.some((n) => n.id !== note.id && pathKey(n.path) === pathKey(path)) ? `A task named ${path} already exists` : null);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const mode = readLinkMode(app.account);
    const edits = moveWithLinks(doc, index.notes, [{ id: note.id, path }], mode);
    if (edits.length === 0) return;
    const { links, notes } = summarise(edits);
    const what = `${links} ${links === 1 ? 'link' : 'links'} in ${notes} ${notes === 1 ? 'note' : 'notes'}`;
    if (mode === 'auto') toast(`Updated ${what}.`);
    else toast(`${what} pointed at this task.`, { timeout: 20_000, action: { label: 'Fix links', run: () => void applyLinkEdits(doc, edits) } });
  };

  const remove = (): void => {
    deleteNote(doc, note.id);
    navigate('tasks');
    toast(`Deleted ${noteTitle(note.path)}${shares.view(sid)?.active ? ', for everyone in this share' : ''}.`, {
      action: {
        label: 'Undo',
        run: () => {
          restoreNote(doc, note.id);
          navigate('tasks', note.id);
        },
      },
    });
  };

  const ytext = noteText(doc, note.id);
  const files = createAttachmentHost(doc, sid);
  const choices = propertyChoices(index.notes.map((n) => ({ properties: n.parsed.properties })));
  const tagNames = visibleTags(doc, [...new Set(index.notes.flatMap((n) => n.tags))].filter((t) => t !== TASK_TAG).sort());
  const check = (on: boolean) => (on ? <IconCheck /> : <span class="menu-spacer" aria-hidden="true" />);
  const menu: MenuItem[] = [
    { label: 'Properties: visible', icon: check(display === 'visible'), onSelect: () => setDisplay('visible') },
    { label: 'Properties: hidden', icon: check(display === 'hidden'), onSelect: () => setDisplay('hidden') },
    { label: 'Source mode (YAML and Markdown as typed)', icon: check(display === 'source'), onSelect: () => setDisplay(display === 'source' ? 'visible' : 'source') },
    { label: 'Version history…', icon: <span class="menu-spacer" aria-hidden="true" />, onSelect: () => setHistory(true) },
    { label: 'Delete task', icon: <IconTrash />, danger: true, onSelect: remove },
  ];

  return (
    <Page width="list" class="task-detail">
      <h1 class="visually-hidden">{noteTitle(note.path)}</h1>
      <article class="note-pane" aria-label={noteTitle(note.path)}>
        {history && ytext && <NoteHistory spaceId={sid} noteId={note.id} title={note.title} ytext={ytext as Y.Text} onClose={() => setHistory(false)} />}
        <div class="note-top">
          <nav class="note-crumbs" aria-label="Back">
            <a href="#/tasks">
              <IconArrowLeft /> Tasks
            </a>
          </nav>
        </div>
        <div class="note-title-row">
          <CommitInput class="note-title" label="Task title" value={noteTitle(note.path)} onCommit={rename} />
          <IconButton class="note-act" label="Version history" icon={<IconClock />} onClick={() => setHistory(true)} />
          <MenuButton class="note-more" label="More actions for this task" icon={<IconMore />} items={menu} />
        </div>
        {error ? <p class="error">{error}</p> : null}
        {display === 'visible' && <Properties doc={doc} note={note} tagSuggestions={tagNames} choices={choices} onOpenLink={openLink} onTag={() => undefined} />}
        {ytext ? (
          <NoteEditor
            key={note.id}
            ytext={ytext}
            files={files}
            mode={display === 'source' ? 'source' : 'live'}
            hideFrontMatter={display !== 'source'}
            onOpenLink={openLink}
            linkTitle={linkTitle}
            onTag={() => undefined}
            onMakeTask={(title, done) => {
              const path = uniquePath(joinPath(TASK_FOLDER, `${safeName(title)}.md`), index.notes.map((n) => n.path));
              const q = { ...parseQuickAdd(''), title, projects: [note.title] };
              createNote(doc, path, newTaskText(q).replace('status: open', done ? 'status: done' : 'status: open'));
              toast(`Made “${title}” a task.`);
              return noteTitle(path);
            }}
            onLocalEdit={() => touchNote(doc, note.id)}
          />
        ) : (
          <p class="error">This task has no text.</p>
        )}
      </article>
    </Page>
  );
}
