import { useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, Dialog, IconBillable, toast } from '../app/ui';
import { ensureTag } from './catalog';
import { addManualEntry } from './entries';
import { type TimeData, useCatalogs } from './hooks';
import { endsNextDay, manualDefaults, manualProblem, manualRange } from './manual-entry';
import { ProjectPicker, TagPicker } from './pickers';
import { DescriptionField } from './widgets';

interface Form {
  description: string;
  project_id: string | null;
  tags: string[];
  billable: boolean;
  /** The project's space; without a project, the active space. */
  spaceId: string | null;
}

const EMPTY: Form = { description: '', project_id: null, tags: [], billable: false, spaceId: null };

/**
 * "Add entry" on the Time page (F-33m): the form for a finished entry that the timer bar used to hold as its clock mode.
 * Description, project, tags, billable, a date and a from and to time; a to time before from means the next day; equal times are rejected.
 */
export function ManualEntryDialog({ data, onClose }: { data: TimeData; onClose(): void }) {
  const { setSpaceId } = useApp();
  const catalogs = useCatalogs();
  const [form, setForm] = useState<Form>(EMPTY);
  const [times, setTimes] = useState(() => manualDefaults());
  const [error, setError] = useState('');
  const spaceId = form.spaceId ?? data.spaceId;
  const space = catalogs.find((c) => c.spaceId === spaceId);
  const patch = (p: Partial<Form>): void => setForm((f) => ({ ...f, ...p }));

  const add = (): void => {
    const range = manualRange(times.date, times.from, times.to);
    const doc = data.controller.privateDocs.get(spaceId);
    if (!range || !doc || !space) {
      setError(manualProblem(times.from, times.to));
      return;
    }
    const tags = form.tags.map((t) => ensureTag(space.doc, t) ?? t);
    const r = addManualEntry(doc, data.deviceId, { ...range, description: form.description, project_id: form.project_id, tags, billable: form.billable }, space.doc);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSpaceId(spaceId);
    onClose();
    toast('Entry added.');
  };

  return (
    <Dialog label="Add entry" class="manual-dialog" onClose={onClose}>
      <h2 class="manual-title">Add entry</h2>
      <form
        class="manual-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <DescriptionField
          value={form.description}
          placeholder="What did you work on?"
          onText={(t) => patch({ description: t })}
          onCommit={(t) => patch({ description: t })}
          onEnter={add}
          onPick={(e) => patch({ spaceId: e.project_id ? (e.spaceId ?? data.spaceId) : null, description: e.description, project_id: e.project_id, tags: e.tags, billable: e.billable })}
        />
        <div class="tp-fields">
          <ProjectPicker
            spaces={catalogs}
            spaceId={spaceId}
            projectId={form.project_id}
            onChange={(sid, id) => {
              const project = id ? catalogs.find((c) => c.spaceId === sid)?.projectById.get(id) : undefined;
              patch({ spaceId: id ? sid : null, project_id: id, ...(project ? { billable: project.billable } : {}) });
            }}
            showSpace={spaceId !== data.spaceId}
          />
          <TagPicker value={form.tags} known={space?.tagNames ?? data.tagNames} onChange={(tags) => patch({ tags })} onCreate={(n) => (space ? ensureTag(space.doc, n) : n)} />
          <button type="button" class={form.billable ? 'tp-billable on' : 'tp-billable'} aria-pressed={form.billable} title={form.billable ? 'Billable' : 'Not billable'} onClick={() => patch({ billable: !form.billable })}>
            <IconBillable />
            <span>Billable</span>
          </button>
        </div>
        <div class="manual-times" role="group" aria-label="When">
          <input type="date" aria-label="Date" value={times.date} onInput={(e) => setTimes((t) => ({ ...t, date: (e.target as HTMLInputElement).value }))} />
          <span class="manual-range">
            <input type="time" aria-label="From" value={times.from} onInput={(e) => setTimes((t) => ({ ...t, from: (e.target as HTMLInputElement).value }))} />
            <span class="muted" aria-hidden="true">
              –
            </span>
            <input type="time" aria-label="To" value={times.to} onInput={(e) => setTimes((t) => ({ ...t, to: (e.target as HTMLInputElement).value }))} />
          </span>
        </div>
        {endsNextDay(times.from, times.to) && <p class="hint manual-next-day">Ends the next day.</p>}
        {error ? (
          <p class="error" role="alert">
            {error}
          </p>
        ) : null}
        <div class="tp-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit">
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
