import type { ComponentChildren, KeyboardEventHandler, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import { nextMenuIndex, placeBelow } from './popover-logic';

export interface PopoverProps {
  open: boolean;
  /** The control that opened it: the popover sits under it and focus returns to it on close. */
  anchor: RefObject<HTMLElement | null>;
  onClose(): void;
  /** Accessible name of the popover. */
  label: string;
  /** Align the popover's left edge (start) or right edge (end) with the anchor. */
  align?: 'start' | 'end';
  role?: 'dialog' | 'menu';
  id?: string;
  class?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** The panel element, for callers that move focus inside it. */
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ComponentChildren;
}

/** Open popovers, innermost last: Escape closes only the innermost, so a picker inside a popover does not close its host. */
const openStack: symbol[] = [];

/**
 * A floating panel under a control. Escape, a click outside or Tab away closes it; focus returns to
 * the anchor on Escape. Positioned with element.style (allowed by the CSP, unlike style attributes).
 */
export function Popover({ open, anchor, onClose, label, align = 'start', role = 'dialog', id, class: extra, onKeyDown, panelRef, children }: PopoverProps) {
  const own = useRef<HTMLDivElement>(null);
  const panel = panelRef ?? own;
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const a = anchor.current;
      const p = panel.current;
      if (!a || !p) return;
      const { top, left } = placeBelow(a.getBoundingClientRect(), p.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, align);
      p.style.top = `${top}px`;
      p.style.left = `${left}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, anchor, panel]);

  useEffect(() => {
    if (!open) return;
    const me = Symbol('popover');
    openStack.push(me);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== me) return;
      e.preventDefault();
      close.current();
      anchor.current?.focus();
    };
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const onFocus = (e: FocusEvent): void => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocus);
    return () => {
      openStack.splice(openStack.indexOf(me), 1);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open, anchor, panel]);

  if (!open) return null;
  return (
    <div ref={panel} id={id} class={cx('popover', role === 'menu' && 'menu', extra)} role={role} aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect(): void;
  icon?: ComponentChildren;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuProps extends Omit<PopoverProps, 'role' | 'children'> {
  items: readonly MenuItem[];
}

/** A list of actions in a popover. Arrow keys, Home and End move between items; Enter or Space picks one. */
export function Menu({ items, onClose, anchor, ...rest }: MenuProps) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = (): HTMLButtonElement[] => [...(list.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
  const disabled = items.map((i) => !!i.disabled);

  // Layout effect: focus moves before the next key press can arrive.
  useLayoutEffect(() => {
    if (!rest.open) return;
    const first = nextMenuIndex(-1, 'ArrowDown', disabled);
    if (first >= 0) buttons()[first]?.focus();
  }, [rest.open]);

  return (
    <Popover
      {...rest}
      anchor={anchor}
      onClose={onClose}
      role="menu"
      panelRef={list}
      onKeyDown={(e) => {
        const all = buttons();
        const at = all.indexOf(document.activeElement as HTMLButtonElement);
        const next = nextMenuIndex(at, e.key, disabled);
        if (next === at || next < 0) return;
        e.preventDefault();
        all[next]?.focus();
      }}
    >
      {items.map((item) => (
        <Button
          key={item.label}
          role="menuitem"
          variant="quiet"
          class={cx('menu-item', item.danger && 'danger')}
          disabled={item.disabled}
          tabIndex={-1}
          onClick={() => {
            onClose();
            anchor.current?.focus();
            item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </Button>
      ))}
    </Popover>
  );
}

export interface MenuButtonProps {
  /** Accessible name of the button, e.g. "More actions for Design review". */
  label: string;
  icon: ComponentChildren;
  items: readonly MenuItem[];
  align?: 'start' | 'end';
  class?: string;
}

/** An icon button that opens a Menu, e.g. a row's "more actions". */
export function MenuButton({ label, icon, items, align = 'end', class: extra }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <IconButton
        buttonRef={anchor}
        class={extra}
        label={label}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      />
      <Menu id={id} open={open} anchor={anchor} onClose={() => setOpen(false)} label={label} align={align} items={items} />
    </>
  );
}
