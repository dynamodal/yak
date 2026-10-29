import type * as Y from 'yjs';
import { copyIndexEntry } from '../core/blobs/copy';
import { markdownTargets } from '../core/blobs/unused';
import { looksLikeFile } from '../core/blobs/attachments';
import { applyLinkEdits, spellingFor, type LinkEdit, type LinkMode, type LinkNote, type PathMove } from './link-update';
import { extractLinks, makeResolver, type WikiLink } from './links';
import { buildIndex, createNote, deleteNote, foldersMap, noteText } from './note-store';
import { folderTarget, joinPath, moveFolder, pathKey, pathProblem, splitPath, type MoveSource } from './paths';

/**
 * Moving notes between spaces (issue 59). A note cannot change documents, so it is copied into the other
 * space's document (new id) and soft-deleted in the old one, with no stub left behind. Links are rewritten
 * so they still reach it: a link names a space as `[[Space name:path]]`. `:` cannot appear in a note path
 * (`pathProblem`), so the first `Space name:` that matches a known space is unambiguous.
 */

/** Split `Space:rest` when `target` starts with one of `names` (longest first, ignoring case). */
export function parseSpaceTarget(target: string, names: readonly string[]): { space: string | null; rest: string } {
  const lower = target.toLowerCase();
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const prefix = `${name.toLowerCase()}:`;
    if (name && lower.startsWith(prefix)) return { space: name, rest: target.slice(prefix.length).trim() };
  }
  return { space: null, rest: target };
}

interface SpaceEdit extends LinkEdit {
  /** The document the edit applies to. Edits to moved notes are `dst`, under the note's old id until it is copied. */
  in: 'src' | 'dst';
}

interface SpaceMoveInput {
  src: readonly LinkNote[];
  dst: readonly LinkNote[];
  /** Notes leaving `src`, with their paths in `dst`. */
  moves: readonly PathMove[];
  srcName: string;
  dstName: string;
}

function render(l: WikiLink, space: string | null, target: string): string {
  const inner = (space ? `${space}:` : '') + target + (l.heading ? `#${l.heading}` : '') + (l.alias ? `|${l.alias}` : '');
  return `${l.embed ? '!' : ''}[[${inner}]]`;
}

/**
 * The edits that keep links working when `moves` leave `src` for `dst`:
 * links in `src` to a moved note name the new space; links in a moved note to a note left behind name the
 * old space, and to another moved note become plain again; links in `dst` that named the old space plain.
 * Links that name any other space are left alone.
 */
