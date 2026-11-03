import { joinedViews, registeredViews } from './registry';

const KEY = 'timer-view';

/** The last view of the Time page used on this device (X24): `list`, `week`, or the path of a joined view such as `reports`. */
export function savedTimerView(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberTimerView(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}

export interface TimerViewItem {
  id: string;
  label: string;
}

/** The segments of the Time page switch: the page's own modes, then the views that join it (Reports). */
export function timerViewItems(parentId: string): TimerViewItem[] {
  const parent = registeredViews().find((v) => v.id === parentId);
  return [...(parent?.modes ?? []), ...joinedViews(parentId).map((v) => ({ id: v.path, label: v.joinLabel ?? v.title }))];
}

/** The remembered view, when it is one that joins the page and this device shows (not hidden in Features). */
export function savedJoinedView(parentId: string): string | undefined {
  const saved = savedTimerView();
  return saved !== undefined && joinedViews(parentId).some((v) => v.path === saved) ? saved : undefined;
}

const SPAN_KEY = 'timeline-span';

export type TimelineSpan = 'day' | 'week';

/** The Day or Week choice of the Calendar on this device; anything else stored (or no storage) reads as unset. */
export function savedTimelineSpan(): TimelineSpan | undefined {
  try {
    const v = localStorage.getItem(SPAN_KEY);
    return v === 'day' || v === 'week' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function rememberTimelineSpan(span: TimelineSpan): void {
  try {
    localStorage.setItem(SPAN_KEY, span);
  } catch {
    // ignore
  }
}

const ZOOM_KEY = 'timeline-zoom';

/** The Calendar's pixels per hour on this device; the view accepts only its own levels, so anything else reads as unset. */
export function savedTimelineZoom(): number | undefined {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function rememberTimelineZoom(hourPx: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(hourPx));
  } catch {
    // ignore
  }
}
