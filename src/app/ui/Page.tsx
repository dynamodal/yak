import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from './cx';
import { IconCheck, IconMore } from './icons';
import { MenuButton, type MenuItem } from './Popover';
import { Button } from './Button';
import { pageMenuItems, pageSelect, setPageMenu, setPageSelect, subscribePageMenu, type PageSelect } from './page-header-store';

/** The page widths (sizes are tokens): a centred list, the full width, a settings form, two settings columns side by side. */
export type PageWidth = 'list' | 'workspace' | 'settings' | 'wide';

export interface PageProps {
  width: PageWidth;
  /** Extra classes for the module's own layout; never a page width. */
  class?: string;
  children?: ComponentChildren;
}

/** The root of a page: sets its width. Put a PageHeader first. */
export function Page({ width, class: extra, children }: PageProps) {
  return <section class={cx('page', `page-${width}`, extra)}>{children}</section>;
}

export interface PageHeaderProps {
  title: string;
  /** Hide the title visually (screen readers still read it) where the tab already says it. */
  hideTitle?: boolean;
  /** The page's one `FiltersButton`, after the view switch. */
  filters?: ComponentChildren;
  /** View switch: a `.seg` of links. */
  views?: ComponentChildren;
  /** Space filter or picker. */
  space?: ComponentChildren;
  /** Items for the "…" menu, after those the page's lists add with `usePageMenu`. */
  menu?: readonly MenuItem[];
  /** The page's one primary action. */
  primary?: ComponentChildren;
  /** Keep the header at list width, centred, on a page whose width changes with the view (Time, Tasks), so the view switch stays put. */
  anchor?: boolean;
}

/**
 * Same slots on every page, in this order: title, view switch, filters, space, Select, "…" menu, primary action.
 * A slot with nothing in it takes no room.
 */
export function PageHeader({ title, hideTitle, filters, views, space, menu = [], primary, anchor }: PageHeaderProps) {
  const [added, setAdded] = useState(pageMenuItems);
  useEffect(() => {
    const sync = (): void => setAdded(pageMenuItems());
    sync();
    return subscribePageMenu(sync);
  }, []);
  const items = [...added, ...menu];
  return (
    <header class={cx('page-header', anchor && 'page-header-anchor')}>
      <h1 class={hideTitle ? 'visually-hidden' : undefined}>{title}</h1>
      <div class="page-header-tools toolbar">
        {views}
        {filters && <div class="page-filters">{filters}</div>}
        {space}
        <PageSelectButton />
        {items.length > 0 && <MenuButton label="Page actions" icon={<IconMore />} items={items} />}
        {primary}
      </div>
    </header>
  );
}

/** Add items to the page header's "…" menu while this part of the page is shown. */
export function usePageMenu(items: readonly MenuItem[]): void {
  const owner = useRef(Symbol('page-menu'));
  useEffect(() => {
    setPageMenu(owner.current, items);
  });
  useEffect(() => () => setPageMenu(owner.current, []), []);
}

/**
 * Put the list's Select / Done toggle in the page header, in the same place on every page.
 * Call it from the component that owns the selection.
 */
export function usePageSelect(value: PageSelect): void {
  const owner = useRef(Symbol('page-select'));
  const { active, disabled } = value;
  const toggle = useRef(value.toggle);
  toggle.current = value.toggle;
  useEffect(() => {
    setPageSelect(owner.current, { active, disabled, toggle: () => toggle.current() });
  }, [active, disabled]);
  useEffect(() => () => setPageSelect(owner.current, null), []);
}

/** The Select / Done toggle the page's list registered with `usePageSelect`; null while none did. The header shows it; a page without a header row (Notes) puts it in its own toolbar. */
export function PageSelectButton() {
  const [select, setSelect] = useState<PageSelect | null>(pageSelect);
  useEffect(() => {
    const sync = (): void => setSelect(pageSelect());
    sync();
    return subscribePageMenu(sync);
  }, []);
  if (!select) return null;
  return (
    <Button class="page-select" disabled={select.disabled} aria-pressed={select.active} onClick={select.toggle}>
      <IconCheck /> <span class="page-select-label">{select.active ? 'Done' : 'Select'}</span>
    </Button>
  );
}
