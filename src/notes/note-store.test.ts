import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addFolder, buildIndex, createNote, deleteNote, liveFolders, moveFolderEntries, moveNote, moveNotes, newNoteText, noteText, notesMap, recentlyDeletedNotes, removeFolder, restoreNote, setNoteProperties } from './note-store';
import { parseNote } from './frontmatter';
import { moveFolder } from './paths';

describe('note store', () => {
  it('creates notes under fresh ids and indexes their front matter, links and tags', () => {
    const doc = new Y.Doc();
    const a = createNote(doc, 'Projects/Acme.md', '---\ntags: [client]\n---\nSee [[Beta]] #work\n');
    const b = createNote(doc, 'Beta.md', 'Back to [[Projects/Acme]]');
    expect(a).not.toBe(b);
    const index = buildIndex(doc);
    const acme = index.byId.get(a)!;
    expect(acme.title).toBe('Acme');
    expect(acme.tags).toEqual(['client', 'work']);
    expect(index.resolve('Beta', acme.path)?.id).toBe(b);
    expect(index.resolve('Acme')?.id).toBe(a);
  });

  it('renames and moves by changing the path only, and soft-deletes', () => {
    const doc = new Y.Doc();
    const a = createNote(doc, 'Projects/Acme.md', 'x');
    const b = createNote(doc, 'Projects/Sub/B.md', 'y');
    moveNote(doc, a, 'Clients/Acme.md');
    expect(notesMap(doc).get(a)?.get('path')).toBe('Clients/Acme.md');
    const items = buildIndex(doc).notes;
    moveNotes(doc, moveFolder(items, 'Projects', 'Archive'));
    expect(notesMap(doc).get(b)?.get('path')).toBe('Archive/Sub/B.md');
    expect([...notesMap(doc).keys()].sort()).toEqual([a, b].sort());
    deleteNote(doc, a);
    expect(notesMap(doc).get(a)?.get('deleted')).toBe(true);
    expect(buildIndex(doc).notes.map((n) => n.id)).toEqual([b]);
  });

  it('keeps both notes when two devices create the same path, and flags the conflict', () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    const n1 = createNote(d1, 'Inbox.md', 'from device 1');
    const n2 = createNote(d2, 'inbox.md', 'from device 2');
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2));
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    for (const d of [d1, d2]) {
      const index = buildIndex(d);
      expect(index.notes).toHaveLength(2);
      expect([...index.conflicted].sort()).toEqual([n1, n2].sort());
      expect(index.conflictsOf(n1)).toEqual([n2]);
    }
    expect(noteText(d1, n2)?.toString()).toBe('from device 2');
    moveNote(d1, n2, 'Inbox (device 2).md');
    expect(buildIndex(d1).conflicted.size).toBe(0);
  });

  it('sets properties and stamps updated_at in one transaction', () => {
    const doc = new Y.Doc();
    const id = createNote(doc, 'T.md', 'body');
    let updates = 0;
    doc.on('update', () => updates++);
    expect(setNoteProperties(doc, id, { status: 'open', tags: ['task'] })).toBe(true);
    expect(updates).toBe(1);
    expect(noteText(doc, id)?.toString()).toBe('---\nstatus: open\ntags:\n  - task\n---\nbody');
    const bad = createNote(doc, 'Bad.md', '---\na: [\n---\n');
    expect(setNoteProperties(doc, bad, { b: 1 })).toBe(false);
    expect(setNoteProperties(doc, 'missing', { b: 1 })).toBe(false);
  });
});

describe('folders kept without notes', () => {
  it('adds, lists and removes them, and the index carries them', () => {
    const doc = new Y.Doc();
    addFolder(doc, 'Ideas');
    addFolder(doc, 'Projects/Archive');
    expect(buildIndex(doc).folders).toEqual(['Ideas', 'Projects/Archive']);
    removeFolder(doc, 'ideas');
    expect(liveFolders(doc)).toEqual(['Projects/Archive']);
    addFolder(doc, 'Ideas');
    expect(liveFolders(doc)).toEqual(['Ideas', 'Projects/Archive']);
  });

  it('renames a folder, the folders under it, and leaves others alone', () => {
    const doc = new Y.Doc();
    addFolder(doc, 'Projects');
    addFolder(doc, 'Projects/Archive');
    addFolder(doc, 'Projectsx');
    moveFolderEntries(doc, 'Projects', 'Work/Clients');
    expect(liveFolders(doc)).toEqual(['Projectsx', 'Work/Clients', 'Work/Clients/Archive']);
  });

  it('merges concurrent creation of the same folder without losing it', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addFolder(a, 'Ideas');
    addFolder(b, 'Ideas');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(liveFolders(a)).toEqual(['Ideas']);
    expect(liveFolders(b)).toEqual(['Ideas']);
  });
});

describe('a new note', () => {
  it('starts with its creation time in the front matter, as TaskNotes writes it', () => {
    const now = new Date('2026-10-17T09:30:00.000Z');
    const text = newNoteText(now);
    expect(text).toBe('---\ndateCreated: 2026-10-17T09:30:00.000Z\n---\n');
    const parsed = parseNote(text);
    expect(parsed.error).toBeNull();
    expect(parsed.properties.dateCreated).toBe('2026-10-17T09:30:00.000Z');
    expect(parsed.properties.tags).toBeUndefined();
  });

  it('lets the first tag add the tags line and the last one remove it again', () => {
    const doc = new Y.Doc();
    const id = createNote(doc, 'N.md', newNoteText(new Date('2026-10-17T09:30:00.000Z')));
    expect(noteText(doc, id)?.toString()).not.toContain('tags');
    setNoteProperties(doc, id, { tags: ['client'] });
    expect(noteText(doc, id)?.toString()).toContain('tags:');
    setNoteProperties(doc, id, { tags: undefined });
    expect(noteText(doc, id)?.toString()).toBe('---\ndateCreated: 2026-10-17T09:30:00.000Z\n---\n');
  });
});


describe('recently deleted notes', () => {
  it('lists notes deleted within 45 days, newest first, and drops them once restored', () => {
    const doc = new Y.Doc();
    const a = createNote(doc, 'A.md', 'a');
    const b = createNote(doc, 'B.md', 'b');
    const c = createNote(doc, 'C.md', 'c');
    deleteNote(doc, a);
    deleteNote(doc, b);
    deleteNote(doc, c);
    const day = 86_400_000;
    for (const id of [a, b]) notesMap(doc).get(id)?.delete('deleted_at'); // deleted by an older build: `updated_at` is the date
    notesMap(doc).get(a)?.set('updated_at', new Date(Date.now() - 50 * day).toISOString());
    notesMap(doc).get(b)?.set('updated_at', new Date(Date.now() - 2 * day).toISOString());
    expect(recentlyDeletedNotes(doc).map((n) => n.path)).toEqual(['C.md', 'B.md']);
    restoreNote(doc, c);
    expect(recentlyDeletedNotes(doc).map((n) => n.path)).toEqual(['B.md']);
    expect(notesMap(doc).get(c)?.has('deleted_at')).toBe(false);
  });

  it('a delete is stamped with deleted_at', () => {
    const doc = new Y.Doc();
    const a = createNote(doc, 'A.md', 'a');
    deleteNote(doc, a);
    expect(typeof notesMap(doc).get(a)?.get('deleted_at')).toBe('string');
  });
});
