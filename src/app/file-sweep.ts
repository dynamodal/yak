import type * as Y from 'yjs';
import type { DocumentStore } from '../core/doc-store';
import { attachmentsMap } from '../core/blobs/attachments';
import { blobStore } from '../core/blobs/store';
import { DELETE_FILES_NOW, readDeleteFilesNow } from '../core/trash';

/** How often an open tab looks again for deleted files whose 45 days have passed. */
const RECHECK_MS = 6 * 3600_000;

/**
 * A file deleted in a space (Settings, Recently deleted, or the mirror folder) is deleted for everyone. Its bytes
 * stay while Recently deleted keeps it (B-107) and go when it is deleted for good or its 45 days pass; with the
 * account setting "Delete files for good straight away" every deleted file is deleted for good when this device sees it.
 */
export function startFileSweep(store: DocumentStore, account: () => Y.Doc | undefined): () => void {
  const watched = new Map<string, Y.Doc>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sweep = (id: string, doc: Y.Doc): void => {
    const unit = /^space\/([^/]+)$/.exec(id)?.[1];
    if (!unit) return;
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(
        () =>
          void import('../core/blobs/unused')
            .then((m) => m.dropDeletedBytes(doc, blobStore(unit), { straightAway: readDeleteFilesNow(account()) }))
            .catch(() => undefined),
        500,
      ),
    );
  };
  const sweepAll = (): void => watched.forEach((doc, id) => sweep(id, doc));
  const watch = (id: string, doc: Y.Doc): void => {
    if (watched.has(id) || !/^space\/[^/]+$/.test(id)) return;
    watched.set(id, doc);
    attachmentsMap(doc).observeDeep(() => sweep(id, doc));
    sweep(id, doc);
  };
  for (const [id, doc] of store.opened()) watch(id, doc);
  const settings = account()?.getMap<unknown>('settings');
  const onSetting = (e: Y.YMapEvent<unknown>): void => {
    if (e.keysChanged.has(DELETE_FILES_NOW)) sweepAll();
  };
  settings?.observe(onSetting);
  const recheck = setInterval(sweepAll, RECHECK_MS);
  const stop = store.onOpened(watch);
  return () => {
    stop();
    clearInterval(recheck);
    settings?.unobserve(onSetting);
    timers.forEach((t) => clearTimeout(t));
  };
}
