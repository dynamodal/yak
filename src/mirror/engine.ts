import * as Y from 'yjs';
import { portableSegment } from '../core/file-names';
import { minimalEdit } from '../core/history/travel';
import { collection, createRecord, nowIso, updateRecord } from '../core/schema';
import type { BlobStore } from '../core/blobs/store';
import type { MirrorFs } from './fs';
import { ATTACHMENTS, syncFiles, type FileEntry } from './files';

/**
 * Two-way mirror between the notes of spaces and a folder of Markdown files (docs/architecture.md,
 * "Mirror"). One folder per space; a note's text is the file's content, so tasks keep their
 * TaskNotes front matter. Core only: no UI, no adapters.
 *
 * `syncMirror` is one pass: it compares notes and files with what the previous pass left
 * (`MirrorState`) and brings the two sides together. Call it again after any change on either side.
 */

/** Transaction origin of changes the mirror makes to notes. */
export const MIRROR_ORIGIN = 'mirror';

export interface MirrorSpace {
  id: string;
  /** Folder name in the file system; unique per space and safe as a file name. */
  folder: string;
  doc: Y.Doc;
  /** The space's file store. Without it the space's `attachments/` folder is left alone. */
  blobs?: BlobStore;
}

/** What the last pass left for one note. Plain JSON: the caller stores it. */
interface MirrorEntry {
  /** Path inside the space folder. */
  path: string;
  /** The text both sides had. */
  text: string;
  stamp: string;
}

export interface MirrorState {
  /** By space id, then note id. */
  spaces: Record<string, Record<string, MirrorEntry>>;
  /** Files (#166), by space id, then lower-case path inside the space folder. Absent in state saved before files. */
  files?: Record<string, Record<string, FileEntry>>;
}

export interface MirrorReport {
  /** Conflict copies made: both sides changed the same note. */
  conflicts: string[];
  /** Files or notes left alone this pass, with why. They are tried again next pass. */
  errors: string[];
}

export function emptyState(): MirrorState {
  return { spaces: {} };
}

/** A folder name for a space name: safe on common file systems. */
export function folderName(spaceName: string): string {
  return spaceName.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Space';
}

const key = (path: string): string => path.toLowerCase();

/** A path ending in `.md` with no empty, hidden or non-portable segments (backslash, control character, reserved Windows name). */
function mirrorable(path: string): boolean {
  if (!/\.md$/i.test(path)) return false;
  // `attachments/` holds files, whatever their type.
  if (path.split('/')[0]!.toLowerCase() === ATTACHMENTS && path.includes('/')) return false;
  return path.split('/').every((s) => portableSegment(s) && !s.startsWith('.'));
}

/** `path` or `path (suffix).md`, then ` 2`, ` 3`… until `taken` (lower-case keys) lacks it. */
function freePath(path: string, taken: Set<string>, suffix = ''): string {
  const base = path.replace(/\.md$/i, '') + (suffix ? ` (${suffix})` : '');
  let candidate = `${base}.md`;
  for (let i = 2; taken.has(key(candidate)); i++) candidate = `${base} ${i}.md`;
  return candidate;
}

interface LiveNote {
  path: string;
  text: string;
  ytext: Y.Text;
}

function liveNotes(doc: Y.Doc): Map<string, LiveNote> {
  const out = new Map<string, LiveNote>();
  collection(doc, 'notes').forEach((rec, id) => {
    const ytext = rec.get('text');
    if (rec.get('deleted') === true || !(ytext instanceof Y.Text)) return;
    out.set(id, { path: String(rec.get('path') ?? ''), text: ytext.toString(), ytext });
  });
  return out;
}

/** Replace a note's text with the smallest edit, so concurrent edits elsewhere still merge. */
function setText(doc: Y.Doc, id: string, ytext: Y.Text, text: string): void {
  const edit = minimalEdit(ytext.toString(), text);
  doc.transact(() => {
    if (edit.remove > 0) ytext.delete(edit.index, edit.remove);
    if (edit.insert) ytext.insert(edit.index, edit.insert);
    updateRecord(doc, 'notes', id, {});
  }, MIRROR_ORIGIN);
}

