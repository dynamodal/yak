import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addAttachment, attachmentsMap, listAttachments } from '../core/blobs/attachments';
import { MemoryBlobStore } from '../core/blobs/store';
import { emptyState, syncMirror, type MirrorSpace, type MirrorState } from './engine';
import { MemoryFs } from './memory-fs';

const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);
const file = (name: string, data: Uint8Array): File => new File([data.slice().buffer], name);

function setup() {
  const fs = new MemoryFs();
  const blobs = new MemoryBlobStore();
  const space: MirrorSpace = { id: 's1', folder: 'Personal', doc: new Y.Doc(), blobs };
  const state: MirrorState = emptyState();
  const sync = () => syncMirror(fs, [space], state);
  const names = (): string[] => listAttachments(space.doc).map((a) => a.name).sort();
  return { fs, blobs, space, state, sync, names };
}

describe('mirror files', () => {
  it('a file added in the folder enters the store and the index', async () => {
    const t = setup();
    t.fs.putBytes('Personal/attachments/doc.pdf', bytes(1, 2, 3));
    const r = await t.sync();
    expect(r.errors).toEqual([]);
    expect(t.names()).toEqual(['doc.pdf']);
    const a = listAttachments(t.space.doc)[0]!;
    expect(a.type).toBe('application/octet-stream');
    expect(new Uint8Array(await (await t.blobs.get(a.hash))!.blob.arrayBuffer())).toEqual(bytes(1, 2, 3));
    await t.sync();
    expect(t.names()).toEqual(['doc.pdf']);
  });

  it('a file added in the app is written to the folder', async () => {
    const t = setup();
    await addAttachment(t.space.doc, t.blobs, file('a.bin', bytes(9, 9)));
    await t.sync();
    expect(t.fs.bytes('Personal/attachments/a.bin')).toEqual(bytes(9, 9));
  });

  it('a file deleted in the folder is deleted in the index; the store keeps the bytes for Recently deleted', async () => {
    const t = setup();
    t.fs.putBytes('Personal/attachments/x.bin', bytes(1));
    await t.sync();
    const hash = listAttachments(t.space.doc)[0]!.hash;
    await t.fs.delete('Personal/attachments/x.bin');
    await t.sync();
    expect(t.names()).toEqual([]);
    expect(await t.blobs.get(hash)).toBeDefined();
    expect(typeof attachmentsMap(t.space.doc).get(hash)!.get('deleted_at')).toBe('string');
    await t.sync();
    expect(t.fs.paths()).toEqual([]);
  });

  it('an index entry deleted in the app deletes the file', async () => {
    const t = setup();
    t.fs.putBytes('Personal/attachments/x.bin', bytes(1));
    await t.sync();
    const hash = listAttachments(t.space.doc)[0]!.hash;
    attachmentsMap(t.space.doc).get(hash)!.set('deleted', true);
    await t.sync();
    expect(t.fs.paths()).toEqual([]);
    expect(await t.blobs.get(hash)).toBeDefined(); // the file sweep drops it later (B-107)
    expect(t.names()).toEqual([]);
  });

  it('a name clash gets a 2 suffix, on disk too', async () => {
    const t = setup();
    await addAttachment(t.space.doc, t.blobs, file('a.bin', bytes(1)));
    await t.sync();
    t.fs.putBytes('Personal/attachments/a.bin', bytes(2)); // replaced outside: new content under the name
    await t.sync();
    expect(t.names()).toEqual(['a.bin']);
    expect(t.fs.bytes('Personal/attachments/a.bin')).toEqual(bytes(2));
    // A second, different file added in the app under the same name:
    await addAttachment(t.space.doc, t.blobs, file('a.bin', bytes(3)));
    await t.sync();
    expect(t.names()).toEqual(['a 2.bin', 'a.bin']);
    expect(t.fs.paths()).toEqual(['Personal/attachments/a 2.bin', 'Personal/attachments/a.bin']);
  });

  it('a folder file whose name is taken in the index is renamed on disk', async () => {
    const t = setup();
    await addAttachment(t.space.doc, t.blobs, file('a.bin', bytes(1)));
    // Not synced to the folder yet; someone drops a different a.bin there.
    t.fs.putBytes('Personal/attachments/a.bin', bytes(2));
    await t.sync();
    expect(t.names()).toEqual(['a 2.bin', 'a.bin']);
    expect(t.fs.paths()).toEqual(['Personal/attachments/a 2.bin', 'Personal/attachments/a.bin']);
  });

  it('refuses a file over the cap and leaves it alone', async () => {
    const t = setup();
    t.fs.putBytes('Personal/attachments/big.bin', new Uint8Array(10 * 1024 * 1024 + 1));
    const r = await t.sync();
    expect(r.errors.join()).toContain('limit');
    expect(t.names()).toEqual([]);
    expect(t.fs.paths()).toEqual(['Personal/attachments/big.bin']);
  });

  it('Markdown inside attachments/ is a file, not a note', async () => {
    const t = setup();
    t.fs.putBytes('Personal/attachments/readme.md', bytes(104, 105));
    await t.sync();
    expect(t.names()).toEqual(['readme.md']);
  });

  it('files from sync with no bytes yet are written when the bytes arrive', async () => {
    const t = setup();
    const other = setup();
    await addAttachment(other.space.doc, other.blobs, file('p.bin', bytes(5)));
    Y.applyUpdate(t.space.doc, Y.encodeStateAsUpdate(other.space.doc));
    await t.sync();
    expect(t.fs.paths()).toEqual([]);
    const hash = listAttachments(t.space.doc)[0]!.hash;
    await t.blobs.put(hash, new Blob([bytes(5).slice().buffer]));
    await t.sync();
    expect(t.fs.bytes('Personal/attachments/p.bin')).toEqual(bytes(5));
  });

  it('strays copy into attachments/ where the file system lists them', async () => {
    const t = setup();
    (t.fs as { listsStrayFiles?: boolean }).listsStrayFiles = true;
    t.fs.putBytes('Personal/Pasted image 1.png', bytes(7, 7));
    await t.sync();
    expect(t.names()).toEqual(['Pasted image 1.png']);
    expect(t.fs.bytes('Personal/attachments/Pasted image 1.png')).toEqual(bytes(7, 7));
    expect(t.fs.bytes('Personal/Pasted image 1.png')).toEqual(bytes(7, 7));
    // Deleting the copy deletes the file everywhere; the stray is not copied back.
    await t.fs.delete('Personal/attachments/Pasted image 1.png');
    await t.sync();
    await t.sync();
    expect(t.names()).toEqual([]);
    expect(t.fs.paths()).toEqual(['Personal/Pasted image 1.png']);
  });

  it('state saved before files existed still works', async () => {
    const t = setup();
    delete t.state.files;
    t.fs.putBytes('Personal/attachments/x.bin', bytes(1));
    await t.sync();
    expect(t.names()).toEqual(['x.bin']);
  });
});
