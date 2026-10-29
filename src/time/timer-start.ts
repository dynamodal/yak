import { ensureTag } from './catalog';
import type { TimeController } from './controller';
import type { TimeDocs } from './entries';
import { EMPTY_DRAFT, getDraft, setDraft } from './timer-draft';

/**
 * Start a timer with what was typed in the pill's popover (the shared draft, H-21), then clear the draft. The entry goes to the
 * chosen project's space (which then becomes the active space, X20), else `spaceId` (the active space, H4). Tags are names: the target space gets a record for each.
 */
export function startFromDraft(controller: TimeController, spaceId: string, catalogDocs: TimeDocs, setSpaceId?: (id: string) => void): string {
  const d = getDraft();
  const sid = d.project_id && d.spaceId && catalogDocs.has(d.spaceId) ? d.spaceId : spaceId;
  const doc = catalogDocs.get(sid);
  const tags = doc ? d.tags.map((t) => ensureTag(doc, t) ?? t) : [...d.tags];
  const id = controller.start(sid, { description: d.description, project_id: d.project_id, tags, billable: d.billable });
  setDraft(EMPTY_DRAFT);
  // New entries go to the last used space (X20): a project in another space makes that space the active one.
  if (sid !== spaceId) setSpaceId?.(sid);
  return id;
}
