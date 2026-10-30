// Kept apart from the dialog so the Alt+Q command registers without loading it (#138).
export const QUICK_ADD_EVENT = 'tasks:quick-add';

/** Ask the host to open the quick-add modal; the opener's focus is restored when it closes. */
export function openQuickAdd(): void {
  window.dispatchEvent(new Event(QUICK_ADD_EVENT));
}
