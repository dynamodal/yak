import * as Y from 'yjs';
import { liveRecords } from '../schema';
import { attachmentsMap, listAttachments, type Attachment } from './attachments';
import { MAX_UNIT_BYTES } from './limits';
import type { BlobStore } from './store';
import { deletedAtMs, isPurged, purgeRecord, trashRecord, TRASH_MS } from '../trash';

/**
 * Cleaning up files (#166 slice 5, decision N-166j). Nothing is deleted automatically: this finds the
 * files no note refers to, and deletes the ones the person picks. A delete is soft in the index
 * (`deleted: true`, as every record); the bytes stay for Recently deleted and go when it is done with them.
 */

const lastSegment = (ref: string): string => ref.split(/[\\/]/).pop()!.trim().toLowerCase();

/** The file name a Markdown link or image target points to: decoded, without `<>`, query or heading, last path segment (case kept). */
function markdownFileName(raw: string): string {
  let t = raw.trim().replace(/^<|>$/g, '').split(/[?#]/)[0]!;
  try {
    t = decodeURIComponent(t);
  } catch {
    // An undecodable target is compared as written.
  }
  return t.split(/[\\/]/).pop()!.trim();
}

/** Markdown link and image targets of a text: where the target sits (`from` to `to`) and the file name it names. */
export function markdownTargets(text: string): { from: number; to: number; name: string }[] {
  const out: { from: number; to: number; name: string }[] = [];
  for (const m of text.matchAll(/\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    const from = m.index + /^\]\(\s*/.exec(m[0])![0].length;
    const name = markdownFileName(m[1]!);
    if (name) out.push({ from, to: from + m[1]!.length, name });
  }
  return out;
}

/**
 * Lower-cased file names a live note points to: `[[name]]` or `![[folder/name|width]]` (heading and alias
 * ignored, last path segment), and Markdown `[text](folder/name.png)` or `![](name%20x.png)`. Code is not
 * masked: when unsure, a file counts as used.
 */
export function referencedNames(doc: Y.Doc): Set<string> {
  const names = new Set<string>();
  for (const note of liveRecords<{ text?: unknown }>(doc, 'notes')) {
    const text = note.text instanceof Y.Text ? note.text.toString() : typeof note.text === 'string' ? note.text : '';
    for (const m of text.matchAll(/\[\[([^[\]\n]+?)\]\]/g)) {
      const ref = lastSegment(m[1]!.split('|')[0]!.split('#')[0]!);
      if (ref) names.add(ref);
    }
    for (const t of markdownTargets(text)) names.add(t.name.toLowerCase());
  }
  return names;
}

/** Live files of a space that no live note names, biggest first. A soft-deleted note counts as no reference; note history does not count. */
export function unreferencedFiles(doc: Y.Doc): Attachment[] {
  const used = referencedNames(doc);
  return listAttachments(doc)
    .filter((a) => !used.has(a.name.toLowerCase()))
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

/**
 * Delete files for everyone who keeps the space: the index entries are marked deleted and stamped, so
 * Recently deleted keeps them (bytes included) for `TRASH_DAYS` (B-107). With `now` set (the account
 * setting "Delete files for good straight away") they are deleted for good and the bytes go at once.
 */
export async function deleteFiles(doc: Y.Doc, store: BlobStore, hashes: readonly string[], o: { straightAway?: boolean; now?: number } = {}): Promise<void> {
  const now = o.now ?? Date.now();
  doc.transact(() => {
    for (const hash of hashes) {
      trashRecord(doc, 'files', hash, now);
      if (o.straightAway) purgeRecord(doc, 'files', hash, now);
    }
  });
  await dropDeletedBytes(doc, store, { now });
}

/**
 * Remove the bytes, and any half-received pieces, of deleted files that are done with: deleted for good,
 * or deleted more than `TRASH_DAYS` ago. A file deleted without a date (before B-107) keeps whatever
 * bytes are left, as nothing tells when it may go. With `straightAway` (the account setting) every deleted
 * file is deleted for good first. Runs on each device that sees a delete, and now and then for the window.
 */
export async function dropDeletedBytes(doc: Y.Doc, store: BlobStore, o: { now?: number; straightAway?: boolean } = {}): Promise<number> {
  const now = o.now ?? Date.now();
  const map = attachmentsMap(doc);
  if (o.straightAway) {
    const pending = [...map.entries()].filter(([, m]) => m.get('deleted') === true && !isPurged(m)).map(([h]) => h);
    if (pending.length) doc.transact(() => pending.forEach((h) => purgeRecord(doc, 'files', h, now)));
  }
  let n = 0;
  for (const [hash, m] of [...map.entries()]) {
    if (m.get('deleted') !== true) continue;
    // Half-received pieces of a deleted file are no use to anyone; a restore fetches again.
    await store.deletePieces(hash).catch(() => undefined);
    const at = deletedAtMs('files', m);
    if (!isPurged(m) && (at === null || now - at < TRASH_MS)) continue;
    if (await store.has(hash).catch(() => false)) {
      await store.delete(hash);
      n++;
    }
  }
  return n;
}

export interface SpaceFiles {
  /** Bytes of the space's live files held on this device (deleted files not yet swept are not counted). */
  held: number;
  files: number;
  limit: number;
  /** Held bytes as a fraction of the space's limit. */
  fraction: number;
}

export async function spaceFiles(doc: Y.Doc, store: BlobStore): Promise<SpaceFiles> {
  const live = listAttachments(doc);
  let held = 0;
  for (const a of live) if (await store.has(a.hash).catch(() => false)) held += a.size;
  return { held, files: live.length, limit: MAX_UNIT_BYTES, fraction: held / MAX_UNIT_BYTES };
}
