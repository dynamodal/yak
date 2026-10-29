import { useEffect, useState } from 'preact/hooks';
import type { EntryFields } from './entries';

/** What the Time page's bar holds before a start. `spaceId` is the space chosen in the popover (a project's space or the space picker); null means the latest entry's space (T-62). */
export type Draft = Pick<EntryFields, 'description' | 'project_id' | 'tags' | 'billable'> & { spaceId: string | null };

export const EMPTY_DRAFT: Draft = { description: '', project_id: null, tags: [], billable: false, spaceId: null };

let draft: Draft = EMPTY_DRAFT;
const listeners = new Set<() => void>();

/** The bar's draft lives here (not in the bar) so the header's start button starts with what was typed. */
export function getDraft(): Draft {
  return draft;
}

export function setDraft(next: Draft | ((d: Draft) => Draft)): void {
  draft = typeof next === 'function' ? next(draft) : next;
  for (const l of listeners) l();
}

export function useDraft(): Draft {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = (): void => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return draft;
}
