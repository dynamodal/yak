import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import type { ViewProps } from '../app/registry';
import { Button, toast } from '../app/ui';
import { privateDocId, spaceDocId } from '../core/doc-store';
import { lineDiff } from '../core/history/diff';
import { collection } from '../core/schema';
import { compareCollection, type Comparison, restoreRecords, stateAt } from '../core/history/travel';
import { HistoryBrowser } from './HistoryBrowser';
import { clock, historyStore, runtime } from './runtime';
import { uuid } from '../core/ids';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in local time, the value of a datetime-local input. */
function toInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInput(text: string): number | null {
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const DAY = 86_400_000;
const BEFORE_RESTORE = 'Before restore';
const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface SpaceResult {
  spaceId: string;
  name: string;
  past: Y.Doc;
  current: Y.Doc;
  comparison: Comparison;
  /** Notes and tasks live in the space's shared document. */
  notesPast: Y.Doc | null;
  notesCurrent: Y.Doc | null;
  notes: Comparison;
}

const NO_CHANGES: Comparison = { changes: [], addedSince: 0 };
const countOf = (r: SpaceResult): number => r.comparison.changes.length + r.notes.changes.length;

function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '–';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '–';
  return String(v);
}

/** "Go back in time" on Backup & restore: time entries, notes and tasks as they were at a chosen time, what changed since, and a way to bring chosen ones back. */
export function HistorySection({ params }: ViewProps) {
  const { spaces, spaceDocs, privateDocs } = useApp();
  const fromAlert = Number(params[0]);
  const [at, setAt] = useState(() => toInput(Number.isFinite(fromAlert) && fromAlert > 0 ? fromAlert : Date.now() - 7 * DAY));
  /** A point chosen in the browser: its exact time (the input only has minutes). */
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (Number.isFinite(fromAlert) && fromAlert > 0) top.current?.scrollIntoView?.({ block: 'start' });
  }, []);
  const [exact, setExact] = useState<number | null>(null);
  /** The person (or an alert link) chose the time; until then the time moves to when recording began if a week ago is earlier. */
  const chosen = useRef(Number.isFinite(fromAlert) && fromAlert > 0);
  const [scope, setScope] = useState('all');
  const [results, setResults] = useState<SpaceResult[] | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [before, setBefore] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [refresh, setRefresh] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const when_ = exact ?? fromInput(at);
    if (when_ === null) return;
    let live = true;
    void (async () => {
      const out: SpaceResult[] = [];
      let begins: number | null = null;
      let none = true;
      for (const s of spaces) {
        if (scope !== 'all' && scope !== s.id) continue;
        const current = privateDocs.get(s.id);
        if (!current) continue;
        const r = await stateAt(historyStore, privateDocId(s.id), when_);
        const shared = spaceDocs.get(s.id);
        const n = shared ? await stateAt(historyStore, spaceDocId(s.id), when_) : null;
        for (const x of [r, n]) {
          if (x?.since != null) begins = begins === null ? x.since : Math.min(begins, x.since);
          if (x && !x.before) none = false;
        }
        out.push({
          spaceId: s.id,
          name: s.name,
          past: r.doc,
          current,
          comparison: compareCollection(r.doc, current, 'time_entries'),
          notesPast: n?.doc ?? null,
          notesCurrent: shared ?? null,
          notes: n && shared ? compareCollection(n.doc, shared, 'notes') : NO_CHANGES,
        });
      }
      if (!live) return;
      setResults(out);
      setSince(begins);
      setBefore(none);
      // A week ago can be before this device began recording, which reads as an error on first sight: start at the first minute it knows.
      if (none && begins !== null && !chosen.current) setAt(toInput(Math.ceil(begins / 60_000) * 60_000));
      setPicked(new Set());
    })();
    return () => {
      live = false;
    };
  }, [at, exact, scope, spaces, privateDocs, spaceDocs, refresh]);

  const projectName = useMemo(
    () => (spaceId: string, id: unknown): string => {
      const doc = spaceDocs.get(spaceId);
      const p = doc && typeof id === 'string' ? collection(doc, 'projects').get(id) : undefined;
      return p ? String(p.get('name') ?? '') : '';
    },
    [spaceDocs],
  );

  const toggle = (key: string): void => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const total = results?.reduce((n, r) => n + countOf(r), 0) ?? 0;
  const added = results?.reduce((n, r) => n + r.comparison.addedSince + r.notes.addedSince, 0) ?? 0;
  const restore = async (): Promise<void> => {
    setConfirming(false);
    // The "Before restore" mark: what the log holds now stays a point of its own, so thinning cannot merge it away.
    await runtime.recorder?.flushAll();
    const markAt = clock();
    for (const r of results ?? []) {
      for (const docId of [privateDocId(r.spaceId), spaceDocId(r.spaceId)]) {
        await historyStore.addMark({ id: uuid(), docId, noteId: '', name: BEFORE_RESTORE, at: markAt, text: '', kind: 'before-restore' });
      }
    }
    let n = 0;
    let notes = 0;
    for (const r of results ?? []) {
      const ids = r.comparison.changes.filter((c) => picked.has(`${r.spaceId}:${c.id}`)).map((c) => c.id);
      if (ids.length) n += restoreRecords(r.current, r.past, 'time_entries', ids);
      const noteIds = r.notes.changes.filter((c) => picked.has(`${r.spaceId}:note:${c.id}`)).map((c) => c.id);
      if (noteIds.length && r.notesCurrent && r.notesPast) notes += restoreRecords(r.notesCurrent, r.notesPast, 'notes', noteIds);
    }
    const parts = [];
    if (n > 0) parts.push(n === 1 ? '1 entry' : `${n} entries`);
    if (notes > 0) parts.push(notes === 1 ? '1 note' : `${notes} notes`);
    toast(`Restored ${parts.join(' and ') || 'nothing'}. The state before is kept as “${BEFORE_RESTORE}” at ${when(markAt)}.`);
    setRefresh(refresh + 1);
  };

  return (
    <section ref={top} class="history-page" id="history" aria-labelledby="history-h">
      <h2 id="history-h">Version history</h2>
      <p class="hint">
        Earlier versions of your time entries, notes and tasks. For now each device records its own; this list shows versions recorded on this device, and it cannot see further back than when this device started recording. Choose what changed or was deleted since a point and bring it back as new edits; everything else stays as it is now. Projects, clients, tags and settings are not covered here: an edit to one of them, such as a rename, cannot be undone from this list. Version history is stored in a separate database in this browser, not in a backup.
      </p>
      <div class="row history-controls">
        <label>
          As of <input type="datetime-local" aria-label="As of" value={at} onInput={(e) => {
              chosen.current = true;
              setExact(null);
              setAt((e.target as HTMLInputElement).value);
            }} />
        </label>
        {spaces.length > 1 && (
          <label>
            Space{' '}
            <select aria-label="Space to compare" value={scope} onChange={(e) => setScope((e.target as HTMLSelectElement).value)}>
              <option value="all">All spaces</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <HistoryBrowser
        spaceIds={spaces.filter((s) => scope === 'all' || scope === s.id).map((s) => s.id)}
        selected={exact}
        refresh={refresh}
        onPick={(ms) => {
          chosen.current = true;
          setExact(ms);
          setAt(toInput(ms));
        }}
      />
      {since !== null && <p class="muted history-since">Recorded on: This device, from {when(since)}.</p>}
      {results === null ? (
        <p class="empty">Reading the log…</p>
      ) : since === null ? (
        <p class="empty">This device has not recorded any history yet. It starts recording when the app opens a space.</p>
      ) : before ? (
        <p class="empty">That is before this device began recording ({when(since)}). Choose a later time.</p>
      ) : total === 0 ? (
        <p class="empty history-none">Nothing was deleted or changed since then{added ? `; ${added} entries, notes or tasks were added` : ''}.</p>
      ) : (
        <>
          {results.map((r) =>
            countOf(r) === 0 ? null : (
              <section key={r.spaceId} class="card history-space" aria-label={r.name}>
                {spaces.length > 1 && <h2>{r.name}</h2>}
                {r.comparison.changes.length > 0 && r.notes.changes.length > 0 && <h3>Time entries</h3>}
                <ul class="history-list">
                  {r.comparison.changes.map((c) => {
                    const key = `${r.spaceId}:${c.id}`;
                    const label = String(c.past.description || '(no description)');
                    const project = projectName(r.spaceId, c.past.project_id);
                    return (
                      <li key={key} class="history-row" data-entry={c.id}>
                        <label class="check">
                          <input type="checkbox" aria-label={`Restore ${label}`} checked={picked.has(key)} onChange={() => toggle(key)} />
                          <span class="history-what">
                            <strong>{label}</strong>
                            {project && <span class="muted"> · {project}</span>}
                            <span class="muted"> · {when(Date.parse(String(c.past.start)))}</span>
                          </span>
                        </label>
                        <span class={`history-kind ${c.kind}`}>
                          {c.kind === 'deleted' ? 'Deleted since' : c.kind === 'missing' ? 'Gone since' : 'Changed since'}
                        </span>
                        {c.kind === 'changed' && (
                          <ul class="history-fields">
                            {c.fields.map((f) => (
                              <li key={f.field}>
                                {f.field}: <del>{show(f.now)}</del> → {show(f.past)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {r.notes.changes.length > 0 && (
                  <>
                    {r.comparison.changes.length > 0 && <h3>Notes and tasks</h3>}
                    <ul class="history-list history-notes">
                      {r.notes.changes.map((c) => {
                        const key = `${r.spaceId}:note:${c.id}`;
                        const label = String(c.past.path || '(untitled)');
                        const textChange = c.fields.find((f) => f.field === 'text');
                        return (
                          <li key={key} class="history-row" data-note={c.id}>
                            <label class="check">
                              <input type="checkbox" aria-label={`Restore ${label}`} checked={picked.has(key)} onChange={() => toggle(key)} />
                              <span class="history-what">
                                <strong>{label}</strong>
                              </span>
                            </label>
                            <span class={`history-kind ${c.kind}`}>{c.kind === 'deleted' ? 'Deleted since' : c.kind === 'missing' ? 'Gone since' : 'Changed since'}</span>
                            {c.kind === 'changed' && (
                              <ul class="history-fields">
                                {c.fields
                                  .filter((f) => f.field !== 'text')
                                  .map((f) => (
                                    <li key={f.field}>
                                      {f.field}: <del>{show(f.now)}</del> → {show(f.past)}
                                    </li>
                                  ))}
                                {textChange && (
                                  <li>
                                    <details>
                                      <summary>Text changes</summary>
                                      <pre class="history-diff" aria-label={`Changes to ${label}`}>
                                        {lineDiff(String(textChange.past ?? ''), String(textChange.now ?? '')).map((l, i) => (
                                          <div key={i} class={`nh-${l.kind === 'added' ? 'removed' : l.kind === 'removed' ? 'added' : 'same'}`}>
                                            {l.kind === 'added' ? '- ' : l.kind === 'removed' ? '+ ' : '  '}
                                            {l.text}
                                          </div>
                                        ))}
                                      </pre>
                                      <p class="hint">Green lines come back, red lines go away.</p>
                                    </details>
                                  </li>
                                )}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            ),
          )}
          <div class="row">
            <Button variant="primary" disabled={picked.size === 0 || confirming} onClick={() => setConfirming(true)}>
              Restore selected ({picked.size})
            </Button>
            <Button
              onClick={() =>
                setPicked(new Set(results.flatMap((r) => [...r.comparison.changes.map((c) => `${r.spaceId}:${c.id}`), ...r.notes.changes.map((c) => `${r.spaceId}:note:${c.id}`)])))
              }
            >
              Select all
            </Button>
          </div>
          {confirming && (
            <div class="confirm-restore card" role="group" aria-label="Confirm restore">
              <p>
                Bring back {picked.size === 1 ? '1 item' : `${picked.size} items`} as they were at {when(exact ?? fromInput(at) ?? Date.now())}? They are written as new edits, and later work stays.
                The state from before is kept in Version history as “{BEFORE_RESTORE}”. To undo, choose that point under Days with changes and restore from it.
              </p>
              <div class="row">
                <Button variant="primary" onClick={() => void restore()}>
                  Restore
                </Button>
                <Button onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
