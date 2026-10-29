import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { attachmentsMap, listAttachments } from '../core/blobs/attachments';
import { buildIndex, createNote, addFolder, liveFolders, noteText } from './note-store';
import { moveToSpace, parseSpaceTarget, planSpacePaths } from './space-move';

function space(files: Record<string, string>) {
  const doc = new Y.Doc();
  const ids: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) ids[path] = createNote(doc, path, text);
  const text = (path: string): string => {
    const n = buildIndex(doc).notes.find((x) => x.path === path);
    return n ? (noteText(doc, n.id)?.toString() ?? '') : '<missing>';
  };
  return { doc, ids, text, paths: () => buildIndex(doc).notes.map((n) => n.path).sort() };
}

const names = { src: 'Work', dst: 'Home' };
const run = (s: ReturnType<typeof space>, d: ReturnType<typeof space>, ids: string[], mode: 'auto' | 'ask' | 'off' = 'auto') =>
  moveToSpace(s.doc, d.doc, names, ids.map((p) => ({ id: s.ids[p]!, path: p })), null, mode);

describe('parseSpaceTarget', () => {
  it('splits a known space name, longest first, ignoring case', () => {
    expect(parseSpaceTarget('work:Acme', ['Work'])).toEqual({ space: 'Work', rest: 'Acme' });
    expect(parseSpaceTarget('My Work:A/B', ['Work', 'My Work'])).toEqual({ space: 'My Work', rest: 'A/B' });
    expect(parseSpaceTarget('Acme', ['Work'])).toEqual({ space: null, rest: 'Acme' });
  });
});

describe('moveToSpace', () => {
  it('copies the note, soft-deletes the original and leaves no stub', () => {
    const w = space({ 'Acme.md': 'hello' });
    const h = space({});
    run(w, h, ['Acme.md']);
    expect(w.paths()).toEqual([]);
    expect(h.paths()).toEqual(['Acme.md']);
    expect(h.text('Acme.md')).toBe('hello');
  });

  it('makes links in the old space name the new one', () => {
    const w = space({ 'Acme.md': 'x', 'Index.md': 'See [[Acme#Plan|plan]] and ![[Acme]]; [[Other]]', 'Other.md': 'y' });
    const h = space({});
    run(w, h, ['Acme.md']);
    expect(w.text('Index.md')).toBe('See [[Home:Acme#Plan|plan]] and ![[Home:Acme]]; [[Other]]');
  });

  it('makes links inside the note name the old space, but not links to notes moving with it', () => {
    const w = space({ 'Acme.md': 'to [[Other]] and [[Beta]]', 'Beta.md': 'b', 'Other.md': 'o' });
    const h = space({});
    run(w, h, ['Acme.md', 'Beta.md']);
    expect(h.text('Acme.md')).toBe('to [[Work:Other]] and [[Beta]]');
  });

  it('turns links in the new space that named the old one into plain links', () => {
    const w = space({ 'Acme.md': 'x' });
    const h = space({ 'Home.md': 'back to [[Work:Acme]] and [[Work:Gone]]' });
    run(w, h, ['Acme.md']);
    expect(h.text('Home.md')).toBe('back to [[Acme]] and [[Work:Gone]]');
  });

  it('keeps full-path spelling and the destination folder', () => {
    const w = space({ 'Projects/Acme.md': 'x', 'Index.md': '[[Projects/Acme]]' });
    const h = space({});
    moveToSpace(w.doc, h.doc, names, [{ id: w.ids['Projects/Acme.md']!, path: 'Clients/Acme.md' }], null, 'auto');
    expect(w.text('Index.md')).toBe('[[Home:Clients/Acme]]');
  });

  it('ask mode copies the note but leaves links to be fixed later; off plans nothing', () => {
    const w = space({ 'Acme.md': 'x', 'Index.md': '[[Acme]]' });
    const h = space({});
    const r = run(w, h, ['Acme.md'], 'ask');
    expect(w.text('Index.md')).toBe('[[Acme]]');
    expect(r.edits).toHaveLength(1);
    const w2 = space({ 'Acme.md': 'x', 'Index.md': '[[Acme]]' });
    expect(run(w2, space({}), ['Acme.md'], 'off').edits).toEqual([]);
  });

  it('undo moves everything back with the original links', () => {
    const w = space({ 'Acme.md': 'to [[Other]]', 'Index.md': 'See [[Acme]]', 'Other.md': 'o' });
    const h = space({});
    const r = run(w, h, ['Acme.md']);
    r.undo();
    expect(h.paths()).toEqual([]);
    expect(w.paths()).toEqual(['Acme.md', 'Index.md', 'Other.md']);
    expect(w.text('Index.md')).toBe('See [[Acme]]');
    expect(w.text('Acme.md')).toBe('to [[Other]]');
  });

  it('moves a folder with its notes and empty folders', () => {
    const w = space({ 'P/A.md': 'x', 'P/B.md': '[[A]]', 'Index.md': '[[P/A]]' });
    addFolder(w.doc, 'P/Empty');
    const h = space({ 'Top/Keep.md': 'k' });
    const nw = buildIndex(w.doc).notes;
    const plan = planSpacePaths(nw, buildIndex(h.doc).notes, { kind: 'folder', path: 'P' }, 'Top');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    moveToSpace(w.doc, h.doc, names, plan.moves, plan.folder, 'auto');
    expect(h.paths()).toEqual(['Top/Keep.md', 'Top/P/A.md', 'Top/P/B.md']);
    expect(h.text('Top/P/B.md')).toBe('[[A]]');
    expect(w.text('Index.md')).toBe('[[Home:Top/P/A]]');
    expect(liveFolders(h.doc)).toContain('Top/P/Empty');
    expect(liveFolders(w.doc)).not.toContain('P/Empty');
  });
});

