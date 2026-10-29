import type { ComponentChildren } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { Button } from './Button';
import { Popover } from './Popover';
import { IconFilter } from './icons';

export interface FiltersButtonProps {
  /** How many filters differ from their defaults; shown on the button and in its name. */
  count: number;
  /** Puts every filter back to its default; the panel offers it only while `count` is above 0. */
  onClear?(): void;
  /** The filter controls (selects, inputs), each in a `Field` or a label. */
  children: ComponentChildren;
  /** Accessible name of the panel; default "Filters". */
  label?: string;
  /** On phones show only the icon and the count; the label stays as the accessible name. */
  compact?: boolean;
}

/**
 * One "Filters" button for a page header. The controls sit in a popover, so a list's first row is not pushed down by
 * four selects; the count says that some are active (F-33v). Escape or a click outside closes it.
 */
export function FiltersButton({ count, onClear, children, label = 'Filters', compact }: FiltersButtonProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <Button
        buttonRef={anchor}
        class={compact ? 'filters-btn filters-compact' : 'filters-btn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={count > 0 ? `${label}, ${count} active` : label}
        onClick={() => setOpen(!open)}
      >
        <IconFilter />
        <span>{label}</span>
        {count > 0 && (
          <span class="filters-count" aria-hidden="true">
            {count}
          </span>
        )}
      </Button>
      <Popover id={id} open={open} anchor={anchor} onClose={() => setOpen(false)} label={label} align="start" class="filters-panel">
        <div class="filters-body">{children}</div>
        {onClear && count > 0 && (
          <div class="filters-foot">
            <Button variant="quiet" onClick={onClear}>
              Clear filters
            </Button>
          </div>
        )}
      </Popover>
    </>
  );
}