function planSpaceMove(input: SpaceMoveInput): SpaceEdit[] {
  const { src, dst, moves, srcName, dstName } = input;
  if (moves.length === 0) return [];
  const names = [srcName, dstName];
  const newPath = new Map(moves.map((m) => [m.id, m.path]));
  const left = src.filter((n) => !newPath.has(n.id));
  const arriving = src.filter((n) => newPath.has(n.id)).map((n) => ({ ...n, path: newPath.get(n.id) as string }));
  const resolveSrc = makeResolver(src);
  const resolveLeft = makeResolver(left);
  const resolveDst = makeResolver([...dst, ...arriving]);
  const resolveDstOnly = makeResolver(dst);
  const edits: SpaceEdit[] = [];
  const add = (where: 'src' | 'dst', n: LinkNote, l: WikiLink, text: string): void => {
    const expect = n.text.slice(l.from, l.to);
    if (text !== expect) edits.push({ in: where, noteId: n.id, from: l.from, to: l.to, expect, text });
  };
  /** The link as a plain link in `dst`, from the note at `fromPath`. */
  const local = (hitId: string, hitPath: string, l: WikiLink, rest: string, fromPath: string): string =>
    render(l, null, spellingFor(hitId, hitPath, resolveDst, fromPath, rest.includes('/')));

  for (const n of left) {
    for (const l of n.links) {
      const p = parseSpaceTarget(l.target, names);
      if (!l.target || (p.space !== null && p.space !== srcName)) continue;
      const hit = resolveSrc(p.rest, n.path);
      const to = hit ? newPath.get(hit.id) : undefined;
      if (!hit || to === undefined) continue;
      add('src', n, l, render(l, dstName, spellingFor(hit.id, to, resolveDst, '', p.rest.includes('/'))));
    }
  }
  for (const n of dst) {
    for (const l of n.links) {
      const p = parseSpaceTarget(l.target, names);
      if (!l.target || p.space !== srcName) continue;
      const hit = resolveSrc(p.rest, '');
      const to = hit ? newPath.get(hit.id) : undefined;
      if (!hit || to === undefined) continue;
      add('dst', n, l, local(hit.id, to, l, p.rest, n.path));
    }
  }
  for (const n of src) {
    const to = newPath.get(n.id);
    if (to === undefined) continue;
    for (const l of n.links) {
      const p = parseSpaceTarget(l.target, names);
      if (!l.target) continue;
      if (p.space === dstName) {
        // Named the space the note is arriving in: now plain.
        const there = resolveDstOnly(p.rest, '');
        if (there) add('dst', n, l, render(l, null, spellingFor(there.id, there.path, resolveDst, to, p.rest.includes('/'))));
        continue;
      }
      if (p.space !== null && p.space !== srcName) continue;
      const hit = resolveSrc(p.rest, n.path);
      if (!hit) continue;
      const hitTo = newPath.get(hit.id);
      if (hitTo !== undefined) add('dst', n, l, local(hit.id, hitTo, l, p.rest, to));
      else add('dst', n, l, render(l, srcName, spellingFor(hit.id, hit.path, resolveLeft, '', p.rest.includes('/'))));
    }
  }
  return edits;
}

export type SpacePlan = { ok: true; moves: PathMove[]; folder: { from: string; to: string } | null } | { ok: false; error: string };

/** New paths in the other space for a note or folder moved into `targetFolder` ('' is the top level). */
export function planSpacePaths(src: readonly LinkNote[], dst: readonly LinkNote[], source: MoveSource, targetFolder: string): SpacePlan {
  const target = splitPath(targetFolder.replace(/\\/g, '/')).join('/');
  const problem = target ? pathProblem(`${target}/x.md`) : null;
  if (problem) return { ok: false, error: problem };
  let moves: PathMove[];
  let folder: { from: string; to: string } | null = null;
  if (source.kind === 'note') {
    const item = src.find((i) => i.id === source.id);
    if (!item) return { ok: false, error: 'That note no longer exists' };
    moves = [{ id: item.id, path: joinPath(target, splitPath(item.path).pop() ?? item.path) }];
  } else {
    const from = splitPath(source.path).join('/');
    folder = { from, to: folderTarget(from, target) };
    moves = moveFolder(src, from, folder.to);
  }
  const taken = new Set(dst.map((i) => pathKey(i.path)));
  const clash = moves.find((m) => taken.has(pathKey(m.path)));
  if (clash) return { ok: false, error: `A note named ${clash.path} already exists there` };
  return { ok: true, moves, folder };
}

export interface SpaceMoveResult {
  /** The edits planned (for `ask`, not yet applied); ids of copies are already their new ids. */
  edits: SpaceEdit[];
  /** Copies in `dst`, by the id the note had in `src`. */
  newIds: Map<string, string>;
  /** Hashes of the files the moved notes name, now in `dst`'s index; the caller copies their bytes (`copyBlobs`). */
  files: string[];
  /** Move everything back, with links rewritten the same way. */
  undo(): void;
}

/** Entries of kept (empty) folders at or under `from`. */
function folderEntriesUnder(doc: Y.Doc, from: string): string[] {
  const lower = from.toLowerCase();
  return [...foldersMap(doc).entries()].filter(([k, live]) => live === true && (k.toLowerCase() === lower || k.toLowerCase().startsWith(`${lower}/`))).map(([k]) => k);
}

