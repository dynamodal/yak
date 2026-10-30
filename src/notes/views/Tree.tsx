import { useState } from 'preact/hooks';
import { IconChevronDown, IconChevronRight, IconEdit, IconFolder, IconFolderPlus, IconMore, IconMove, IconNote, IconNotePlus, IconTrash, MenuButton, Pill, type MenuItem } from '../../app/ui';
import { folderOf, noteTitle, type FolderNode, type MoveSource, type PathItem } from '../paths';
import { CommitInput } from './common';
import { useNoteRow } from './NoteBulk';

export interface TreeProps {
  /** This tree's space; carried by a drag so a drop in another space's tree can tell. */
  spaceId: string;
  root: FolderNode;
  activeId: string | null;
  conflicted: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggle(path: string): void;
  onOpen(id: string): void;
  onRenameFolder(from: string, to: string): void;
  onNewInFolder(folder: string): void;
  onNewFolder(parent: string): void;
  /** The folder in which a name box for a new folder is open ('' = top level), or null. */
  creatingIn: string | null;
  /** The suggested name in that box. */
  newFolderName: string;
  onCreateFolder(parent: string, name: string): void;
  onCancelCreate(): void;
  /** Delete an empty folder. */
  onDeleteFolder(path: string): void;
  /** Drag and drop, and the "Move to…" item: move a note or folder into `folder` ('' = top level). */
  onMove(source: MoveSource, folder: string, fromSpace: string): void;
  onMoveDialog(source: MoveSource, name: string, current: string): void;
  onRenameNote(id: string): void;
  onDeleteNote(id: string): void;
}

const DRAG_TYPE = 'application/x-yak-note-move';

/**
 * The file tree. Folders are implied by note paths; moving or renaming a folder moves its notes.
 * Notes and folders can be dragged onto a folder (or onto empty space for the top level), as in
 * Obsidian's file explorer; each row's "…" menu has the same actions for keyboard and touch.
 */
