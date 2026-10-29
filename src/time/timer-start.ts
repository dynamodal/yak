import { ensureTag } from './catalog';
import type { TimeController } from './controller';
import { liveEntries, startMs, type TimeDocs } from './entries';
import { isoToMs } from './dates';
import { EMPTY_DRAFT, getDraft, setDraft } from './timer-draft';

/**
 * The space a timer without a project starts in (T-62): the space of the entry made last (`created_at`, else its start; an edited start does not count) on this device.
 * `fallback` (the active space) when there are no entries yet. Opening a note changes the active space, never this.
 */
export function timerSpace(privateDocs: TimeDocs, fallback: string): string {
  let best = fallback;
  let bestMs = -1;
  for (const [sid, doc] of privateDocs) {
    for (const e of liveEntries(doc)) {
      const made = isoToMs(e.created_at);
      const ms = Number.isNaN(made) ? startMs(e) : made;
      if (ms > bestMs) {
        bestMs = ms;
        best = sid;
      }
    }
  }
  return best;
}

/**
 * Start a timer with what was typed in the pill's popover (the shared draft, H-21), then clear the draft. The entry goes to the
 * space chosen in the popover (a project's space, or the space picker) (which then becomes the active space, X20), else the space of the latest entry (T-62), or `spaceId` (the active space, H4) when there are none. Tags are names: the target space gets a record for each.
 */
export function startFromDraft(controller: TimeController, spaceId: string, catalogDocs: TimeDocs, setSpaceId?: (id: string) => void): string {
  const d = getDraft();
  const fromProject = !!(d.spaceId && catalogDocs.has(d.spaceId));
  const sid = fromProject ? (d.spaceId as string) : timerSpace(controller.privateDocs, spaceId);
  const doc = catalogDocs.get(sid);
  const tags = doc ? d.tags.map((t) => ensureTag(doc, t) ?? t) : [...d.tags];
  const id = controller.start(sid, { description: d.description, project_id: d.project_id, tags, billable: d.billable });
  setDraft(EMPTY_DRAFT);
  // New entries go to the last used space (X20): a project in another space makes that space the active one.
  if (fromProject && sid !== spaceId) setSpaceId?.(sid);
  return id;
}
