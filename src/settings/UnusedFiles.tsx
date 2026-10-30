import { useEffect, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { Button } from '../app/ui';
import type { ViewProps } from '../app/registry';
import { attachmentsMap, listAttachments, type Attachment } from '../core/blobs/attachments';
import { WARN_FRACTION, formatBytes } from '../core/blobs/limits';
import { blobStore } from '../core/blobs/store';
import { deleteFiles, spaceFiles, unreferencedFiles, type SpaceFiles } from '../core/blobs/unused';
import { readDeleteFilesNow, TRASH_DAYS } from '../core/trash';

/** Re-render when the space's notes or file index change. */
function useChanges(doc: Y.Doc): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = (): void => setN((x) => x + 1);
    const attachments = attachmentsMap(doc);
    const notes = doc.getMap('notes');
    attachments.observeDeep(bump);
    notes.observeDeep(bump);
    return () => {
      attachments.unobserveDeep(bump);
      notes.unobserveDeep(bump);
    };
  }, [doc]);
  return n;
}

function SpaceUnused({ name, unit, doc }: { name: string; unit: string; doc: Y.Doc }) {
  const { account } = useApp();
  const changes = useChanges(doc);
  const now = readDeleteFilesNow(account);
  const [usage, setUsage] = useState<SpaceFiles | undefined>();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const unused: Attachment[] = unreferencedFiles(doc);
  const total = listAttachments(doc).length;
  useEffect(() => {
    let live = true;
    void spaceFiles(doc, blobStore(unit)).then((u) => live && setUsage(u), () => undefined);
    return () => {
      live = false;
    };
  }, [doc, unit, changes]);

  const remove = async (hashes: string[]): Promise<void> => {
    setError('');
    try {
      await deleteFiles(doc, blobStore(unit), hashes, { straightAway: readDeleteFilesNow(account) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setConfirm('');
  };
  const bytes = unused.reduce((n, a) => n + a.size, 0);
  return (
    <div class="card st-group unused-files" data-space={unit}>
      <h3>{name}</h3>
      <p class="hint">
        {total === 0 ? 'No files in this space' : `${total} file${total === 1 ? '' : 's'}`}
        {usage && usage.held > 0 ? `, ${formatBytes(usage.held)} on this device of ${formatBytes(usage.limit)}` : ''}.
      </p>
      {usage && usage.fraction >= WARN_FRACTION ? (
        <p class="error" role="alert">
          Files in this space use {Math.round(usage.fraction * 100)}% of the space available. Delete files you no longer need, or back them up.
        </p>
      ) : null}
      {total > 0 && unused.length === 0 ? <p class="hint">Every file is used in a note.</p> : null}
      {unused.length > 0 && (
        <>
          <p>
            <strong>
              {unused.length} unused file{unused.length === 1 ? '' : 's'}
            </strong>{' '}
            ({formatBytes(bytes)}): no note refers to {unused.length === 1 ? 'it' : 'them'}. Nothing is deleted by itself.
          </p>
          <ul class="unused-list">
            {unused.map((a) => (
              <li key={a.hash} data-name={a.name}>
                <span class="unused-name">{a.name}</span> <span class="hint">{formatBytes(a.size)}</span>{' '}
                {confirm === a.hash ? (
                  <>
                    <Button variant="danger" onClick={() => void remove([a.hash])}>
                      Delete for everyone
                    </Button>{' '}
                    <Button onClick={() => setConfirm('')}>Cancel</Button>
                  </>
                ) : (
                  <Button aria-label={`Delete ${a.name}`} onClick={() => setConfirm(a.hash)}>
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p class="hint">
            A delete removes the file on every device that keeps this space, and in a shared space for everyone in it.{' '}
            {now ? (
              <>Files are deleted for good straight away (<a href="#/settings/recently-deleted">Recently deleted</a>); only a backup can bring one back.</>
            ) : (
              <>
                <a href="#/settings/recently-deleted">Recently deleted</a> keeps it, contents included, for {TRASH_DAYS} days.
              </>
            )}
          </p>
        </>
      )}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Files no note refers to, per space, with a Delete button each (decision N-166j). */
export function UnusedFiles(_props: ViewProps) {
  const { spaces, spaceDocs } = useApp();
  return (
    <>
      {spaces.map((s) => {
        const doc = spaceDocs.get(s.id);
        return doc ? <SpaceUnused key={s.id} name={s.name} unit={s.id} doc={doc} /> : null;
      })}
    </>
  );
}