/**
 * Files the notes `ids` of `dst` name (`![[photo.png]]`, `![](photo.png)`, `[t](a.pdf)`) are copied into `dst`'s index from `src`; a link
 * (wiki or Markdown) whose file got another name there (the name was taken by other bytes) is rewritten. `src` keeps its files.
 */
function copyFiles(src: Y.Doc, dst: Y.Doc, ids: readonly string[]): string[] {
  const hashes = new Set<string>();
  dst.transact(() => {
    for (const id of ids) {
      const ytext = noteText(dst, id);
      if (!ytext) continue;
      const text = ytext.toString();
      // Wiki links and Markdown links or images, last first so an edit leaves the earlier positions alone.
      const refs = [
        ...extractLinks(text).map((l) => ({ from: l.from, to: l.to, name: l.target.split(/[\\/]/).pop() ?? '', rewrite: (n: string) => `${l.embed ? '!' : ''}[[${n}${l.heading ? `#${l.heading}` : ''}${l.alias ? `|${l.alias}` : ''}]]` })),
        ...markdownTargets(text).map((t) => ({ ...t, rewrite: (n: string) => encodeURIComponent(n) })),
      ].sort((a, b) => b.from - a.from);
      for (const r of refs) {
        if (!looksLikeFile(r.name)) continue;
        const copy = copyIndexEntry(src, dst, r.name);
        if (!copy) continue;
        hashes.add(copy.hash);
        if (copy.name.toLowerCase() === r.name.toLowerCase()) continue;
        ytext.delete(r.from, r.to - r.from);
        ytext.insert(r.from, r.rewrite(copy.name));
      }
    }
  });
  return [...hashes];
}

/**
 * Copy notes into `dst`, soft-delete them in `src`, and in `auto` mode fix the links in the same step.
 * The copies are made first, so a failure in between leaves a duplicate rather than a loss.
 */
export function moveToSpace(
  srcDoc: Y.Doc,
  dstDoc: Y.Doc,
  names: { src: string; dst: string },
  moves: readonly PathMove[],
  folder: { from: string; to: string } | null,
  mode: LinkMode,
): SpaceMoveResult {
  const src = buildIndex(srcDoc).notes;
  const dst = buildIndex(dstDoc).notes;
  const planned = mode === 'off' ? [] : planSpaceMove({ src, dst, moves, srcName: names.src, dstName: names.dst });
  const newIds = new Map<string, string>();
  const original = new Map(src.map((n) => [n.id, n.path]));
  dstDoc.transact(() => {
    for (const m of moves) newIds.set(m.id, createNote(dstDoc, m.path, noteText(srcDoc, m.id)?.toString() ?? ''));
    if (folder) {
      for (const key of folderEntriesUnder(srcDoc, folder.from)) foldersMap(dstDoc).set(folder.to + key.slice(folder.from.length), true);
      if (moves.length === 0) foldersMap(dstDoc).set(folder.to, true);
    }
  });
  const edits = planned.map((e) => (e.in === 'dst' && newIds.has(e.noteId) ? { ...e, noteId: newIds.get(e.noteId) as string } : e));
  if (mode === 'auto') {
    applyLinkEdits(srcDoc, edits.filter((e) => e.in === 'src'));
    applyLinkEdits(dstDoc, edits.filter((e) => e.in === 'dst'));
  }
  const files = copyFiles(srcDoc, dstDoc, [...newIds.values()]);
  srcDoc.transact(() => {
    for (const m of moves) deleteNote(srcDoc, m.id);
    if (folder) for (const key of folderEntriesUnder(srcDoc, folder.from)) foldersMap(srcDoc).set(key, false);
  });
  const undo = (): void => {
    const back = moves.map((m) => ({ id: newIds.get(m.id) as string, path: original.get(m.id) ?? m.path }));
    moveToSpace(dstDoc, srcDoc, { src: names.dst, dst: names.src }, back, folder ? { from: folder.to, to: folder.from } : null, mode === 'ask' ? 'off' : mode);
  };
  return { edits, newIds, files, undo };
}
