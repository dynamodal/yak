import * as Y from 'yjs';
import { BULK_EDIT } from '../core/bulk';
import { collection, createRecord, nowIso, updateRecord } from '../core/schema';
import { restoreRecord, trashItems, trashRecord, TRASH_DAYS } from '../core/trash';
import { minimalEdit, parseNote, propertyEdit, type ParsedNote, type FrontMatterValue, type TextEdit } from './frontmatter';
import { extractInlineTags, extractLinks, frontMatterTags, makeResolver, uniqueTags, type Resolver, type WikiLink } from './links';
import { rewriteTag } from './tag-rewrite';
import { noteTitle, pathConflicts, pathKey, type PathItem } from './paths';

/**
 * Reading and writing notes in a space document. A note is a record in the `notes` map: `path`,
 * `text` (a Y.Text with the whole Markdown file), `created_at`, `updated_at`, `deleted`.
 */

export interface NoteInfo extends PathItem {
  title: string;
  text: string;
  parsed: ParsedNote;
  links: WikiLink[];
  /** Front matter and inline tags, without `#`. */
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface NoteIndex {
  notes: NoteInfo[];
  /** Folders kept on purpose, which exist even with no note in them (see `addFolder`). */
  folders: string[];
  byId: Map<string, NoteInfo>;
  resolve: Resolver;
  /** Ids of notes whose path another live note also uses. */
  conflicted: Set<string>;
  /** Ids sharing each conflicted note's path, by note id. */
  conflictsOf(id: string): string[];
}

export function notesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return collection(doc, 'notes');
}

/**
 * Folders that exist on their own, with no note in them. A folder with notes needs no entry: it
 * exists as a prefix of their paths. Keys are folder paths, values plain booleans (`false` = deleted),
 * so two devices setting the same key never lose a record.
 */
export function foldersMap(doc: Y.Doc): Y.Map<boolean> {
  return doc.getMap<boolean>('folders');
}

/** Folder entries that are live. */
export function liveFolders(doc: Y.Doc): string[] {
  const out: string[] = [];
  foldersMap(doc).forEach((live, path) => {
    if (live === true) out.push(path);
  });
  return out.sort();
}

export function addFolder(doc: Y.Doc, path: string): void {
  foldersMap(doc).set(path, true);
}

export function removeFolder(doc: Y.Doc, path: string): void {
  const map = foldersMap(doc);
  doc.transact(() => {
    for (const key of [...map.keys()]) if (key.toLowerCase() === path.toLowerCase()) map.set(key, false);
  });
}

/** A folder was renamed or moved: its entry and those of folders under it follow. One transaction. */
export function moveFolderEntries(doc: Y.Doc, from: string, to: string): void {
  const map = foldersMap(doc);
  const lower = from.toLowerCase();
  doc.transact(() => {
    for (const [key, live] of [...map.entries()]) {
      if (live !== true) continue;
      const k = key.toLowerCase();
      if (k !== lower && !k.startsWith(`${lower}/`)) continue;
      map.set(key, false);
      map.set(to + key.slice(from.length), true);
    }
  });
}

export function noteText(doc: Y.Doc, id: string): Y.Text | null {
  const t = notesMap(doc).get(id)?.get('text');
  return t instanceof Y.Text ? t : null;
}

/** Parse results are cached per Y.Text and reused while the text is unchanged. */
const cache = new WeakMap<Y.Text, { text: string; parsed: ParsedNote; links: WikiLink[]; tags: string[] }>();

function analyse(ytext: Y.Text): { text: string; parsed: ParsedNote; links: WikiLink[]; tags: string[] } {
  const text = ytext.toString();
  const hit = cache.get(ytext);
  if (hit && hit.text === text) return hit;
  const parsed = parseNote(text);
  const links = extractLinks(text);
  const tags = uniqueTags([...frontMatterTags(parsed.properties.tags), ...extractInlineTags(parsed.body)]);
  const entry = { text, parsed, links, tags };
  cache.set(ytext, entry);
  return entry;
}

/** Every live note with its parsed front matter, links and tags. */
export function buildIndex(doc: Y.Doc): NoteIndex {
  const notes: NoteInfo[] = [];
  notesMap(doc).forEach((rec, id) => {
    if (rec.get('deleted') === true) return;
    const ytext = rec.get('text');
    const path = String(rec.get('path') ?? '');
    const a = ytext instanceof Y.Text ? analyse(ytext) : { text: '', parsed: parseNote(''), links: [], tags: [] };
    notes.push({
      id,
      path,
      title: noteTitle(path),
      ...a,
      created_at: String(rec.get('created_at') ?? ''),
      updated_at: String(rec.get('updated_at') ?? ''),
    });
  });
  const byId = new Map(notes.map((n) => [n.id, n]));
  const groups = pathConflicts(notes);
  const conflicted = new Set([...groups.values()].flat());
  return {
    notes,
    folders: liveFolders(doc),
    byId,
    resolve: makeResolver(notes),
    conflicted,
    conflictsOf: (id) => {
      const n = byId.get(id);
      return n ? (groups.get(pathKey(n.path)) ?? []).filter((x) => x !== id) : [];
    },
  };
}

