import type * as Y from 'yjs';
import { attachmentsMap, listAttachments, sha256Hex } from '../core/blobs/attachments';
import type { BlobStore } from '../core/blobs/store';
import { MAX_FILE_BYTES } from '../core/blobs/limits';
import { NotFoundError, SubDir, type BackupDir } from './dir';
import { EncryptedDir, blobNamer } from './crypto';
import { blobPath, type BackupBlob, type Manifest } from './format';

/**
 * Files in notes inside backups (#166 slice 4, docs/architecture.md "Files in notes"). Bytes are never in the
 * snapshot's in-memory file map: a folder backup copies each hash once into `<account>/blobs/`, a zip
 * holds them as parts, and the manifest lists which files a backup carries.
 */

export const BLOBS = 'blobs';

const SPACE_DOC = /^space\/([^/]+)$/;

export const spaceUnit = (docId: string): string | undefined => SPACE_DOC.exec(docId)?.[1];

/** The files the notes of the given documents list, split into those whose bytes this device holds and a count of those it does not. */
/** Every file the notes of the given documents list (what a backup of them would need), whether or not the bytes are here. */
export function listBlobs(docs: ReadonlyMap<string, Y.Doc>): BackupBlob[] {
  const out: BackupBlob[] = [];
  for (const [id, doc] of [...docs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const unit = spaceUnit(id);
    if (unit) for (const a of listAttachments(doc).sort((x, y) => (x.hash < y.hash ? -1 : 1))) out.push({ unit, hash: a.hash, name: a.name, size: a.size, type: a.type });
  }
  return out;
}

export async function collectBlobs(docs: ReadonlyMap<string, Y.Doc>, stores: (unit: string) => BlobStore): Promise<{ blobs: BackupBlob[]; missing: number }> {
  const blobs: BackupBlob[] = [];
  let missing = 0;
  for (const [id, doc] of [...docs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const unit = spaceUnit(id);
    if (!unit) continue;
    for (const a of listAttachments(doc).sort((x, y) => (x.hash < y.hash ? -1 : 1))) {
      if (await stores(unit).get(a.hash).catch(() => undefined)) blobs.push({ unit, hash: a.hash, name: a.name, size: a.size, type: a.type });
      else missing++;
    }
  }
  return { blobs, missing };
}

export const totalBlobBytes = (blobs: readonly BackupBlob[]): number => blobs.reduce((n, b) => n + b.size, 0);

/** The distinct hashes of a list, with the first entry for each (the same bytes in two spaces are one file in a folder). */
const byHash = (blobs: readonly BackupBlob[]): Map<string, BackupBlob> => {
  const out = new Map<string, BackupBlob>();
  for (const b of blobs) if (!out.has(b.hash)) out.set(b.hash, b);
  return out;
};

export type ReadBlob = (b: BackupBlob) => Promise<Blob | undefined>;

/** The reader of a space's local file store. */
export const storeReader =
  (stores: (unit: string) => BlobStore): ReadBlob =>
  async (b) =>
    (await stores(b.unit).get(b.hash))?.blob;

async function bytesOf(blob: Blob, hash: string): Promise<Uint8Array | undefined> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return (await sha256Hex(data.buffer as ArrayBuffer)) === hash ? data : undefined;
}

/**
 * Copy the files the folder lacks into `<account>/blobs/<name>`, one file per hash. `name` is the hash,
 * or its HMAC in encrypted mode. A file whose bytes no longer match their hash on this device is skipped
 * and counted, never written under a hash it does not have.
 */
export async function copyBlobs(acct: BackupDir, blobs: readonly BackupBlob[], read: ReadBlob, name: (hash: string) => Promise<string>): Promise<{ written: number; present: number; damaged: number }> {
  const have = new Set(await acct.listFiles(BLOBS));
  let written = 0;
  let present = 0;
  let damaged = 0;
  for (const [hash, b] of byHash(blobs)) {
    const file = await name(hash);
    if (have.has(file)) {
      present++;
      continue;
    }
    const blob = await read(b);
    const data = blob && (await bytesOf(blob, hash));
    if (!data) {
      damaged++;
      continue;
    }
    await acct.writeFile(`${BLOBS}/${file}`, data);
    have.add(file);
    written++;
  }
  return { written, present, damaged };
}

/** Readable copies beside the notes in `current/` (plain mode only): written when new, removed when the file is gone. */
export async function writeReadableFiles(dir: BackupDir, blobs: readonly BackupBlob[], old: Manifest | undefined, read: ReadBlob | undefined, force = false): Promise<void> {
  const wanted = new Map(blobs.map((b) => [blobPath(b), b]));
  const had = new Map((old?.blobs ?? []).map((b) => [blobPath(b), b]));
  // One listing per folder: `exists` would read the whole file.
  const listed = new Map<string, Set<string>>();
  const exists = async (path: string): Promise<boolean> => {
    const at = path.lastIndexOf('/');
    let names = listed.get(path.slice(0, at));
    if (!names) listed.set(path.slice(0, at), (names = new Set(await dir.listFiles(path.slice(0, at)))));
    return names.has(path.slice(at + 1));
  };
  for (const [path, b] of wanted) {
    if (!read || (!force && had.get(path)?.hash === b.hash && (await exists(path)))) continue;
    const blob = await read(b);
    const data = blob && (await bytesOf(blob, b.hash));
    if (data) await dir.writeFile(path, data);
  }
  for (const path of had.keys()) {
    if (wanted.has(path)) continue;
    try {
      await dir.removeFile?.(path);
    } catch {
      // A readable copy that is already gone is the goal.
    }
  }
}

// ---- Restore

/** Where a backup's file bytes can be read from. */
export interface BlobSource {
  read(b: BackupBlob): Promise<Uint8Array | undefined>;
}

const tryRead = async (dir: BackupDir, path: string): Promise<Uint8Array | undefined> => {
  try {
    return await dir.readFile(path);
  } catch (e) {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  }
};

/**
 * The files of an account folder: its `blobs/` (under the hash, or the HMAC name when `key` is given),
 * then the readable copy beside the notes in the backup itself.
 */
export function folderBlobSource(acct: BackupDir, key?: CryptoKey, backup?: BackupDir): BlobSource {
  const namer = key ? blobNamer(key) : undefined;
  return {
    async read(b) {
      if (namer) {
        const got = await tryRead(acct, `${BLOBS}/${await (await namer)(b.hash)}`);
        if (got) return got;
      }
      return (await tryRead(acct, `${BLOBS}/${b.hash}`)) ?? (backup ? tryRead(backup, blobPath(b)) : undefined);
    },
  };
}

/** The same for an account sub-folder of a folder read through `view` (which holds the key when the backups are encrypted). */
export function accountBlobSource(view: BackupDir, accountFolder: string, backup?: BackupDir): BlobSource {
  return folderBlobSource(new SubDir(view, accountFolder), view instanceof EncryptedDir ? view.readKey : undefined, backup);
}

export interface RestoredFiles {
  restored: number;
  already: number;
  /** Listed by the backup but not found in it, or failing their hash. */
  unavailable: number;
}

/**
 * Put the files of a verified backup into the local stores. Every file is checked against its hash first.
 * `docFor` returns a space's open document: an index entry deleted on this device is brought back when the
 * backup holds its bytes (nothing is collected automatically, so restore is how a deleted file returns).
 */
export async function restoreBlobs(manifest: Manifest, source: BlobSource, stores: (unit: string) => BlobStore, docFor?: (unit: string) => Y.Doc | undefined): Promise<RestoredFiles> {
  const out: RestoredFiles = { restored: 0, already: 0, unavailable: 0 };
  for (const b of manifest.blobs) {
    const store = stores(b.unit);
    let have = !!(await store.get(b.hash));
    if (have) out.already++;
    else {
      const data = await source.read(b);
      if (!data || data.byteLength > MAX_FILE_BYTES || (await sha256Hex(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)) !== b.hash) {
        out.unavailable++;
        continue;
      }
      await store.put(b.hash, new Blob([data as Uint8Array<ArrayBuffer>], { type: b.type.startsWith('image/') ? b.type : 'application/octet-stream' }));
      out.restored++;
      have = true;
    }
    const doc = docFor?.(b.unit);
    const entry = doc ? attachmentsMap(doc).get(b.hash) : undefined;
    if (entry && entry.get('deleted') === true && !entry.has('purged_at')) {
      entry.set('deleted', false);
      entry.delete('deleted_at');
    }
  }
  return out;
}

export function filesText(blobs: readonly BackupBlob[]): string {
  const n = blobs.length;
  return `${n} file${n === 1 ? '' : 's'}`;
}
