import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collection, createRecord } from '../core/schema';
import { emptyState } from './engine';
import { MemoryFs } from './memory-fs';
import { MirrorService, mirrorSpaces, type FolderInfo, type Persisted, type SpaceInput } from './service';

function addNote(doc: Y.Doc, path: string, text: string): void {
  const now = new Date().toISOString();
  createRecord(doc, 'notes', { path, text: new Y.Text(text), created_at: now, updated_at: now, deleted: false });
}

function noteTexts(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  collection(doc, 'notes').forEach((rec) => {
    if (rec.get('deleted') !== true) out[String(rec.get('path'))] = (rec.get('text') as Y.Text).toString();
  });
  return out;
}

function setup() {
  const fs = new MemoryFs();
  const spaces: SpaceInput[] = [
    { id: 'p', name: 'Personal', doc: new Y.Doc() },
    { id: 'w', name: 'Work', doc: new Y.Doc() },
  ];
  let persisted: Persisted = { excluded: [], state: emptyState(), conflicts: [] };
  let folder: FolderInfo & { fs?: MemoryFs } = { state: 'granted', name: 'Notes', id: 'f1', fs };
  const service = new MirrorService({
    spaces: () => spaces,
    folder: { current: async () => folder },
    store: { load: async () => structuredClone(persisted), save: async (p) => void (persisted = structuredClone(p)) },
  });
  return { fs, spaces, service, persisted: () => persisted, setFolder: (f: typeof folder) => void (folder = f) };
}

describe('mirror service', () => {
  it('writes notes out and brings outside edits back', async () => {
    const t = setup();
    addNote(t.spaces[0]!.doc, 'A.md', 'one');
    await t.service.run();
    expect(t.fs.text('Personal/A.md')).toBe('one');
    await t.fs.write('Personal/A.md', 'two');
    await t.service.run();
    expect(noteTexts(t.spaces[0]!.doc)).toEqual({ 'A.md': 'two' });
    expect(t.service.state.lastRunAt).toBeTruthy();
  });

  it('keeps how the last pass ended, ok or failed with the reason, and when (#95)', async () => {
    const t = setup();
    await t.service.run();
    expect(t.service.state.lastResult).toMatchObject({ ok: true });
    expect(t.persisted().lastResult?.ok).toBe(true);
    t.setFolder({ state: 'granted', name: 'Notes', id: 'f1', get fs(): MemoryFs {
      throw new Error('The folder is gone');
    } });
    await t.service.run();
    expect(t.service.state.lastResult).toMatchObject({ ok: false, error: 'The folder is gone' });
    expect(t.persisted().lastResult).toMatchObject({ ok: false, error: 'The folder is gone' });
  });

  it('keeps conflict copies until dismissed', async () => {
    const t = setup();
    const doc = t.spaces[0]!.doc;
    addNote(doc, 'A.md', 'one');
    await t.service.run();
    const ytext = [...collection(doc, 'notes').values()][0]!.get('text') as Y.Text;
    ytext.insert(3, ' app');
    await t.fs.write('Personal/A.md', 'one file');
    await t.service.run();
    expect(t.service.state.conflicts).toEqual(['Personal/A (conflict).md']);
    await t.service.refresh();
    expect(t.service.state.conflicts).toHaveLength(1);
    await t.service.dismissConflicts();
    expect(t.service.state.conflicts).toEqual([]);
  });

  it('leaves out excluded spaces', async () => {
    const t = setup();
    addNote(t.spaces[1]!.doc, 'W.md', 'w');
    await t.service.setExcluded('w', true);
    await t.service.whenIdle();
    await t.service.run();
    expect(t.fs.paths()).toEqual([]);
    await t.service.setExcluded('w', false);
    await t.service.run();
    expect(t.fs.paths()).toEqual(['Work/W.md']);
  });

  it('starts clean with a different folder and deletes nothing', async () => {
    const t = setup();
    addNote(t.spaces[0]!.doc, 'A.md', 'one');
    await t.service.run();
    const other = new MemoryFs();
    t.setFolder({ state: 'granted', name: 'Other', id: 'f2', fs: other });
    await t.service.run();
    // The note was not treated as deleted from the old folder's state; it is written to the new one.
    expect(other.text('Personal/A.md')).toBe('one');
    expect(noteTexts(t.spaces[0]!.doc)).toEqual({ 'A.md': 'one' });
  });

  it('does nothing without access to the folder', async () => {
    const t = setup();
    addNote(t.spaces[0]!.doc, 'A.md', 'one');
    t.setFolder({ state: 'prompt', name: 'Notes', id: 'f1' });
    await t.service.run();
    expect(t.fs.paths()).toEqual([]);
    expect(t.service.state.folder.state).toBe('prompt');
  });

  it('gives spaces with clashing names their own folders', () => {
    const spaces = mirrorSpaces(
      [
        { id: '1', name: 'Work/A', doc: new Y.Doc() },
        { id: '2', name: 'work-a', doc: new Y.Doc() },
      ],
      [],
    );
    expect(spaces.map((s) => s.folder)).toEqual(['Work-A', 'work-a 2']);
  });
});