export function Tree(p: TreeProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const dragProps = (source: MoveSource) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ ...source, sid: p.spaceId }));
      e.dataTransfer?.setData('text/plain', source.kind === 'note' ? source.id : source.path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => setDropTarget(null),
  });

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== folder) setDropTarget(folder);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropTarget((t) => (t === folder ? null : t));
    },
    onDrop: (e: DragEvent) => {
      const raw = e.dataTransfer?.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      try {
        const { sid, ...source } = JSON.parse(raw) as MoveSource & { sid?: string };
        p.onMove(source as MoveSource, folder, sid ?? p.spaceId);
      } catch {
        // not ours
      }
    },
  });

  const renderFolder = (node: FolderNode, depth: number) => (
    <ul class="tree" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Notes' : undefined}>
      {p.creatingIn === node.path && (
        <li role="treeitem" class="tree-new">
          <div class="tree-row folder-row">
            <IconFolder />
            <CommitInput
              class="tree-rename"
              label="New folder name"
              value={p.newFolderName}
              autoFocus
              commitUnchanged
              onCommit={(name) => p.onCreateFolder(node.path, name)}
              onCancel={p.onCancelCreate}
            />
          </div>
        </li>
      )}
      {node.folders.map((f) => {
        const open = !p.collapsed.has(f.path);
        const folderItems: MenuItem[] = [
          { label: 'New note here', icon: <IconNotePlus />, onSelect: () => p.onNewInFolder(f.path) },
          { label: 'New folder here', icon: <IconFolderPlus />, onSelect: () => p.onNewFolder(f.path) },
          { label: 'Rename folder', icon: <IconEdit />, onSelect: () => setRenaming(f.path) },
          { label: 'Move folder to…', icon: <IconMove />, onSelect: () => p.onMoveDialog({ kind: 'folder', path: f.path }, f.name, f.path.split('/').slice(0, -1).join('/')) },
          ...(f.notes.length === 0 && f.folders.length === 0
            ? [{ label: 'Delete folder', icon: <IconTrash />, danger: true, onSelect: () => p.onDeleteFolder(f.path) }]
            : []),
        ];
        return (
          <li key={`f:${f.path}`} role="treeitem" aria-expanded={open} class={dropTarget === f.path ? 'drop-target' : undefined} {...dropProps(f.path)}>
            <div class="tree-row folder-row">
              {renaming === f.path ? (
                <CommitInput
                  class="tree-rename"
                  label={`Rename folder ${f.path}`}
                  value={f.name}
                  autoFocus
                  onCommit={(to) => {
                    setRenaming(null);
                    const parent = f.path.split('/').slice(0, -1).join('/');
                    p.onRenameFolder(f.path, parent ? `${parent}/${to}` : to);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <button type="button" class="tree-item tree-folder" onClick={() => p.onToggle(f.path)} title={f.path} {...dragProps({ kind: 'folder', path: f.path })}>
                  <span class="tree-caret" aria-hidden="true">
                    {open ? <IconChevronDown /> : <IconChevronRight />}
                  </span>
                  <IconFolder />
                  <span class="tree-name">{f.name}</span>
                </button>
              )}
              <MenuButton class="tree-more" label={`More actions for folder ${f.path}`} icon={<IconMore />} items={folderItems} />
            </div>
            {open && renderFolder(f, depth + 1)}
          </li>
        );
      })}
      {node.notes.map((n) => {
        const active = n.id === p.activeId;
        const noteItems: MenuItem[] = [
          { label: 'Rename', icon: <IconEdit />, onSelect: () => p.onRenameNote(n.id) },
          { label: 'Move to…', icon: <IconMove />, onSelect: () => p.onMoveDialog({ kind: 'note', id: n.id }, noteTitle(n.path), folderOf(n.path)) },
          { label: 'Delete', icon: <IconTrash />, danger: true, onSelect: () => p.onDeleteNote(n.id) },
        ];
        return <NoteRow key={n.id} note={n} active={active} conflicted={p.conflicted.has(n.id)} items={noteItems} drag={dragProps({ kind: 'note', id: n.id })} onOpen={p.onOpen} />;
      })}
    </ul>
  );

  const isEmpty = p.root.folders.length === 0 && p.root.notes.length === 0 && p.creatingIn === null;
  return (
    <div class={`tree-root${isEmpty ? ' tree-empty' : ''}${dropTarget === '' ? ' drop-target' : ''}`} {...dropProps('')}>
      {isEmpty ? <p class="empty">No notes yet.</p> : renderFolder(p.root, 0)}
    </div>
  );
}

/** One note in the tree: opens on click, or joins the selection (checkbox, Ctrl/Cmd/Shift click, touch long press). */
function NoteRow({ note: n, active, conflicted, items, drag, onOpen }: { note: PathItem; active: boolean; conflicted: boolean; items: MenuItem[]; drag: Record<string, unknown>; onOpen(id: string): void }) {
  const row = useNoteRow(n.id);
  return (
    <li role="treeitem" aria-selected={active} data-note-id={n.id} class={row.picked ? 'selected' : undefined}>
      <div class={`tree-row note-row${active ? ' active' : ''}`}>
        {row.checkbox}
        <a
          href={`#/notes/${encodeURIComponent(n.id)}`}
          class="tree-item tree-note"
          aria-current={active ? 'page' : undefined}
          title={n.path}
          {...row.handlers}
          onClick={(e) => {
            e.preventDefault();
            if (!row.consume(e)) onOpen(n.id);
          }}
          {...drag}
        >
          <IconNote />
          <span class="tree-name">{noteTitle(n.path)}</span>
          {conflicted && (
            <Pill tone="current" class="badge warn" title="Another note has the same path">
              conflict
            </Pill>
          )}
        </a>
        <MenuButton class="tree-more" label={`More actions for ${noteTitle(n.path)}`} icon={<IconMore />} items={items} />
      </div>
    </li>
  );
}
