import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addNote, memoryStore } from '../../backup/testing';
import { softDelete } from '../schema';
import { purgeRecord } from '../trash';
import { addAttachment, attachmentsMap, listAttachments } from './attachments';
import { MemoryBlobStore } from './store';
import { deleteFiles, dropDeletedBytes, referencedNames, spaceFiles, unreferencedFiles } from './unused';

const opts = { persist: async () => true, estimate: async () => undefined };
const add = async (doc: Y.Doc, store: MemoryBlobStore, name: string, text: string) => {
  const r = await addAttachment(doc, store, new File([text], name), opts);
  if (!r.ok) throw new Error(r.error);
  return r.attachment;
};
async function setup() {
  const doc = await memoryStore().open('space/s1');
  return { doc, store: new MemoryBlobStore() };
}

describe('unused files', () => {
  it('finds the names live notes point to, in links, embeds, widths and headings', async () => {
    const { doc } = await setup();
    addNote(doc, 'A.md', 'see ![[Photo.PNG|300]] and [[report.pdf#p2]] and [[Other note]]');
    expect([...referencedNames(doc)].sort()).toEqual(['other note', 'photo.png', 'report.pdf']);
  });

  it('takes the last path segment of a link and finds Markdown links and images, decoded', async () => {
    const { doc } = await setup();
    addNote(doc, 'A.md', '![[attachments/Pic.png]] [[a/b/doc.pdf#p2|x]] [t](attachments/my%20file.txt "title") ![](<sub/img.gif>) [web](https://x.test/dl/rep.zip?v=1)');
    expect([...referencedNames(doc)].sort()).toEqual(['doc.pdf', 'img.gif', 'my file.txt', 'pic.png', 'rep.zip']);
  });

  it('lists files no live note names, biggest first; a deleted note is no reference', async () => {
    const { doc, store } = await setup();
    await add(doc, store, 'used.txt', 'x');
    await add(doc, store, 'small.txt', 'ab');
    await add(doc, store, 'big.txt', 'abcdef');
    const keep = addNote(doc, 'Keep.md', 'embed ![[used.txt]]');
    expect(unreferencedFiles(doc).map((a) => a.name)).toEqual(['big.txt', 'small.txt']);
    softDelete(doc, 'notes', keep);
    expect(unreferencedFiles(doc).map((a) => a.name)).toEqual(['big.txt', 'small.txt', 'used.txt']);
  });

  it('deletes only the chosen files and keeps their bytes for Recently deleted', async () => {
    const { doc, store } = await setup();
    const a = await add(doc, store, 'a.txt', 'aaa');
    const b = await add(doc, store, 'b.txt', 'bbb');
    await deleteFiles(doc, store, [a.hash]);
    expect(await store.get(a.hash)).toBeDefined();
    expect(await store.get(b.hash)).toBeDefined();
    expect(listAttachments(doc).map((x) => x.name)).toEqual(['b.txt']);
    expect(attachmentsMap(doc).get(a.hash)?.get('deleted')).toBe(true);
    expect(typeof attachmentsMap(doc).get(a.hash)?.get('deleted_at')).toBe('string');
  });

  it('with the account setting a delete is for good and the bytes go at once', async () => {
    const { doc, store } = await setup();
    const a = await add(doc, store, 'a.txt', 'aaa');
    await deleteFiles(doc, store, [a.hash], { straightAway: true });
    expect(await store.get(a.hash)).toBeUndefined();
    expect(attachmentsMap(doc).get(a.hash)?.has('purged_at')).toBe(true);
    expect(attachmentsMap(doc).get(a.hash)?.has('name')).toBe(false);
  });

  it('another device drops its bytes once 45 days have passed, or when deleted for good', async () => {
    const one = await setup();
    const two = { doc: new Y.Doc(), store: new MemoryBlobStore() };
    const a = await add(one.doc, one.store, 'a.txt', 'aaa');
    const b = await add(one.doc, one.store, 'b.txt', 'bbb');
    Y.applyUpdate(two.doc, Y.encodeStateAsUpdate(one.doc));
    await two.store.put(a.hash, new Blob(['aaa']));
    await two.store.put(b.hash, new Blob(['bbb']));
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    await deleteFiles(one.doc, one.store, [a.hash, b.hash], { now: t0 });
    Y.applyUpdate(two.doc, Y.encodeStateAsUpdate(one.doc));
    expect(await dropDeletedBytes(two.doc, two.store, { now: t0 + 44 * 86_400_000 })).toBe(0);
    purgeRecord(one.doc, 'files', b.hash);
    Y.applyUpdate(two.doc, Y.encodeStateAsUpdate(one.doc));
    expect(await dropDeletedBytes(two.doc, two.store, { now: t0 + 44 * 86_400_000 })).toBe(1);
    expect(await two.store.get(b.hash)).toBeUndefined();
    expect(await dropDeletedBytes(two.doc, two.store, { now: t0 + 45 * 86_400_000 })).toBe(1);
    expect(await two.store.get(a.hash)).toBeUndefined();
    expect(await dropDeletedBytes(two.doc, two.store, { now: t0 + 45 * 86_400_000 })).toBe(0);
  });

  it('keeps the bytes of a file deleted without a date (before B-107), unless the setting says straight away', async () => {
    const { doc, store } = await setup();
    const a = await add(doc, store, 'a.txt', 'aaa');
    attachmentsMap(doc).get(a.hash)?.set('deleted', true); // as an older build deletes
    expect(await dropDeletedBytes(doc, store, { now: Date.now() + 400 * 86_400_000 })).toBe(0);
    expect(await dropDeletedBytes(doc, store, { straightAway: true })).toBe(1);
    expect(attachmentsMap(doc).get(a.hash)?.has('purged_at')).toBe(true);
  });

  it('drops half-received pieces of a deleted file, held or not', async () => {
    const { doc, store } = await setup();
    const a = await add(doc, store, 'a.txt', 'aaa');
    await store.putPiece(a.hash, 0, new Uint8Array([1]));
    await store.delete(a.hash);
    attachmentsMap(doc).get(a.hash)?.set('deleted', true);
    expect((await store.getPieces(a.hash)).size).toBe(1);
    expect(await dropDeletedBytes(doc, store)).toBe(0);
    expect((await store.getPieces(a.hash)).size).toBe(0);
  });

  it('counts only live files in what a space holds', async () => {
    const { doc, store } = await setup();
    await add(doc, store, 'a.txt', 'aaa');
    const b = await add(doc, store, 'b.txt', 'bbbbb');
    attachmentsMap(doc).get(b.hash)?.set('deleted', true);
    expect(await spaceFiles(doc, store)).toMatchObject({ held: 3, files: 1 });
  });

  it('reports what the space holds against its limit', async () => {
    const { doc, store } = await setup();
    await add(doc, store, 'a.txt', 'aaa');
    expect(await spaceFiles(doc, store)).toMatchObject({ held: 3, files: 1 });
  });
});
