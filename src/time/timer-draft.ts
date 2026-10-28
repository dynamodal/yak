import { useEffect, useState } from 'preact/hooks';
import type { EntryFields } from './entries';

/** What the Timer page's bar holds before a start. `spaceId` is the project's space; without a project, the page's space. */
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
