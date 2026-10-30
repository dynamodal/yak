import '../notes.css';
import { Fragment } from 'preact';
import { createAttachmentHost } from '../../core/blobs/host';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useAllSpaces, useYVersion } from '../../app/hooks';
import { visibleTags } from '../../core/hidden-tags';
import { SpacePicker } from '../../app/views/SpacePicker';
import { useApp } from '../../app/context';
import { shares } from '../../app/shares-runtime';
import type { ViewProps } from '../../app/registry';
import { navigate } from '../../app/router';
import { Button, IconCalendar, IconCheck, IconChevronDown, IconChevronRight, IconCollapseAll, IconExpandAll, IconFolderPlus, IconClock, IconMore, IconMove, IconNotePlus, IconPlus, IconSettings, IconTrash, MenuButton, Page, PageSelectButton, IconButton, toast, type MenuItem } from '../../app/ui';
import { applyLinkEdits, moveWithLinks, readLinkMode, summarise } from '../link-update';
import { NoteHistory } from './NoteHistory';
import { backlinks, frontMatterTags, pathForLinkTarget } from '../links';
import { bookmarks as listBookmarks, bookmarksMap, isBookmarked, setBookmark } from '../bookmarks';
import { openPeriodNote, openTodaysNote } from '../daily';
import { unlinkedMentions } from '../mentions';
import { outline } from '../outline';
import { copyBlobs } from '../../core/blobs/copy';
import { moveToSpace, parseSpaceTarget, planSpacePaths } from '../space-move';
import { addFolder, buildIndex, createNote, deleteNote, moveFolderEntries, newNoteText, noteText, notesMap, removeFolder, NOTE_RESTORE_DAYS, recentlyDeletedNotes, restoreNote, touchNote, type NoteIndex, type NoteInfo } from '../note-store';
import {
  allFolders,
  buildTree,
  folderOf,
  folderTarget,
  joinPath,
  moveFolder,
  normalizePath,
  noteTitle,
  pathKey,
  pathProblem,
  planMove,
  safeName,
  splitPath,
  uniquePath,
  type FolderNode,
  type MoveSource,
} from '../paths';
import { propertyChoices } from '../property-choices';
import { searchSpaces } from '../search';
import { newTaskText, parseQuickAdd, TASK_FOLDER, TASK_TAG } from '../tasks';
import { CommitInput, useNoteIndexes } from './common';
import { BulkNotes, useNoteRow } from './NoteBulk';
import { FOCUS_EVENT, GOTO_EVENT, NoteEditor } from './NoteEditor';
import { MoveDialog } from './MoveDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Properties, readDisplay, writeDisplay, type PropertiesDisplay } from './Properties';
import { QuickSwitcher } from './QuickSwitcher';
import { onSwitcherRequest, takeSwitcherRequest } from '../switcher-request';
import { Tree } from './Tree';

/** A path problem, or one with a note other than `selfId` already at that path. */
function pathError(index: NoteIndex, path: string, selfId?: string): string | null {
  const problem = pathProblem(path);
  if (problem) return problem;
  const taken = index.notes.find((n) => n.id !== selfId && pathKey(n.path) === pathKey(path));
  return taken ? `A note named ${taken.path} already exists` : null;
}

/** Key of a folder (or, with an empty path, a whole space) in the collapsed set. */
const collapseKey = (sid: string, path: string): string => `${sid}\n${path}`;

interface Moving {
  sid: string;
  source: MoveSource;
  name: string;
  current: string;
}

