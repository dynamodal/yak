import { useApp } from '../app/context';
import { toast } from '../app/ui';
import { bulkEdit } from '../core/bulk';
import { moveToSpace, type Spaces, type Target } from './bulk-edit';
import { type EntryRecord, isRunning } from './entries';

const plural = (n: number): string => (n === 1 ? '1 entry' : `${n} entries`);

/** The entries a move would touch: live ones that are not running (a running timer stays where it is). */
export function movable(entries: readonly EntryRecord[]): EntryRecord[] {
  return entries.filter((e) => !isRunning(e) && e.spaceId);
}

/**
 * Moving single entries (or a group) to another space from a row's menu (#64): the same `moveToSpace` as the bulk bar, so the
 * project follows by name, tags are made there and the original is marked deleted, in one transaction with one Undo.
 * `to(entries)` lists the spaces to offer (none unless there are several) and `move` does it.
 */
export function useMoveEntries(): {
  to(entries: readonly EntryRecord[]): { id: string; name: string }[];
  move(entries: readonly EntryRecord[], toSpace: string): void;
} {
  const { spaces, spaceDocs, privateDocs, deviceId } = useApp();
  const kept = spaces.filter((s) => spaceDocs.has(s.id) && privateDocs.has(s.id));
  return {
    to: (entries) => {
      const from = new Set(movable(entries).map((e) => e.spaceId));
      return kept.length > 1 && from.size > 0 ? kept.filter((s) => from.size > 1 || !from.has(s.id)).map((s) => ({ id: s.id, name: s.name })) : [];
    },
    move: (entries, toSpace) => {
      const handles: Spaces = new Map(kept.map((s) => [s.id, { doc: spaceDocs.get(s.id)!, privateDoc: privateDocs.get(s.id)! }]));
      const targets: Target[] = movable(entries).map((e) => ({ spaceId: e.spaceId!, id: e.id }));
      const { result, undo } = bulkEdit([...handles.values()].flatMap((h) => [h.doc, h.privateDoc]), (tx) => moveToSpace(handles, targets, toSpace, deviceId, tx));
      const name = kept.find((s) => s.id === toSpace)?.name ?? '';
      toast(`Moved ${plural(result.changed)} to ${name}.${result.skipped > 0 ? ` ${result.skipped} left as they were.` : ''}`, { action: { label: 'Undo', run: undo } });
    },
  };
}
