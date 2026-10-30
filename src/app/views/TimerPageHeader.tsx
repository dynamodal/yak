import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { PageHeader } from '../ui';
import { SpaceFilterButton } from '../space-filter';
import { registeredViews } from '../registry';
import { rememberTimerView, timerViewItems } from '../timer-views';

/**
 * The header of the Time page and of the views that join it (Reports): the List | Week | Reports switch and the one
 * space filter (behind a Filters button, only with two or more spaces). The shell owns it so `time` and `reports` never import each other (R-335). `active` is the segment shown.
 */
export function TimerPageHeader({ title, active, parent = 'timer', primary }: { title: string; active: string; parent?: string; primary?: ComponentChildren }) {
  useEffect(() => rememberTimerView(active), [active]);
  const items = timerViewItems(parent);
  const path = registeredViews().find((v) => v.id === parent)?.path ?? parent;
  return (
    <PageHeader
      title={title}
      hideTitle
      anchor
      views={
        <nav class="seg" aria-label="Time views">
          {items.map((m) => (
            <a key={m.id} href={`#/${path}/${m.id}`} class={m.id === active ? 'active' : ''} aria-current={m.id === active ? 'page' : undefined}>
              {m.label}
            </a>
          ))}
        </nav>
      }
      filters={<SpaceFilterButton />}
      primary={primary}
    />
  );
}
