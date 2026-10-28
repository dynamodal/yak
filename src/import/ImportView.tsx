import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, Field, Page, PageHeader } from '../app/ui';
import { buildPlan, type ImportPlan, PlanAborted, type ParsedFile, parseTogglFileAsync, readExisting } from './plan';
import { runImport, type RunResult } from './run';
import { browserTimeZone, isValidTimeZone, timeZoneChoices } from './zone';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const LISTED_ERRORS = 20;

const hours = (seconds: number): string => `${(seconds / 3600).toFixed(2)} h`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

interface Loaded {
  /** Counts up with every file chosen, so choosing the same file again plans again. */
  seq: number;
  name: string;
  parsed: ParsedFile;
}

/** A finished plan (or the reason it failed) and the settings it was made for. */
interface PlanState {
  key: string;
  plan?: ImportPlan;
  failure?: string;
}

export function ImportView() {
  const { spaceDocs, privateDocs, spaceId, deviceId, spaces } = useApp();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [zone, setZone] = useState(() => browserTimeZone());
  const [target, setTarget] = useState(spaceId);
  const [planState, setPlanState] = useState<PlanState | null>(null);
  const seq = useRef(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<{ result: RunResult; space: string } | null>(null);
  const cancel = useRef<AbortController | null>(null);
  const zones = useRef(timeZoneChoices([browserTimeZone()]));

  const importing = progress !== null;
  const doc = spaceDocs.get(target);
  // A plan counts only for the file, zone and space it was made for, so numbers are never stale.
  const planKey = loaded ? `${loaded.seq}|${zone}|${target}` : '';
  const current = planState && planState.key === planKey ? planState : null;
  const plan = current?.plan ?? null;
  const planning = !!loaded && !current;

  // Recompute the preview when the file, the time zone or the space changes.
  useEffect(() => {
    if (!loaded || !doc || importing) return;
    const controller = new AbortController();
    const key = `${loaded.seq}|${zone}|${target}`;
    buildPlan(loaded.parsed, readExisting(doc, privateDocs.get(target)), { zone, signal: controller.signal })
      .then((p) => {
        if (!controller.signal.aborted) setPlanState({ key, plan: p });
      })
      .catch((e: unknown) => {
        if (e instanceof PlanAborted || controller.signal.aborted) return;
        setPlanState({ key, failure: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
  }, [loaded, doc, zone, target, importing]);

  const reset = (): void => {
    setLoaded(null);
    setPlanState(null);
    setOutcome(null);
    setError('');
  };

  const readFile = async (file: File): Promise<void> => {
    reset();
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is larger than 100 MB. Export a shorter date range from Toggl.`);
      return;
    }
    setReading(file.name);
    try {
      const content = await file.text();
      setLoaded({ seq: ++seq.current, name: file.name, parsed: await parseTogglFileAsync(content) });
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading('');
    }
  };

  const onPick = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void readFile(file);
    input.value = '';
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void readFile(file);
  };

  const start = async (): Promise<void> => {
    if (!loaded || !doc) return;
    const controller = new AbortController();
    cancel.current = controller;
    setError('');
    setProgress({ done: 0, total: plan?.entries.length ?? 0 });
    try {
      // Plan again against the document as it is now, so a cancelled run can be repeated safely.
      const fresh = await buildPlan(loaded.parsed, readExisting(doc, privateDocs.get(target)), { zone });
      setProgress({ done: 0, total: fresh.entries.length });
      const result = await runImport(doc, fresh, {
        entriesDoc: privateDocs.get(target),
        deviceId,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setOutcome({ result, space: target });
      setLoaded(null);
      setPlanState(null);
    } catch (e) {
      setError(`The import stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      cancel.current = null;
      setProgress(null);
    }
  };

  const spaceName = (id: string): string => spaces.find((s) => s.id === id)?.name ?? id;
  const nothingNew = !!plan && plan.entries.length === 0;
  const canImport = !!plan && plan.fileProblems.length === 0 && !nothingNew && !planning && !importing;

  return (
    <Page width="settings" class="imp">
      <PageHeader title="Import" />
      <p class="hint">
        Bring in a Toggl Track Detailed report exported as CSV. Nothing leaves this device. Importing the same file again does not add anything twice.
      </p>
      <p class="hint">
        In Toggl Track: Reports › Detailed, pick a date range, then Export › CSV. <a href="#/help/import">Step by step in Help</a>.
      </p>

      {!importing && (
        <label class={`imp-drop${dragging ? ' dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <span class="imp-drop-title">{loaded ? 'Choose a different file' : 'Choose a Toggl CSV file'}</span>
          <span class="hint">or drop it here</span>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onPick} aria-label="Toggl CSV file" />
        </label>
      )}

      <p role="status" class="hint">
        {reading ? `Reading ${reading}…` : planning ? 'Checking the file…' : ''}
      </p>

      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}

      {outcome && <Outcome result={outcome.result} space={spaceName(outcome.space)} onAgain={reset} />}

      {loaded && !outcome && (
        <div class="card imp-preview" aria-label="Import preview">
          <h2>{loaded.name}</h2>
          <div class="imp-settings">
            <Field label="Import into">
              <select value={target} disabled={importing} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Time zone of the export">
              <select
                value={zone}
                disabled={importing}
                onChange={(e) => {
                  const z = (e.target as HTMLSelectElement).value;
                  if (isValidTimeZone(z)) setZone(z);
                }}
              >
                {zones.current.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p class="hint">Toggl writes times without a time zone. Pick the zone your Toggl account used when you exported, normally the one shown here.</p>

          {current?.failure && (
            <p class="error" role="alert">
              Could not check the file: {current.failure}
            </p>
          )}
          {plan && <PlanSummary plan={plan} />}

          {importing && progress && (
            <div class="imp-progress">
              <progress max={Math.max(progress.total, 1)} value={progress.done} aria-label="Import progress" />
              <span role="status">
                {progress.done} of {progress.total} entries
              </span>
              <Button onClick={() => cancel.current?.abort()}>
                Cancel
              </Button>
            </div>
          )}

          <div class="row">
            <Button variant="primary" disabled={!canImport} onClick={() => void start()}>
              {plan && plan.entries.length > 0 ? `Import ${plural(plan.entries.length, 'entry', 'entries')}` : 'Import'}
            </Button>
            <Button disabled={importing} onClick={reset}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}

function PlanSummary({ plan }: { plan: ImportPlan }) {
  if (plan.fileProblems.length > 0) {
    return (
      <div class="error" role="alert">
        <p>This file cannot be imported:</p>
        <ul>
          {plan.fileProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {plan.ignoredColumns.length > 0 && <p class="hint">Columns found: {[...plan.recognisedColumns, ...plan.ignoredColumns].join(', ')}.</p>}
      </div>
    );
  }
  const duplicates = plan.duplicatesInFile + plan.duplicatesExisting;
  return (
    <>
      <dl class="imp-counts">
        <dt>Entries to import</dt>
        <dd>{plan.entries.length}</dd>
        <dt>Total hours</dt>
        <dd>{hours(plan.totalSeconds)}</dd>
        <dt>Date range</dt>
        <dd>{plan.firstDay ? (plan.firstDay === plan.lastDay ? plan.firstDay : `${plan.firstDay} to ${plan.lastDay}`) : 'none'}</dd>
        <dt>New projects</dt>
        <dd>{plan.newProjects}</dd>
        <dt>New clients</dt>
        <dd>{plan.newClients}</dd>
        <dt>New tags</dt>
        <dd>{plan.newTags.length}</dd>
        <dt>Skipped duplicates</dt>
        <dd>
          {duplicates}
          {duplicates > 0 && (
            <span class="hint">
              {' '}
              ({plan.duplicatesExisting} already imported, {plan.duplicatesInFile} repeated in the file)
            </span>
          )}
        </dd>
        <dt>Rows with errors</dt>
        <dd>{plan.errorCount}</dd>
      </dl>
      {plan.entries.length === 0 && <p>There is nothing new to import from this file.</p>}
      {plan.warnings.length > 0 && (
        <ul class="imp-warnings">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {plan.errorCount > 0 && (
        <details class="imp-errors" open={plan.errorCount <= 5}>
          <summary>
            Rows that will be skipped ({plan.errorCount})
          </summary>
          <ul>
            {plan.errors.slice(0, LISTED_ERRORS).map((e) => (
              <li key={e.line}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
          {plan.errorCount > LISTED_ERRORS && <p class="hint">And {plan.errorCount - LISTED_ERRORS} more.</p>}
        </details>
      )}
    </>
  );
}

function Outcome({ result, space, onAgain }: { result: RunResult; space: string; onAgain(): void }) {
  return (
    <div class="card imp-done" role="status">
      <h2>{result.cancelled ? 'Import stopped' : 'Import finished'}</h2>
      <p>
        {result.cancelled
          ? `Added ${result.created} of ${result.total} entries to ${space} before you cancelled. Choose the same file again to add the rest; entries already added are skipped.`
          : `Added ${plural(result.created, 'entry', 'entries')} to ${space}, with ${plural(result.createdProjects, 'new project')}, ${plural(result.createdClients, 'new client')} and ${plural(result.createdTags, 'new tag')}.`}
      </p>
      <div class="row">
        <a href="#/entries">Entries</a>
        <a href="#/time/reports">Reports</a>
        <Button onClick={onAgain}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