export function NotesView({ params }: ViewProps) {
  const app = useApp();
  const { spaceDocs, spaces, spaceId, setSpaceId } = app;
  useYVersion(bookmarksMap(app.account) as Y.AbstractType<unknown>);
  const [showAll, setShowAll] = useAllSpaces('notes');
  const all = showAll && spaces.length > 1;
  /** The spaces on show: every kept space, or the chosen one. */
  const scopeDocs = useMemo(() => {
    const docs = new Map<string, Y.Doc>();
    if (all) for (const s of spaces) docs.set(s.id, spaceDocs.get(s.id) ?? app.doc);
    else docs.set(spaceId, app.doc);
    return docs;
  }, [all, spaces, spaceDocs, spaceId, app.doc]);
  const indexes = useNoteIndexes(scopeDocs);
  const spaceName = (sid: string): string => spaces.find((s) => s.id === sid)?.name ?? sid;
  const id = params[0] ?? null;
  const noteSid = id ? [...indexes].find(([, ix]) => ix.byId.has(id))?.[0] : undefined;
  /** The space of the open note, else the last used one: new notes and the note pane go there. */
  const activeSid = noteSid ?? spaceId;
  const doc = scopeDocs.get(activeSid) ?? app.doc;
  useYVersion(doc.getMap('hidden_tags') as Y.AbstractType<unknown>); // hiding a tag changes what the picker offers
  const index = indexes.get(activeSid) ?? ([...indexes.values()][0] as NoteIndex);
  const note = id ? (index.byId.get(id) ?? null) : null;
  const marked = listBookmarks(app.account)
    .flatMap((b) => {
      const info = indexes.get(b.spaceId)?.byId.get(b.noteId);
      return info ? [{ spaceId: b.spaceId, id: b.noteId, title: info.title }] : [];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  const deletedNotes = useMemo(() => [...scopeDocs].flatMap(([sid, d]) => recentlyDeletedNotes(d).map((n) => ({ ...n, sid }))), [scopeDocs, indexes]);
  const [query, setQuery] = useState('');
  const [switcher, setSwitcher] = useState(false);
  const [showList, setShowList] = useState(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<Moving | null>(null);
  const [newSid, setNewSid] = useState<string | null>(null);
  useEffect(() => setNewSid(null), [noteSid]); // the choice lasts until another note is open
  const [creatingIn, setCreatingIn] = useState<{ sid: string; parent: string } | null>(null);
  const [display, setDisplayState] = useState<PropertiesDisplay>(readDisplay);
  const [shortcuts, setShortcuts] = useState(false);
  const setDisplay = (d: PropertiesDisplay): void => {
    writeDisplay(d);
    setDisplayState(d);
  };

  // The open note's space becomes the last used one; a link to a note in a space not on show switches to it.
  useEffect(() => {
    if (!id) return;
    if (noteSid) {
      if (noteSid !== spaceId) setSpaceId(noteSid);
      return;
    }
    for (const [sid, d] of spaceDocs) {
      const rec = notesMap(d).get(id);
      if (sid !== spaceId && rec && rec.get('deleted') !== true) setSpaceId(sid);
    }
  }, [id, noteSid, spaceDocs, spaceId]);

  useEffect(() => {
    if (takeSwitcherRequest()) setSwitcher(true);
    return onSwitcherRequest(() => {
      takeSwitcherRequest();
      setSwitcher(true);
    });
  }, []);

  useEffect(() => {
    setShowList(false);
    setError('');
    setFocusPath((f) => (f === id ? f : null));
  }, [id]);

  const open = (noteId: string): void => navigate('notes', noteId);

  const toggleCollapsed = (key: string): void => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  /** The actions on one space's notes and folders; the tree of that space calls these. */
  const actionsFor = (sid: string) => {
    const d = scopeDocs.get(sid) ?? doc;
    const ix = indexes.get(sid) ?? index;
    const folderList = allFolders(ix.notes, ix.folders);

    const create = (path: string, text = newNoteText()): string | null => {
      const normalized = normalizePath(path);
      const problem = pathProblem(normalized);
      if (problem) {
        setError(problem);
        return null;
      }
      const newId = createNote(d, uniquePath(normalized, ix.notes.map((n) => n.path)), text);
      if (sid !== spaceId) setSpaceId(sid);
      setFocusPath(newId);
      open(newId);
      return newId;
    };

    const newNote = (folder = ''): void => {
      create(joinPath(folder, 'Untitled.md'));
    };

    /** A free "New folder" name in `parent`. */
    const freeFolderName = (parent: string): string => {
      const taken = new Set(folderList.map((f) => f.toLowerCase()));
      let name = 'New folder';
      for (let i = 2; taken.has(joinPath(parent, name).toLowerCase()); i++) name = `New folder ${i}`;
      return name;
    };

    /** Open the name box for a new folder in `parent` (the folder is made when the name is accepted). */
    const newFolder = (parent = ''): void => {
      if (parent) {
        const next = new Set(collapsed);
        next.delete(collapseKey(sid, parent));
        setCollapsed(next);
      }
      setError('');
      setShowList(true);
      setCreatingIn({ sid, parent });
    };

    const createFolder = (parent: string, name: string): void => {
      setCreatingIn(null);
      const clean = name.trim();
      // Not normalizePath: that is for notes and adds `.md`.
      const path = splitPath(joinPath(parent, clean).replace(/\\/g, '/')).join('/');
      const problem = clean ? pathProblem(`${path}/x.md`) : 'Enter a folder name.';
      const exists = folderList.some((f) => f.toLowerCase() === path.toLowerCase());
      const message = problem ?? (exists ? `A folder named ${path} already exists.` : null);
      if (message) {
        setError(message);
        toast(message);
        return;
      }
      addFolder(d, path);
    };

    const removeEmptyFolder = (path: string): void => {
      removeFolder(d, path);
      toast(`Deleted the folder ${path}.`, { action: { label: 'Undo', run: () => addFolder(d, path) } });
    };

    /** Move notes, keeping links working as the person chose (automatic with Undo, offered, or off). */
    const moveAll = (moves: readonly { id: string; path: string }[]): void => {
      const mode = readLinkMode(app.account);
      const before = ix.notes;
      const edits = moveWithLinks(d, before, moves, mode);
      if (edits.length === 0) return;
      const { links, notes } = summarise(edits);
      const what = `${links} ${links === 1 ? 'link' : 'links'} in ${notes} ${notes === 1 ? 'note' : 'notes'}`;
      if (mode === 'auto') {
        const back = moves.map((m) => ({ id: m.id, path: before.find((n) => n.id === m.id)?.path ?? m.path }));
        toast(`Updated ${what}.`, { action: { label: 'Undo', run: () => void moveWithLinks(d, buildIndex(d).notes, back, 'auto') } });
      } else {
        toast(`${what} pointed at what you moved.`, { timeout: 20_000, action: { label: 'Fix links', run: () => void applyLinkEdits(d, edits) } });
      }
    };

    const move = (source: MoveSource, folder: string): void => {
      const plan = planMove(ix.notes, source, folder);
      if (!plan.ok) {
        setError(plan.error);
        toast(plan.error);
        return;
      }
      setError('');
      // Empty folders (and those under the moved folder) follow, even when no note moves.
      if (source.kind === 'folder') {
        const to = folderTarget(source.path, folder);
        if (to.toLowerCase() !== source.path.toLowerCase()) moveFolderEntries(d, source.path, to);
      }
      if (plan.moves.length === 0) return;
      moveAll(plan.moves);
      if (source.kind === 'folder') {
        const next = new Set(collapsed);
        next.delete(collapseKey(sid, source.path));
        setCollapsed(next);
      }
    };

    const remove = (noteId: string): void => {
      const info = ix.byId.get(noteId);
      deleteNote(d, noteId);
      if (noteId === id) navigate('notes');
      toast(`Deleted ${info ? noteTitle(info.path) : 'the note'}${shares.view(sid)?.active ? ', for everyone in this share' : ''}.`, {
        action: {
          label: 'Undo',
          run: () => {
            restoreNote(d, noteId);
            open(noteId);
          },
        },
      });
    };

    /** Move a note or folder into another space: copied there, deleted here, links fixed as chosen. */
    const moveToOtherSpace = (toSid: string, source: MoveSource, folder: string): void => {
      const dst = spaceDocs.get(toSid);
      if (!dst) return;
      const plan = planSpacePaths(ix.notes, buildIndex(dst).notes, source, folder);
      if (!plan.ok) {
        setError(plan.error);
        toast(plan.error);
        return;
      }
      setError('');
      if (plan.moves.length === 0 && !plan.folder) return;
      const mode = readLinkMode(app.account);
      const result = moveToSpace(d, dst, { src: spaceName(sid), dst: spaceName(toSid) }, plan.moves, plan.folder, mode);
      void copyBlobs(sid, toSid, result.files);
      const opened = id ? result.newIds.get(id) : undefined;
      if (opened) navigate('notes', opened);
      else if (id && plan.moves.some((m) => m.id === id)) navigate('notes');
      const { links, notes } = summarise(result.edits);
      const what = `Moved to ${spaceName(toSid)}`;
      const linksText = `${links} ${links === 1 ? 'link' : 'links'} in ${notes} ${notes === 1 ? 'note' : 'notes'}`;
      const undo = { label: 'Undo', run: () => result.undo() };
      if (mode === 'ask' && links > 0) {
        toast(`${what}. ${linksText} pointed at what you moved.`, {
          timeout: 20_000,
          action: {
            label: 'Fix links',
            run: () => {
              applyLinkEdits(d, result.edits.filter((e) => e.in === 'src'));
              applyLinkEdits(dst, result.edits.filter((e) => e.in === 'dst'));
            },
          },
        });
      } else toast(mode === 'auto' && links > 0 ? `${what}. Updated ${linksText}.` : `${what}.`, { action: undo });
    };

    const openLink = (target: string): void => {
      const other = parseSpaceTarget(target, spaces.map((s) => s.name));
      const otherSpace = other.space !== null ? spaces.find((s) => s.name.toLowerCase() === other.space?.toLowerCase()) : undefined;
      if (otherSpace && otherSpace.id !== sid) {
        const od = spaceDocs.get(otherSpace.id);
        const hit = od ? buildIndex(od).resolve(other.rest, '') : null;
        if (hit) open(hit.id);
        else toast(`No note “${other.rest}” in ${otherSpace.name}.`);
        return;
      }
      if (otherSpace) target = other.rest;
      const found = ix.resolve(target, note?.path ?? '');
      if (found) {
        open(found.id);
        return;
      }
      let path = pathForLinkTarget(target);
      if (pathProblem(path)) path = `${safeName(target)}.md`;
      const newId = createNote(d, uniquePath(path, ix.notes.map((n) => n.path)), newNoteText());
      open(newId);
    };

    const renameFolder = (from: string, to: string): void => {
      const target = splitPath(to.replace(/\\/g, '/')).join('/');
      const problem = target ? pathProblem(`${target}/x.md`) : null;
      if (problem) {
        setError(problem);
        return;
      }
      const moves = moveFolder(ix.notes, from, target);
      const taken = new Set(ix.notes.filter((n) => !moves.some((m) => m.id === n.id)).map((n) => pathKey(n.path)));
      const clash = moves.find((m) => taken.has(pathKey(m.path)));
      if (clash) {
        setError(`A note named ${clash.path} already exists`);
        return;
      }
      setError('');
      d.transact(() => {
        moveAll(moves);
        moveFolderEntries(d, from, target);
      });
    };

    return { folderList, create, newNote, freeFolderName, newFolder, createFolder, removeEmptyFolder, moveAll, move, moveToSpace: moveToOtherSpace, remove, openLink, renameFolder };
  };
  const active = actionsFor(activeSid);
  /** In All spaces a new note goes to the space picked beside "New…" (default: the open note's, else the last used). */
  const newTarget = all && newSid && scopeDocs.has(newSid) ? newSid : activeSid;
  const creator = newTarget === activeSid ? active : actionsFor(newTarget);

  const trees = useMemo(() => new Map([...indexes].map(([sid, ix]) => [sid, buildTree(ix.notes, ix.folders)] as const)), [indexes]);
  const scopedNotes = useMemo(() => [...indexes.values()].flatMap((ix) => ix.notes), [indexes]);
  const hits = useMemo(() => (query.trim() ? searchSpaces([...indexes].map(([sid, ix]) => ({ id: sid, notes: ix.notes.map((n) => ({ ...n, aliases: frontMatterTags(n.parsed.properties.aliases) })) })), query) : []), [indexes, query]);
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of scopedNotes) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scopedNotes]);

  const missing = id !== null && !note;
  const cls = ['notes-page', id ? 'has-note' : '', showList ? 'show-list' : ''].filter(Boolean).join(' ');

  const folderKeys = [...indexes].flatMap(([sid, ix]) => allFolders(ix.notes, ix.folders).map((f) => collapseKey(sid, f)));
  const allCollapsed = folderKeys.length > 0 && folderKeys.every((k) => collapsed.has(k));

  return (
    <Page width="workspace" class={cls}>
      <h1 class="visually-hidden">Notes</h1>
      <aside class="notes-side" aria-label="Notes list">
        <div class="notes-toolbar" role="toolbar" aria-label="Notes">
          <input
            type="search"
            class="notes-search"
            aria-label="Search notes"
            placeholder="Search notes"
            title="Words, &quot;phrases&quot;, #tags"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              // Enter opens the best match: name matches rank first.
              const first = hits[0];
              if (e.key === 'Enter' && first) location.hash = `#/notes/${encodeURIComponent(first.id)}`;
            }}
          />
          <a class="btn quiet icon notes-gear" href="#/settings/notes" aria-label="Note settings" title="Note settings">
            <IconSettings />
          </a>
          <span class="notes-break" aria-hidden="true" />
          <SpacePicker all={all} onAll={setShowAll} />
          {all && (
            <select class="space-select" aria-label="Space for the new note" value={newTarget} onChange={(e) => setNewSid((e.target as HTMLSelectElement).value)}>
              {spaces.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          )}
          <MenuButton
            label="New…"
            icon={<IconPlus />}
            align="start"
            items={[
              { label: all ? `New note in ${spaceName(newTarget)}` : 'New note', icon: <IconNotePlus />, onSelect: () => creator.newNote() },
              { label: 'New folder', icon: <IconFolderPlus />, onSelect: () => active.newFolder() },
              { label: "Today's note", icon: <IconCalendar />, onSelect: () => openTodaysNote(app) },
              { label: "This week's note", icon: <span class="menu-spacer" aria-hidden="true" />, onSelect: () => openPeriodNote(app, 'weekly') },
              { label: "This month's note", icon: <span class="menu-spacer" aria-hidden="true" />, onSelect: () => openPeriodNote(app, 'monthly') },
            ]}
          />
          <IconButton
            label={allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
            icon={allCollapsed ? <IconExpandAll /> : <IconCollapseAll />}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(folderKeys))}
          />
          <PageSelectButton />
        </div>
        {!query.trim() && marked.length > 0 && (
          <details class="bookmarks" open>
            <summary>Bookmarks ({marked.length})</summary>
            <ul>
              {marked.map((b) => (
                <li key={`${b.spaceId}:${b.id}`}>
                  <a href={`#/notes/${encodeURIComponent(b.id)}`} class={b.id === id ? 'active' : ''}>
                    {all ? `${spaceName(b.spaceId)} · ` : ''}
                    {b.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
        <BulkNotes docs={scopeDocs} indexes={indexes}>
        {query.trim() ? (
          <ul class="search-hits" aria-label="Search results">
            {hits.length === 0 && <li class="empty">No matches.</li>}
            {hits.map((h) => (
              <HitRow key={h.id} hit={h} active={h.id === id} where={all ? `${spaceName(h.spaceId)} · ${h.path}` : h.path} />
            ))}
          </ul>
        ) : (
          [...indexes].map(([sid, ix]) => {
            const acts = actionsFor(sid);
            const spaceCollapsed = all && collapsed.has(collapseKey(sid, ''));
            const tree = (
              <Tree
                root={trees.get(sid) as FolderNode}
                activeId={id}
                conflicted={ix.conflicted}
                collapsed={new Set([...collapsed].filter((k) => k.startsWith(`${sid}\n`)).map((k) => k.slice(sid.length + 1)))}
                onToggle={(path) => toggleCollapsed(collapseKey(sid, path))}
                onOpen={open}
                onRenameFolder={acts.renameFolder}
                onNewInFolder={acts.newNote}
                onNewFolder={acts.newFolder}
                creatingIn={creatingIn?.sid === sid ? creatingIn.parent : null}
                newFolderName={creatingIn?.sid === sid ? acts.freeFolderName(creatingIn.parent) : ''}
                onCreateFolder={acts.createFolder}
                onCancelCreate={() => setCreatingIn(null)}
                onDeleteFolder={acts.removeEmptyFolder}
                spaceId={sid}
                onMove={(source, folder, from) => (from === sid ? acts.move(source, folder) : actionsFor(from).moveToSpace(sid, source, folder))}
                onMoveDialog={(source, name, current) => setMoving({ sid, source, name, current })}
                onRenameNote={(noteId) => {
                  setFocusPath(noteId);
                  open(noteId);
                }}
                onDeleteNote={acts.remove}
              />
            );
            if (!all) return <Fragment key={sid}>{tree}</Fragment>;
            return (
              <section key={sid} class="notes-space" aria-label={`Space ${spaceName(sid)}`}>
                <button type="button" class="notes-space-head" aria-expanded={!spaceCollapsed} onClick={() => toggleCollapsed(collapseKey(sid, ''))}>
                  {spaceCollapsed ? <IconChevronRight /> : <IconChevronDown />}
                  {spaceName(sid)}
                </button>
                {!spaceCollapsed && tree}
              </section>
            );
          })
        )}
        </BulkNotes>
        {tagCounts.length > 0 && (
          <details class="tag-list">
            <summary>Tags ({tagCounts.length})</summary>
            <div class="chips">
              {tagCounts.map(([t, c]) => (
                <Button key={t} class="chip" onClick={() => setQuery(`#${t}`)}>
                  #{t} <span class="count">{c}</span>
                </Button>
              ))}
            </div>
          </details>
        )}
        {deletedNotes.length > 0 && (
          <details class="deleted-notes">
            <summary>Recently deleted ({deletedNotes.length})</summary>
            <ul>
              {deletedNotes.map((n) => (
                <li key={n.id}>
                  <span class="deleted-path">{all ? `${spaceName(n.sid)} · ${n.path}` : n.path}</span>
                  <Button aria-label={`Restore ${n.path}`} onClick={() => restoreNote(scopeDocs.get(n.sid) ?? doc, n.id)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
            <p class="hint">Deleted notes can be brought back for {NOTE_RESTORE_DAYS} days.</p>
          </details>
        )}
        {error ? !note && <p class="error">{error}</p> : null}
      </aside>

      <div class="notes-main">
        <Button class="only-narrow" aria-expanded={showList} onClick={() => setShowList(!showList)}>
          {showList ? 'Back to note' : '☰ All notes'}
        </Button>
        {note ? (
          <NotePane
            key={note.id}
            doc={doc}
            spaceId={activeSid}
            index={index}
            resolves={(target, fromPath) => {
              const p = parseSpaceTarget(target, spaces.map((x) => x.name));
              const sp = p.space !== null ? spaces.find((x) => x.name.toLowerCase() === p.space?.toLowerCase()) : undefined;
              if (sp && sp.id !== activeSid) {
                const od = spaceDocs.get(sp.id);
                return od ? buildIndex(od).resolve(p.rest, '') !== null : false;
              }
              return index.resolve(sp ? p.rest : target, fromPath) !== null;
            }}
            note={note}
            autoFocusPath={focusPath === note.id}
            error={error}
            setError={setError}
            onOpen={open}
            onOpenLink={active.openLink}
            onTag={(t) => {
              setQuery(`#${t}`);
              setShowList(true);
            }}
            display={display}
            onDisplay={setDisplay}
            tagNames={visibleTags(doc, tagCounts.map(([t]) => t).filter((t) => t !== TASK_TAG))}
            onMoveNotes={active.moveAll}
            onMove={() => setMoving({ sid: activeSid, source: { kind: 'note', id: note.id }, name: noteTitle(note.path), current: folderOf(note.path) })}
            onDelete={() => active.remove(note.id)}
            onShortcuts={() => setShortcuts(true)}
          />
        ) : missing ? (
          <p class="empty">{all ? 'This note does not exist, or it was deleted.' : 'This note does not exist in this space, or it was deleted.'}</p>
        ) : (
          <div class="empty-state">
            <p class="empty">{scopedNotes.length === 0 ? 'Create your first note to get started.' : 'Pick a note, or create one. Press Ctrl+O (⌘O on a Mac) to find a note by name.'}</p>
            <div class="row">
              <Button variant="primary" onClick={() => creator.newNote()}>
                {all ? `New note in ${spaceName(newTarget)}` : 'New note'}
              </Button>
              <Button onClick={() => openTodaysNote(app)}>Today's note</Button>
            </div>
          </div>
        )}
      </div>

      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}

      {moving && (
        <MoveDialog
          name={moving.name}
          spaces={spaces}
          spaceId={moving.sid}
          foldersFor={(sid) => {
            const own = actionsFor(sid).folderList;
            const src = moving.source;
            return sid !== moving.sid || src.kind !== 'folder' ? own : own.filter((f) => !`${f}/`.toLowerCase().startsWith(`${src.path}/`.toLowerCase()));
          }}
          current={moving.current}
          onMove={(sid, folder) => (sid === moving.sid ? actionsFor(moving.sid).move(moving.source, folder) : actionsFor(moving.sid).moveToSpace(sid, moving.source, folder))}
          onClose={() => setMoving(null)}
        />
      )}

      {switcher && (
        <QuickSwitcher
          notes={scopedNotes}
          spaceOf={all ? (noteId) => spaceName([...indexes].find(([, ix]) => ix.byId.has(noteId))?.[0] ?? '') : undefined}
          onOpen={open}
          onCreate={(name) => {
            const path = pathProblem(normalizePath(name)) ? `${safeName(name)}.md` : name;
            active.create(path);
          }}
          onClose={() => setSwitcher(false)}
        />
      )}
    </Page>
  );
}

interface NotePaneProps {
  doc: Y.Doc;
  spaceId: string;
  index: NoteIndex;
  /** Whether a link written in this note reaches a note, in this space or one it names. */
  resolves(target: string, fromPath: string): boolean;
  note: NoteInfo;
  autoFocusPath: boolean;
  error: string;
  setError(e: string): void;
  onOpen(id: string): void;
  onOpenLink(target: string): void;
  onTag(tag: string): void;
  display: PropertiesDisplay;
  onDisplay(d: PropertiesDisplay): void;
  /** Tags used in this space, for the tag selector. */
  tagNames: readonly string[];
  onMove(): void;
  onMoveNotes(moves: readonly { id: string; path: string }[]): void;
  onDelete(): void;
  onShortcuts(): void;
}

function NotePane({ doc, spaceId, index, resolves, note, autoFocusPath, error, setError, onOpen, onOpenLink, onTag, display, onDisplay, tagNames, onMove, onMoveNotes, onDelete, onShortcuts }: NotePaneProps) {
  const app = useApp();
  useYVersion(bookmarksMap(app.account) as Y.AbstractType<unknown>);
  const marked = isBookmarked(app.account, spaceId, note.id);
  const [history, setHistory] = useState(false);
  const choices = useMemo(() => propertyChoices(index.notes.map((n) => ({ properties: n.parsed.properties }))), [index]);
  const ytext = noteText(doc, note.id);
  const files = useMemo(() => createAttachmentHost(doc, spaceId), [doc, spaceId]);
  const others = index.conflictsOf(note.id);
  const back = useMemo(() => backlinks(note.id, index.notes, index.resolve), [index, note.id]);
  const headings = useMemo(() => outline(note.text), [note.text]);
  const unlinked = useMemo(() => unlinkedMentions(note, index.notes, index.resolve), [index, note]);
  const reveal = (e: Event, offset: number): void => {
    (e.currentTarget as HTMLElement).closest('.note-pane')?.querySelector('.note-editor')?.dispatchEvent(new CustomEvent(GOTO_EVENT, { detail: offset }));
  };
  const outgoing = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const l of note.links) if (l.target && !seen.has(l.target)) seen.set(l.target, resolves(l.target, note.path));
    return [...seen.entries()];
  }, [note, index]);
  const folder = folderOf(note.path);

  /** The inline title renames the file in its folder; the folder changes with "Move to…". */
  const rename = (title: string): void => {
    const clean = title.trim();
    if (!clean) return;
    const path = normalizePath(joinPath(folder, `${safeName(clean)}.md`));
    const problem = pathError(index, path, note.id);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    onMoveNotes([{ id: note.id, path }]);
  };

  /** Enter in the title: the typed title is committed, then the cursor goes to the body. */
  const focusBody = (): void => {
    // The editor loads on first use, so try for a moment until its view exists.
    let tries = 0;
    const tryFocus = (): void => {
      const host = document.querySelector<HTMLElement>('.note-pane .note-editor');
      host?.dispatchEvent(new CustomEvent(FOCUS_EVENT));
      const ready = !!host && host.contains(document.activeElement);
      if (!ready && ++tries < 20) setTimeout(tryFocus, 50);
    };
    setTimeout(tryFocus, 0);
  };

  const check = (on: boolean) => (on ? <IconCheck /> : <span class="menu-spacer" aria-hidden="true" />);
  const menu: MenuItem[] = [
    { label: marked ? 'Remove bookmark' : 'Bookmark', icon: <span class="menu-spacer" aria-hidden="true" />, onSelect: () => setBookmark(app.account, spaceId, note.id, !marked) },
    { label: 'Move to…', icon: <IconMove />, onSelect: onMove },
    { label: 'Properties: visible', icon: check(display === 'visible'), onSelect: () => onDisplay('visible') },
    { label: 'Properties: hidden', icon: check(display === 'hidden'), onSelect: () => onDisplay('hidden') },
    { label: 'Source mode (YAML and Markdown as typed)', icon: check(display === 'source'), onSelect: () => onDisplay(display === 'source' ? 'visible' : 'source') },
    { label: 'Version history…', icon: <span class="menu-spacer" aria-hidden="true" />, onSelect: () => setHistory(true) },
    { label: 'Keyboard shortcuts', icon: <span class="menu-spacer" aria-hidden="true" />, onSelect: onShortcuts },
    { label: 'Delete note', icon: <IconTrash />, danger: true, onSelect: onDelete },
  ];

  return (
    <article class="note-pane" aria-label={note.title}>
      {history && ytext && <NoteHistory spaceId={spaceId} noteId={note.id} title={note.title} ytext={ytext} onClose={() => setHistory(false)} />}
      <div class="note-top">
        <nav class="note-crumbs" aria-label="Folder">
          {folder ? (
            splitPath(folder).map((seg, i, all) => (
              <span key={i} class="crumb">
                {seg}
                {i < all.length - 1 && <span class="crumb-sep" aria-hidden="true">/</span>}
              </span>
            ))
          ) : (
            <span class="crumb muted">Notes</span>
          )}
        </nav>
      </div>
      <div class="note-title-row">
        <CommitInput class="note-title" label="Note title" value={noteTitle(note.path)} autoFocus={autoFocusPath} onCommit={rename} onEnter={focusBody} />
        <IconButton class="note-act" label="Version history" icon={<IconClock />} onClick={() => setHistory(true)} />
        <IconButton class="note-act" label="Move to…" icon={<IconMove />} onClick={onMove} />
        <MenuButton class="note-more" label="More actions for this note" icon={<IconMore />} items={menu} />
      </div>
      {error ? <p class="error">{error}</p> : null}
      {others.length > 0 && (
        <p class="banner warn" role="status">
          Conflict: {others.length === 1 ? 'another note has' : `${others.length} other notes have`} the same path (both were kept, probably created on two devices). Rename one of them.{' '}
          {others.map((o) => (
            <Button variant="link" key={o} onClick={() => onOpen(o)}>
              Open the other note
            </Button>
          ))}
        </p>
      )}
      {display === 'visible' && <Properties doc={doc} note={note} tagSuggestions={tagNames} choices={choices} onOpenLink={onOpenLink} onTag={onTag} />}
      {ytext ? (
        <NoteEditor
          key={note.id}
          ytext={ytext}
          files={files}
          mode={display === 'source' ? 'source' : 'live'}
          hideFrontMatter={display !== 'source'}
          onOpenLink={onOpenLink}
          onTag={onTag}
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
        <p class="error">This note has no text.</p>
      )}
      <footer class="note-links">
        <details>
          <summary>
            Outline <span class="count">{headings.length}</span>
          </summary>
          {headings.length === 0 ? (
            <p class="empty">No headings. Start a line with <code>#</code> to add one.</p>
          ) : (
            <ul class="outline">
              {headings.map((h) => (
                <li key={h.from} style={{ marginLeft: `${(h.level - 1) * 0.75}rem` }}>
                  <Button variant="link" onClick={(e) => reveal(e, h.from)}>
                    {h.text}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </details>
        <details open={back.length > 0}>
          <summary>
            Linked mentions <span class="count">{back.length}</span>
          </summary>
          {back.length === 0 ? (
            <p class="empty">No other note links here.</p>
          ) : (
            <ul>
              {back.map((b) => (
                <li key={b.id}>
                  <a href={`#/notes/${encodeURIComponent(b.id)}`}>{noteTitle(b.path)}</a>
                  <span class="hint"> {folderOf(b.path)}</span>
                  {b.count > 1 && <span class="count"> ×{b.count}</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary>
            Unlinked mentions <span class="count">{unlinked.length}</span>
          </summary>
          {unlinked.length === 0 ? (
            <p class="empty">No other note names this one without linking to it.</p>
          ) : (
            <ul>
              {unlinked.map((b) => (
                <li key={b.id}>
                  <a href={`#/notes/${encodeURIComponent(b.id)}`}>{noteTitle(b.path)}</a>
                  <span class="hint"> {folderOf(b.path)}</span>
                  {b.count > 1 && <span class="count"> ×{b.count}</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary>
            Outgoing links <span class="count">{outgoing.length}</span>
          </summary>
          {outgoing.length === 0 ? (
            <p class="empty">
              No links. Type <code>[[Note name]]</code> to link a note.
            </p>
          ) : (
            <ul>
              {outgoing.map(([target, exists]) => (
                <li key={target}>
                  <Button variant="link" class={exists ? undefined : 'unresolved'} onClick={() => onOpenLink(target)}>
                    {target}
                  </Button>
                  {!exists && <span class="hint"> (not created yet)</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
      </footer>
    </article>
  );
}

/** A search hit: opens the note, or joins the selection like a row of the tree. */
function HitRow({ hit: h, active, where }: { hit: { id: string; title: string; snippet?: string }; active: boolean; where: string }) {
  const row = useNoteRow(h.id);
  return (
    <li data-note-id={h.id} class={row.picked ? 'selected' : undefined}>
      {row.checkbox}
      <a
        href={`#/notes/${encodeURIComponent(h.id)}`}
        class={active ? 'active' : ''}
        {...row.handlers}
        onClick={(e) => {
          if (row.consume(e)) e.preventDefault();
        }}
      >
        <span class="hit-title">{h.title}</span>
        <span class="hit-path">{where}</span>
        {h.snippet && <span class="hit-snippet">{h.snippet}</span>}
      </a>
    </li>
  );
}
