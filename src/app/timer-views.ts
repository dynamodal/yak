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
