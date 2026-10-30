import * as Y from 'yjs';
import { attachmentsMap, findAttachment, listAttachments, uniqueFileName } from './attachments';
import { announceBlobStored, blobStore, type BlobStore } from './store';

/**
 * Copying a file to another space (#272): a note moved to a space takes the files it names along.
 * The index entry goes into the target's `attachments` map (same hash, so the same bytes are never
 * stored twice); the source keeps its own copy and nothing is deleted. Bytes follow separately
 * (`copyBlobs`); a target that lacks them fetches them from peers like any other missing file.
 */

export interface CopiedFile {
  hash: string;
  /** The name in the target; differs from the source's when the name was taken by other bytes there. */
  name: string;
}

/** Add the file `name` of `src` to `dst`'s index. Null when `src` has no such file. Call inside a transaction on `dst`. */
export function copyIndexEntry(src: Y.Doc, dst: Y.Doc, name: string): CopiedFile | null {
  const a = findAttachment(src, name);
  if (!a) return null;
  const map = attachmentsMap(dst);
  const live = listAttachments(dst);
  const same = live.find((x) => x.hash === a.hash);
  if (same) return { hash: a.hash, name: same.name };
  const unique = uniqueFileName(
    a.name,
    live.map((x) => x.name),
  );
  const existing = map.get(a.hash);
  if (existing && !existing.has('purged_at')) {
    // Deleted in the target: bring it back under a free name. A tombstone (deleted for good) is replaced by a new entry below.
    dst.transact(() => {
      existing.set('name', unique);
      existing.set('deleted', false);
      existing.delete('deleted_at');
    });
    return { hash: a.hash, name: unique };
  }
  const m = new Y.Map<unknown>();
  m.set('name', unique);
  m.set('size', a.size);
  m.set('type', a.type);
  if (a.width !== undefined) m.set('width', a.width);
  if (a.height !== undefined) m.set('height', a.height);
  if (a.pieces) m.set('pieces', a.pieces);
  m.set('created_at', a.created_at);
  m.set('deleted', false);
  map.set(a.hash, m);
  return { hash: a.hash, name: unique };
}

/** Copy the bytes of `hashes` that this device holds from one space's store to another's. Absent bytes are left for the target to fetch. */
export async function copyBlobs(fromUnit: string, toUnit: string, hashes: readonly string[], stores: { from?: BlobStore; to?: BlobStore } = {}): Promise<void> {
  const from = stores.from ?? blobStore(fromUnit);
  const to = stores.to ?? blobStore(toUnit);
  for (const hash of hashes) {
    try {
      if (await to.has(hash)) continue;
      const rec = await from.get(hash);
      if (!rec) continue;
      await to.put(hash, rec.blob);
      announceBlobStored(toUnit, hash);
    } catch {
      // The target fetches it from a peer instead.
    }
  }
}