function newNote(doc: Y.Doc, path: string, text: string): string {
  const now = nowIso();
  let id = '';
  doc.transact(() => {
    id = createRecord(doc, 'notes', { path, text: new Y.Text(text), created_at: now, updated_at: now, deleted: false });
  }, MIRROR_ORIGIN);
  return id;
}

function setNoteField(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => updateRecord(doc, 'notes', id, fields), MIRROR_ORIGIN);
}

/** One pass over every space. Mutates `state`; returns what needs the user's eye. */
export async function syncMirror(fs: MirrorFs, spaces: readonly MirrorSpace[], state: MirrorState): Promise<MirrorReport> {
  const report: MirrorReport = { conflicts: [], errors: [] };
  const all = await fs.list();
  for (const space of spaces) {
    const prefix = `${space.folder}/`;
    const files = new Map<string, string>();
    for (const f of all) {
      if (f.path.startsWith(prefix) && mirrorable(f.path.slice(prefix.length))) files.set(f.path.slice(prefix.length), f.stamp);
    }
    await syncSpace(fs, space, files, (state.spaces[space.id] ??= {}), report);
    await syncFiles(fs, space, all, ((state.files ??= {})[space.id] ??= {}), report);
  }
  return report;
}

async function syncSpace(
  fs: MirrorFs,
  space: MirrorSpace,
  files: Map<string, string>,
  entries: Record<string, MirrorEntry>,
  report: MirrorReport,
): Promise<void> {
  const doc = space.doc;
  const abs = (path: string): string => `${space.folder}/${path}`;
  const notes = liveNotes(doc);
  /** Lower-case paths in use on the file side, kept up to date as this pass writes. */
  const taken = new Set([...files.keys()].map(key));
  const claim = (path: string): void => void taken.add(key(path));
  const release = (path: string): void => void taken.delete(key(path));

  const write = async (id: string, path: string, text: string): Promise<void> => {
    entries[id] = { path, text, stamp: await fs.write(abs(path), text) };
    files.set(path, entries[id]!.stamp);
    claim(path);
  };
  const remove = async (path: string): Promise<void> => {
    await fs.delete(abs(path));
    files.delete(path);
    release(path);
  };
  const rename = async (from: string, to: string): Promise<void> => {
    await fs.rename(abs(from), abs(to));
    const stamp = files.get(from) ?? '';
    files.delete(from);
    release(from);
    files.set(to, stamp);
    claim(to);
  };
  /** Keep the other side's version as a new note and file; returns nothing, never overwrites. */
  const conflictCopy = async (path: string, text: string): Promise<void> => {
    const copy = freePath(path, taken, 'conflict');
    claim(copy);
    const id = newNote(doc, copy, text);
    await write(id, copy, text);
    report.conflicts.push(abs(copy));
  };

  // Files that moved: gone from a tracked path, and an untracked file elsewhere has the same text.
  const untracked = (): string[] => [...files.keys()].filter((p) => ![...Object.values(entries)].some((e) => e.path === p));
  const movedTo = new Map<string, string>();
  const vanished = Object.entries(entries).filter(([, e]) => !files.has(e.path));
  const candidates = new Map<string, string>();
  for (const p of untracked()) {
    try {
      candidates.set(p, await fs.read(abs(p)));
    } catch (e) {
      report.errors.push(`${abs(p)}: ${(e as Error).message}`);
    }
  }
  for (const [id, e] of vanished) {
    const matches = [...candidates].filter(([, text]) => text === e.text).map(([p]) => p);
    const same = vanished.filter(([, o]) => o.text === e.text);
    // Only an unambiguous match counts as a move; otherwise it is a delete plus a create.
    if (matches.length === 1 && same.length === 1) {
      movedTo.set(id, matches[0]!);
      candidates.delete(matches[0]!);
    }
  }

  // Tracked notes.
  for (const [id, entry] of Object.entries(entries)) {
    try {
      const note = notes.get(id);
      let filePath = movedTo.get(id) ?? entry.path;
      const fileMoved = filePath !== entry.path;
      const fileThere = files.has(filePath);

      if (!note) {
        // Note deleted (or never synced here): the file follows unless it was edited.
        if (!fileThere) {
          delete entries[id];
          continue;
        }
        const text = await fs.read(abs(filePath));
        if (text === entry.text) await remove(filePath);
        else candidates.set(filePath, text); // edited outside: it lives on as a new note
        delete entries[id];
        continue;
      }

      if (!fileThere) {
        // File deleted outside: the note follows unless it was edited.
        if (note.text === entry.text) {
          doc.transact(() => updateRecord(doc, 'notes', id, { deleted: true, deleted_at: new Date().toISOString() }), MIRROR_ORIGIN);
          delete entries[id];
          continue;
        }
        await write(id, note.path, note.text);
        continue;
      }

      // Paths.
      const noteMoved = note.path !== entry.path;
      if (fileMoved && !noteMoved) {
        setNoteField(doc, id, { path: filePath });
        note.path = filePath;
      } else if (noteMoved && key(note.path) !== key(filePath)) {
        let target = note.path;
        if (!mirrorable(target)) {
          report.errors.push(`${abs(target)}: not a usable file path`);
          continue;
        }
        if (taken.has(key(target)) && key(target) !== key(filePath)) {
          target = freePath(target, taken);
          setNoteField(doc, id, { path: target });
        }
        await rename(filePath, target);
        filePath = target;
        note.path = target;
      } else if (noteMoved) {
        // Same file, different case only: the note takes the file's spelling.
        setNoteField(doc, id, { path: filePath });
        note.path = filePath;
      }

      // Content.
      const noteChanged = note.text !== entry.text;
      let fileText = entry.text;
      const stamp = files.get(filePath) ?? '';
      const fileMaybe = fileMoved || stamp !== entry.stamp;
      if (fileMaybe) fileText = await fs.read(abs(filePath));
      const fileChanged = fileText !== entry.text;

      if (fileChanged && noteChanged && fileText !== note.text) {
        await conflictCopy(filePath, fileText);
        await write(id, filePath, note.text);
      } else if (fileChanged && !noteChanged) {
        setText(doc, id, note.ytext, fileText);
        entries[id] = { path: filePath, text: fileText, stamp };
      } else if (noteChanged && !fileChanged) {
        await write(id, filePath, note.text);
      } else {
        entries[id] = { path: filePath, text: note.text, stamp };
      }
    } catch (e) {
      report.errors.push(`${abs(entry.path)}: ${(e as Error).message}`);
    }
  }

  // New notes: written out. A file already at that path means two creations; the file wins the
  // path (it is imported below) and the note is written beside it.
  const tracked = new Set(Object.keys(entries));
  for (const [id, note] of liveNotes(doc)) {
    if (tracked.has(id)) continue;
    try {
      if (!mirrorable(note.path)) {
        report.errors.push(`${abs(note.path)}: not a usable file path`);
        continue;
      }
      let path = note.path;
      if (taken.has(key(path))) {
        let existing: string | undefined = candidates.get(path);
        if (existing === undefined && files.has(path)) existing = await fs.read(abs(path));
        if (existing === note.text) {
          entries[id] = { path, text: note.text, stamp: files.get(path) ?? '' };
          candidates.delete(path);
          continue;
        }
        path = freePath(path, taken);
        setNoteField(doc, id, { path });
      }
      await write(id, path, note.text);
    } catch (e) {
      report.errors.push(`${abs(note.path)}: ${(e as Error).message}`);
    }
  }

  // New files: imported as notes.
  for (const [path, text] of candidates) {
    if (Object.values(entries).some((e) => e.path === path)) continue;
    const id = newNote(doc, path, text);
    entries[id] = { path, text, stamp: files.get(path) ?? '' };
  }
}