/** The text of a new note: front matter with its creation time, as TaskNotes writes `dateCreated`. */
export function newNoteText(now: Date = new Date()): string {
  return `---\ndateCreated: ${now.toISOString()}\n---\n`;
}

/** Create a note under a fresh UUID. Returns its id. */
export function createNote(doc: Y.Doc, path: string, text = ''): string {
  const now = nowIso();
  return createRecord(doc, 'notes', { path, text: new Y.Text(text), created_at: now, updated_at: now, deleted: false });
}

/** Rename or move a note: only its `path` changes, the record keeps its id. */
export function moveNote(doc: Y.Doc, id: string, path: string): boolean {
  return updateRecord(doc, 'notes', id, { path });
}

/** Move several notes in one transaction (a folder rename). */
export function moveNotes(doc: Y.Doc, moves: readonly { id: string; path: string }[]): void {
  doc.transact(() => {
    for (const m of moves) updateRecord(doc, 'notes', m.id, { path: m.path });
  });
}

/** Soft delete, stamped for Recently deleted (B-107). */
export function deleteNote(doc: Y.Doc, id: string): boolean {
  return trashRecord(doc, 'notes', id);
}

/** A deleted note can be brought back for this long, like a time entry (owner, 2026-10-17). */
export const NOTE_RESTORE_DAYS = TRASH_DAYS;

export interface DeletedNote {
  id: string;
  path: string;
  /** When it was deleted: `deleted_at`, or the record's last update when later or the only date. */
  at: number;
}

/** Notes deleted within the restore window, newest first. Deleted for good ones are gone. */
export function recentlyDeletedNotes(doc: Y.Doc, now: number = Date.now()): DeletedNote[] {
  return trashItems(doc, 'notes', now).map((t) => ({ id: t.id, path: t.title, at: t.deletedAt ?? 0 }));
}

/** Undo a delete (the toast's Undo, the Recently deleted lists). Refused once deleted for good. */
export function restoreNote(doc: Y.Doc, id: string): boolean {
  return restoreRecord(doc, 'notes', id).ok;
}

export function touchNote(doc: Y.Doc, id: string): void {
  updateRecord(doc, 'notes', id, {});
}

/** Apply one splice to a Y.Text. Call inside a transaction. */
export function applyTextEdit(ytext: Y.Text, edit: TextEdit): void {
  if (edit.remove > 0) ytext.delete(edit.index, edit.remove);
  if (edit.insert) ytext.insert(edit.index, edit.insert);
}

/**
 * Set (or remove with `undefined`) front matter properties of a note, rewriting only the lines of
 * those properties so concurrent edits elsewhere in the text merge. One transaction. Returns false
 * when the note is missing or its front matter is not valid YAML.
 */
export function setNoteProperties(doc: Y.Doc, id: string, changes: Record<string, FrontMatterValue | undefined>): boolean {
  const ytext = noteText(doc, id);
  if (!ytext) return false;
  let ok = true;
  doc.transact(() => {
    for (const [key, value] of Object.entries(changes)) {
      const edit = propertyEdit(ytext.toString(), key, value);
      if (!edit) {
        ok = false;
        return;
      }
      applyTextEdit(ytext, edit);
    }
    const rec = notesMap(doc).get(id);
    rec?.set('updated_at', nowIso());
  });
  return ok;
}

export function setNoteProperty(doc: Y.Doc, id: string, key: string, value: FrontMatterValue | undefined): boolean {
  return setNoteProperties(doc, id, { [key]: value });
}

/**
 * Rename `from` to `to` (or remove it when `to` is null) in every live note of the doc: front matter
 * and inline tags. One transaction with the bulk-edit origin. Returns how many notes changed.
 */
export function rewriteNoteTags(doc: Y.Doc, from: string, to: string | null): number {
  let n = 0;
  doc.transact(() => {
    notesMap(doc).forEach((rec) => {
      if (rec.get('deleted') === true) return;
      const ytext = rec.get('text');
      if (!(ytext instanceof Y.Text)) return;
      const old = ytext.toString();
      const next = rewriteTag(old, from, to);
      if (next === old) return;
      applyTextEdit(ytext, minimalEdit(old, next));
      rec.set('updated_at', nowIso());
      n++;
    });
  }, BULK_EDIT);
  return n;
}
