import { useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import type { NavModel } from './nav';
import type { ViewDef } from './registry';
import { navigate } from './router';
import { IconChevronDown, IconSettings, Menu } from './ui';
import { cx } from './ui/cx';

/** A pill on a tab, only for what needs the person: a count (neutral) or "!" (amber warning). Never a status; sync state lives in the sync button. */
export interface TabBadge {
  level: 'info' | 'warn';
  /** Shown in the pill: a count or "!". */
  text: string;
  /** For a screen reader, for example "something is new". */
  label: string;
}

/** Icons of the group tabs (a group is not a view, so it cannot carry its own). */
const GROUP_ICONS: Readonly<Record<string, ComponentType>> = { settings: IconSettings };

/**
 * One tab's inside: its icon, its label (visually hidden on a narrow screen, never removed, so the tab keeps its name) and its badge.
 */
function TabInner({ icon: Icon, label, badge }: { icon?: ComponentType; label: string; badge?: TabBadge }) {
  return (
    <>
      {Icon ? <Icon /> : null}
      <span class="tab-label">{label}</span>
      {badge ? <span class={cx('tab-badge', badge.level)} role="img" aria-label={badge.label} data-text={badge.text} /> : null}
    </>
  );
}

/** The tab row, at the top on every screen size. */
export function TopNav({ model, badges = {} }: { model: NavModel; badges?: Readonly<Record<string, TabBadge>> }) {
  return (
    <nav class="tabs main-tabs" aria-label="Pages">
      {model.places.map((p) =>
        p.kind === 'page' ? (
          <a key={p.id} href={`#/${p.view.path}`} class={p.id === model.activePlace ? 'active' : ''} aria-current={p.id === model.activePlace ? 'page' : undefined} title={p.view.title}>
            <TabInner icon={p.view.icon} label={p.view.title} badge={badges[p.id]} />
          </a>
        ) : p.kind === 'link' ? (
          <a key={p.id} href={p.href} class={p.id === model.activePlace ? 'active' : ''} aria-current={p.id === model.activePlace ? 'page' : undefined} title={p.title}>
            <TabInner icon={GROUP_ICONS[p.id]} label={p.title} badge={badges[p.id]} />
          </a>
        ) : (
          <GroupTab key={p.id} title={p.title} pages={p.pages} current={p.id === model.activePlace ? model.current : undefined} />
        ),
      )}
    </nav>
  );
}

function GroupTab({ title, pages, current }: { title: string; pages: ViewDef[]; current: ViewDef | undefined }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchor} class={cx('tab', current && 'active')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}
        {current ? <span class="tab-page"> · {current.title}</span> : null} <IconChevronDown />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label={title}
        items={pages.map((v) => ({ label: v.title, onSelect: () => navigate(v.path) }))}
      />
    </>
  );
}
