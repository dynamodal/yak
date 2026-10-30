import { MAX_FILE_BYTES, formatBytes } from '../core/blobs/limits';
import { addAttachment, attachmentsMap, listAttachments, sha256Hex, uniqueFileName } from '../core/blobs/attachments';
import { portableSegment } from '../core/file-names';
import type { MirrorFs, FileInfo } from './fs';
import type { MirrorReport, MirrorSpace } from './engine';
import { MIRROR_ORIGIN } from './engine';

/**
 * Files in notes, both ways (#166 slice 3, docs/architecture.md "Files in notes" "Mirror and Obsidian").
 * One flat `attachments/` folder per space. The file store and the `attachments` index are the
 * truth on the app side; the folder is the other side. Rules:
 * - a file new in the folder enters the store and the index (any type, 10 MB cap, ` 2` suffix on a clash);
 * - a file deleted in the folder is deleted (the index entry; the bytes go with Recently deleted, B-107); the other way too;
 * - a file arriving from sync is written when missing;
 * - a changed file replaces the old content under its name.
 */

/** What the last pass left for one file; by lower-case path inside the space folder. */
export interface FileEntry {
  path: string;
  /** SHA-256 of the bytes both sides had; empty when the file was refused. */
  hash: string;
  stamp: string;
  /** Why the file was refused (too big, …); shown again every pass until it changes. */
  error?: string;
}

const key = (path: string): string => path.toLowerCase();
export const ATTACHMENTS = 'attachments';

/** `attachments/<name>`: the one folder files live in. */
function inFolder(rel: string): boolean {
  const segs = rel.split('/');
  return segs.length === 2 && segs[0]!.toLowerCase() === ATTACHMENTS && portableSegment(segs[1]!) && !segs[1]!.startsWith('.');
}

const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

