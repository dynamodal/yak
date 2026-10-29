// Kept apart from the switcher dialog so the Ctrl+O command registers without loading the Notes view.
// Ctrl/Cmd+K anywhere in the app asks for the switcher; the notes view shows it.
let pending = false;
const listeners = new Set<() => void>();

export function requestSwitcher(): void {
  pending = true;
  for (const l of listeners) l();
}

/** Subscribe to switcher requests; returns true once if a request is pending (and clears it). */
export function onSwitcherRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function takeSwitcherRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}
