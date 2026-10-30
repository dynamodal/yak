import { useEffect, useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { Button } from '../app/ui';
import { formatBytes } from '../core/blobs/limits';
import { blobStore } from '../core/blobs/store';
import { dropDeletedBytes } from '../core/blobs/unused';
import {
  purgeRecord,
  readDeleteFilesNow,
  restoreRecord,
  trashItems,
  TRASH_DAYS,
  writeDeleteFilesNow,
  type TrashItem,
  type TrashKind,
} from '../core/trash';
import './recently-deleted.css';

/**
 * Recently deleted (#107, B-107): every kind of deleted item, newest first, each with Restore and Delete for good.
 * The data rules are in `core/trash.ts`; this section only reads the documents, so it names no feature module.
 */

interface KindInfo {
  kind: TrashKind;
  label: string;
  /** The retention, said once per kind. */
  keep: string;
  /** Which document of a space holds the kind. */
  where: 'space' | 'private';
}

const KINDS: readonly KindInfo[] = [
  { kind: 'time_entries', label: 'Time entries', keep: `Kept ${TRASH_DAYS} days after deleting. Undo also appears right after a delete.`, where: 'private' },
  { kind: 'notes', label: 'Notes and tasks', keep: `Kept ${TRASH_DAYS} days after deleting.`, where: 'space' },
  { kind: 'projects', label: 'Projects', keep: `Kept ${TRASH_DAYS} days after deleting. Ones deleted before this list existed show “date unknown” and stay until you delete them for good.`, where: 'space' },
  { kind: 'clients', label: 'Clients', keep: `Kept ${TRASH_DAYS} days after deleting; older ones as for projects.`, where: 'space' },
  { kind: 'tags', label: 'Tags', keep: `Kept ${TRASH_DAYS} days after deleting; older ones as for projects. Restoring a tag does not put it back on entries.`, where: 'space' },
  { kind: 'files', label: 'Files in notes', keep: `Kept ${TRASH_DAYS} days after deleting, contents included; then the contents are removed on every device.`, where: 'space' },
];

type Row = TrashItem & { spaceId: string; doc: Y.Doc };

/** Re-render (debounced) when any of the documents changes. */
function useDocsVersion(docs: readonly Y.Doc[]): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = (): void => {
      clearTimeout(t);
      t = setTimeout(() => setN((x) => x + 1), 100);
    };
    for (const d of docs) d.on('update', bump);
    return () => {
      clearTimeout(t);
      for (const d of docs) d.off('update', bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, docs);
  return n;
}

const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

function when(r: TrashItem): string {
  if (r.deletedAt === null) return 'Deleted: date unknown';
  return `Deleted ${day(r.deletedAt)} · goes ${day(r.expiresAt!)}`;
}

function rowTitle(r: TrashItem): string {
  if (r.kind === 'notes') return r.title.replace(/\.md$/i, '') || '(untitled note)';
  if (r.kind === 'time_entries') return r.title || '(no description)';
  return r.title || '(no name)';
}

function detail(r: TrashItem): string {
  if (r.kind === 'time_entries' && typeof r.fields.start === 'string') {
    const start = Date.parse(r.fields.start);
    const hours = typeof r.fields.duration === 'number' ? ` · ${(r.fields.duration / 3600).toFixed(2)} h` : '';
    return Number.isFinite(start) ? `${day(start)}${hours}` : '';
  }
  if (r.kind === 'files' && typeof r.fields.size === 'number') return formatBytes(r.fields.size);
  return '';
}

function TrashRow({ row, space, held }: { row: Row; space: string; held: boolean | undefined }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const title = rowTitle(row);
  const missing = row.kind === 'files' && held === false;
  const restore = (): void => {
    const r = restoreRecord(row.doc, row.kind, row.id);
    setError(r.ok ? '' : r.error);
  };
  const purge = async (): Promise<void> => {
    purgeRecord(row.doc, row.kind, row.id);
    setConfirm(false);
    if (row.kind === 'files') await dropDeletedBytes(row.doc, blobStore(row.spaceId)).catch(() => undefined);
  };
  const info = [detail(row), space].filter(Boolean).join(' · ');
  return (
    <li class="rd-row" data-trash={row.kind} data-id={row.id}>
      <div class="rd-main">
        <span class="rd-title">{title}</span>
        <span class="hint">
          {info ? `${info} · ` : ''}
          {when(row)}
        </span>
        {missing ? <span class="hint">Its contents are not on this device; restore it on a device that has them, or from a backup.</span> : null}
      </div>
      {confirm ? (
        <div class="rd-confirm" role="group" aria-label={`Delete ${title} for good`}>
          <p>
            Delete “{title}” for good on all your devices? It can no longer be restored from Recently deleted. Older backups and this device’s Version history may still hold a copy.
          </p>
          <div class="cluster">
            <Button variant="danger" onClick={() => void purge()}>
              Delete for good
            </Button>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div class="rd-actions cluster">
          <Button aria-label={`Restore ${title}`} disabled={missing} onClick={restore}>
            Restore
          </Button>
          <Button aria-label={`Delete ${title} for good`} onClick={() => setConfirm(true)}>
            Delete for good
          </Button>
        </div>
      )}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Which deleted files this device still holds the bytes of, by space and hash. */
function useHeld(rows: readonly Row[]): ReadonlyMap<string, boolean> {
  const [held, setHeld] = useState<ReadonlyMap<string, boolean>>(new Map());
  const key = rows.map((r) => `${r.spaceId}:${r.id}`).join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(rows.map(async (r) => [`${r.spaceId}:${r.id}`, await blobStore(r.spaceId).has(r.id).catch(() => false)] as const)).then((pairs) => live && setHeld(new Map(pairs)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return held;
}

function FilesNowSetting({ account }: { account: Y.Doc }) {
  const on = readDeleteFilesNow(account);
  return (
    <label class="row rd-setting">
      <input type="checkbox" data-setting="delete-files-now" checked={on} onChange={(e) => writeDeleteFilesNow(account, (e.target as HTMLInputElement).checked)} />
      <span>
        <strong>Delete files for good straight away</strong>
        <span class="hint"> For all your devices: a deleted file and its contents are removed at once and are not kept here.</span>
      </span>
    </label>
  );
}

export function RecentlyDeletedSection() {
  const { spaces, spaceDocs, privateDocs, account } = useApp();
  const docs = useMemo(() => [account, ...spaceDocs.values(), ...privateDocs.values()], [account, spaceDocs, privateDocs]);
  const version = useDocsVersion(docs);
  const many = spaces.length > 1;
  const names = new Map(spaces.map((s) => [s.id, s.name]));
  const groups = useMemo(() => {
    const now = Date.now();
    return KINDS.map((k) => ({
      ...k,
      rows: spaces
        .flatMap((s) => {
          const doc = (k.where === 'private' ? privateDocs : spaceDocs).get(s.id);
          return doc ? trashItems(doc, k.kind, now).map((t): Row => ({ ...t, spaceId: s.id, doc })) : [];
        })
        .sort((a, b) => (b.deletedAt ?? -Infinity) - (a.deletedAt ?? -Infinity)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, spaces, spaceDocs, privateDocs]);
  const held = useHeld(groups.find((g) => g.kind === 'files')!.rows);
  return (
    <div class="rd" data-recently-deleted>
      {groups.map((g) => (
        <section key={g.kind} class="rd-kind" data-kind={g.kind} aria-labelledby={`rd-${g.kind}`}>
          <h3 id={`rd-${g.kind}`}>
            {g.label}
            {g.rows.length ? <span class="hint"> ({g.rows.length})</span> : null}
          </h3>
          <p class="hint">{g.keep}</p>
          {g.kind === 'files' ? <FilesNowSetting account={account} /> : null}
          {g.rows.length ? (
            <ul class="rd-list">
              {g.rows.map((r) => (
                <TrashRow key={`${r.spaceId}:${r.id}`} row={r} space={many ? (names.get(r.spaceId) ?? '') : ''} held={held.get(`${r.spaceId}:${r.id}`)} />
              ))}
            </ul>
          ) : (
            <p class="hint rd-empty">Nothing deleted.</p>
          )}
        </section>
      ))}
    </div>
  );
}