function visible(rel: string): boolean {
  return rel.split('/').every((s) => portableSegment(s) && !s.startsWith('.'));
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function syncFiles(fs: MirrorFs, space: MirrorSpace, all: FileInfo[], entries: Record<string, FileEntry>, report: MirrorReport): Promise<void> {
  const store = space.blobs;
  if (!store) return;
  const doc = space.doc;
  const map = attachmentsMap(doc);
  const prefix = `${space.folder}/`;
  const abs = (rel: string): string => `${prefix}${rel}`;
  const fail = (rel: string, e: unknown): void => void report.errors.push(`${abs(rel)}: ${e instanceof Error ? e.message : String(e)}`);

  /** The files on disk that are files: the attachments folder, and strays where the file system has them. */
  const disk = new Map<string, { path: string; stamp: string }>();
  for (const f of all) {
    if (!f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length);
    if (!visible(rel)) continue;
    const md = /\.md$/i.test(rel);
    if (inFolder(rel) || (fs.listsStrayFiles && !md)) disk.set(key(rel), { path: rel, stamp: f.stamp });
  }

  const isLive = (hash: string): boolean => !!hash && !!map.get(hash) && map.get(hash)!.get('deleted') !== true;
  const nameOf = (hash: string): string => String(map.get(hash)?.get('name') ?? '');
  /** The disk file the index entry is meant to be: same name as the index says. */
  const canonical = (e: FileEntry): boolean => inFolder(e.path) && isLive(e.hash) && nameOf(e.hash).toLowerCase() === baseName(e.path).toLowerCase();
  // A delete in the folder is a delete for everyone; the bytes stay for Recently deleted (B-107) and the file sweep drops them later.
  const drop = async (hash: string): Promise<void> => {
    doc.transact(() => {
      map.get(hash)?.set('deleted', true);
      map.get(hash)?.set('deleted_at', new Date().toISOString());
    }, MIRROR_ORIGIN);
  };
  const untrack = (k: string): void => void delete entries[k];
  const track = (rel: string, hash: string, stamp: string): void => void (entries[key(rel)] = { path: rel, hash, stamp });

  // Files that were tracked.
  for (const [k, e] of Object.entries(entries)) {
    try {
      const d = disk.get(k);
      if (!d) {
        // Deleted in the folder: a delete, for everyone.
        if (canonical(e)) await drop(e.hash);
        untrack(k);
        continue;
      }
      if (e.error !== undefined) {
        if (d.stamp !== e.stamp) untrack(k);
        else report.errors.push(`${abs(e.path)}: ${e.error}`);
        continue;
      }
      if (inFolder(e.path) && !isLive(e.hash)) {
        // Deleted on the app side (Settings, another device): the file follows unless it was edited.
        if (d.stamp === e.stamp) {
          await fs.delete(abs(e.path));
          disk.delete(k);
        }
        // The bytes stay in the store for Recently deleted (B-107); the file sweep drops them when it is done with them.
        untrack(k);
        continue;
      }
      if (d.stamp === e.stamp) continue;
      const hash = await sha256Hex(toBuffer(await fs.readBinary(abs(e.path))));
      if (hash === e.hash) {
        e.stamp = d.stamp;
        continue;
      }
      // New content under the same name: the old content goes (it is read again below as a new file).
      if (canonical(e)) await drop(e.hash);
      untrack(k);
    } catch (err) {
      fail(e.path, err);
    }
  }

  // Files new in the folder, and changed ones.
  for (const [k, d] of [...disk]) {
    if (entries[k]) continue;
    try {
      const name = baseName(d.path);
      const bytes = await fs.readBinary(abs(d.path));
      if (bytes.length > MAX_FILE_BYTES) {
        const error = `is ${formatBytes(bytes.length)}; the limit is ${formatBytes(MAX_FILE_BYTES)} per file. Left alone.`;
        entries[k] = { path: d.path, hash: '', stamp: d.stamp, error };
        report.errors.push(`${abs(d.path)}: ${error}`);
        continue;
      }
      const hash = await sha256Hex(toBuffer(bytes));
      if (isLive(hash)) {
        if (!(await store.get(hash))) await store.put(hash, new Blob([toBuffer(bytes)], { type: String(map.get(hash)!.get('type') ?? 'application/octet-stream') }));
        track(d.path, hash, d.stamp);
        continue;
      }
      const r = await addAttachment(doc, store, new File([toBuffer(bytes)], name));
      if (!r.ok) {
        entries[k] = { path: d.path, hash: '', stamp: d.stamp, error: r.error };
        report.errors.push(`${abs(d.path)}: ${r.error}`);
        continue;
      }
      let final = r.attachment.name;
      // The name may also be taken by a file not read yet.
      const others = [...disk.values()].filter((o) => o.path !== d.path).map((o) => baseName(o.path));
      const unique = uniqueFileName(final, [...others, ...listAttachments(doc).filter((a) => a.hash !== hash).map((a) => a.name)]);
      if (unique !== final) {
        final = unique;
        doc.transact(() => map.get(hash)?.set('name', final), MIRROR_ORIGIN);
      }
      if (inFolder(d.path) && final !== name) {
        const to = `${ATTACHMENTS}/${final}`;
        await fs.rename(abs(d.path), abs(to));
        disk.delete(k);
        const stamp = disk.get(key(to))?.stamp ?? d.stamp;
        disk.set(key(to), { path: to, stamp });
        track(to, hash, stamp);
      } else track(d.path, hash, d.stamp);
    } catch (err) {
      fail(d.path, err);
    }
  }

  // Files that arrived from sync (or were renamed in the index): written to the folder.
  const seen = new Set<string>();
  const live = listAttachments(doc).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.hash.localeCompare(b.hash));
  for (const a of live) {
    try {
      let name = a.name;
      if (seen.has(name.toLowerCase())) {
        // Two entries, one name (added on two devices): the later one is renamed, by the same rule on every device.
        name = uniqueFileName(name, [...seen, ...live.map((o) => o.name)]);
        doc.transact(() => map.get(a.hash)?.set('name', name), MIRROR_ORIGIN);
      }
      seen.add(name.toLowerCase());
      const rel = `${ATTACHMENTS}/${name}`;
      if (!inFolder(rel)) {
        report.errors.push(`${abs(rel)}: not a usable file name`);
        continue;
      }
      const here = Object.values(entries).filter((e) => e.hash === a.hash && inFolder(e.path));
      if (here.some((e) => key(e.path) === key(rel))) continue;
      const taken = disk.has(key(rel));
      const old = here.find((e) => disk.get(key(e.path))?.stamp === e.stamp);
      if (old && !taken) {
        // Renamed in the index: the file follows.
        await fs.rename(abs(old.path), abs(rel));
        const stamp = disk.get(key(old.path))?.stamp ?? old.stamp;
        disk.delete(key(old.path));
        untrack(key(old.path));
        disk.set(key(rel), { path: rel, stamp });
        track(rel, a.hash, stamp);
        continue;
      }
      if (taken) {
        report.errors.push(`${abs(rel)}: a different file has this name; left alone`);
        continue;
      }
      const rec = await store.get(a.hash);
      if (!rec) continue; // bytes not here yet; written when they arrive
      const stamp = await fs.writeBinary(abs(rel), new Uint8Array(await rec.blob.arrayBuffer()));
      disk.set(key(rel), { path: rel, stamp });
      track(rel, a.hash, stamp);
    } catch (err) {
      fail(`${ATTACHMENTS}/${a.name}`, err);
    }
  }
}