describe('planSpacePaths', () => {
  it('refuses a path already used in the other space', () => {
    const w = space({ 'Acme.md': 'x' });
    const h = space({ 'Acme.md': 'y' });
    const plan = planSpacePaths(buildIndex(w.doc).notes, buildIndex(h.doc).notes, { kind: 'note', id: w.ids['Acme.md']! }, '');
    expect(plan.ok).toBe(false);
  });
});

describe('moveToSpace with files (#272)', () => {
  const file = (doc: Y.Doc, hash: string, name: string): void => {
    const m = new Y.Map<unknown>();
    m.set('name', name);
    m.set('size', 3);
    m.set('type', 'image/png');
    m.set('created_at', '2026-01-01T00:00:00.000Z');
    m.set('deleted', false);
    attachmentsMap(doc).set(hash, m);
  };

  it('copies the files the note names, keeps the source copy and reports the hashes', () => {
    const w = space({ 'Acme.md': 'pic ![[cat.png|200]] and [[doc.pdf]]', 'Other.md': '![[dog.png]]' });
    file(w.doc, 'a', 'cat.png');
    file(w.doc, 'b', 'doc.pdf');
    file(w.doc, 'c', 'dog.png');
    const h = space({});
    const r = run(w, h, ['Acme.md']);
    expect(r.files.sort()).toEqual(['a', 'b']);
    expect(listAttachments(h.doc).map((x) => x.name).sort()).toEqual(['cat.png', 'doc.pdf']);
    expect(listAttachments(w.doc)).toHaveLength(3);
    expect(h.text('Acme.md')).toBe('pic ![[cat.png|200]] and [[doc.pdf]]');
  });

  it('renames on a clash and rewrites the link, keeping size and alias', () => {
    const w = space({ 'Acme.md': '![[cat.png#x|300]] ![[cat.png]]' });
    file(w.doc, 'a', 'cat.png');
    const h = space({});
    file(h.doc, 'b', 'cat.png');
    run(w, h, ['Acme.md']);
    expect(h.text('Acme.md')).toBe('![[cat 2.png#x|300]] ![[cat 2.png]]');
    expect(listAttachments(h.doc).map((x) => x.name).sort()).toEqual(['cat 2.png', 'cat.png']);
  });

  it('copies files named by Markdown links and images (#11)', () => {
    const w = space({ 'Acme.md': '![pic](attachments/cat%20photo.png) and [the doc](<docs/doc.pdf> "t") and [web](https://x.test/a)' });
    file(w.doc, 'a', 'cat photo.png');
    file(w.doc, 'b', 'doc.pdf');
    const h = space({});
    const r = run(w, h, ['Acme.md']);
    expect(r.files.sort()).toEqual(['a', 'b']);
    expect(listAttachments(h.doc).map((x) => x.name).sort()).toEqual(['cat photo.png', 'doc.pdf']);
    expect(h.text('Acme.md')).toBe('![pic](attachments/cat%20photo.png) and [the doc](<docs/doc.pdf> "t") and [web](https://x.test/a)');
  });

  it('rewrites a Markdown target when the file is renamed in the target space', () => {
    const w = space({ 'Acme.md': '![[cat.png]] ![x](a/cat.png) [y](cat.png#top)' });
    file(w.doc, 'a', 'cat.png');
    const h = space({});
    file(h.doc, 'b', 'cat.png');
    run(w, h, ['Acme.md']);
    expect(h.text('Acme.md')).toBe('![[cat 2.png]] ![x](cat%202.png) [y](cat%202.png)');
  });

  it('ignores names the source has no file for', () => {
    const w = space({ 'Acme.md': '![[ghost.png]]' });
    const h = space({});
    expect(run(w, h, ['Acme.md']).files).toEqual([]);
    expect(h.text('Acme.md')).toBe('![[ghost.png]]');
  });
});
