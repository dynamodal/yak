// Alt+S starts the timer and asks the pill to open its popover. The command (time/index.ts) and the pill
// (HeaderTimer.tsx) meet through one window event, so neither imports the other.
const EVENT = 'app:timer-popover';

export interface PopoverRequest {
  /** Where focus was when the key was pressed; Escape in the popover returns it there. */
  returnTo: HTMLElement | null;
}

export function requestTimerPopover(returnTo: Element | null): void {
  const el = returnTo instanceof HTMLElement && returnTo !== document.body ? returnTo : null;
  window.dispatchEvent(new CustomEvent<PopoverRequest>(EVENT, { detail: { returnTo: el } }));
}

export function onTimerPopoverRequest(handler: (req: PopoverRequest) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<PopoverRequest>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
