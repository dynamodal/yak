import type { ViewDef } from './registry';

export interface NavGroupDef {
  id: string;
  title: string;
  /** Position among the places, on the same scale as `ViewDef.order`. */
  order: number;
  /** The group is one tab that opens its own page at `#/<id>` (a section list) instead of a menu. */
  landing?: boolean;
}

/** The groups a view can name in `ViewDef.group`. The shell owns this list so modules stay apart. */
export const NAV_GROUPS: readonly NavGroupDef[] = [
  { id: 'settings', title: 'Settings', order: 80, landing: true },
];

/** Pages that left Settings or never existed in it: Projects & tags is Organize and the note settings and Mirror are the Notes section of Settings (F-325, F-33x, F-55), Shortcuts are in Help. */
const MOVED: Readonly<Record<string, string[]>> = {
  projects: ['settings', 'organize'],
  organize: ['settings', 'organize'],
  'notes-settings': ['settings', 'notes'],
  'note-settings': ['settings', 'notes'],
  mirror: ['settings', 'notes', 'mirror'],
  'shortcuts-settings': ['help', 'shortcuts'],
  shortcuts: ['help', 'shortcuts'],
};

/**
 * The pages Settings had before it became one page (F-326), and the section of the page (F-33) each one now lives in.
 * Their address opens `#/settings/<section>`.
 */
const FOLDED: Readonly<Record<string, string | undefined>> = {
  home: undefined,
  settings: undefined,
  general: 'display',
  spaces: 'spaces',
  'spaces-settings': 'spaces',
  sharing: 'sharing',
  security: 'backup-safety',
  features: 'features',
};

/** The sections of the Settings page, in order (`#/settings/<section>` scrolls to one). Detail routes must not reuse these names. */
export const SETTINGS_SECTIONS = ['needs-you', 'backup-safety', 'devices-sync', 'spaces', 'sharing', 'organize', 'notes', 'display', 'features', 'help', 'advanced'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const folded = (name: string): string[] => ['settings', ...(FOLDED[name] ? [FOLDED[name] as string] : [])];

/**
 * Where an old address now lives, or undefined when the route is current: `#/manage/<x>` and `#/<x>` (`#/devices`, …)
 * become `#/settings/<x>`; the pages Settings folded into one (General, Spaces, Sharing, Security, Features) become their section
 * of `#/settings`; Backups and History are one page, `#/settings/backup`. Pages that left Settings go to their new place (`MOVED`).
 * The detail views of a device, a space and an account (F-33) open that row on the page: `#/settings/devices-sync/<id>`,
 * `…/spaces/<id>`, `…/sharing/<fingerprint>`. `#/settings/devices` and `…/devices/add` stay: they are the Add a device flow.
 */
export function legacyRoute(route: readonly string[], views: readonly ViewDef[]): string[] | undefined {
  const [first, second, ...rest] = route;
  // `#/settings/organize` is current; the same name anywhere else is an old address.
  const moved = (name: string | undefined, where: 'bare' | 'settings' | 'manage'): string[] | undefined =>
    name === undefined || !Object.hasOwn(MOVED, name) || (name === 'organize' && where === 'settings') ? undefined : MOVED[name];
  const gone = first === 'manage' || first === 'settings' ? moved(second, first) : moved(first, 'bare');
  if (gone) return gone;
  // A join link (`#/join/<code>`, option A+) opens Add a device, which takes the code from the address.
  if (first === 'join') return ['settings', 'devices', 'add', ...(second ? [second, ...rest] : [])];
  if (first === 'manage') {
    if (second === 'help') return ['help', ...rest];
    if (second === undefined || Object.hasOwn(FOLDED, second)) return folded(second ?? 'home');
    return ['settings', second === 'backups' || second === 'history' ? 'backup' : second, ...rest];
  }
  if (first === 'settings') {
    if (second === 'devices' && rest[0] !== undefined && rest[0] !== 'add') return ['settings', 'devices-sync', ...rest];
    if (second === 'space') return ['settings', 'spaces', ...rest];
    if (second === 'account') return ['settings', 'sharing', ...rest];
    // `spaces`, `sharing` and `features` are sections of the page now: `#/settings/spaces[/<row>]` is current.
    return second !== undefined && Object.hasOwn(FOLDED, second) && FOLDED[second] !== second ? folded(second) : undefined;
  }
  // A view that joins another's switch (Reports joins Timer) is reached at `#/<parent>/<path>`; the old address keeps its section.
  const joined = first === undefined ? undefined : views.find((v) => v.joins !== undefined && v.path === first);
  const parent = joined ? views.find((v) => v.id === joined.joins) : undefined;
  if (parent) return [parent.path, first as string, ...route.slice(1)];
  if (first !== undefined && Object.hasOwn(FOLDED, first) && first !== 'settings' && first !== 'home') return folded(first); // bare #/home is the Home page (F-33p); #/manage/home and #/settings/home still reach Settings
  if (first === 'backups' || first === 'history') return ['settings', 'backup', ...route.slice(1)];
  return views.some((v) => v.group === 'settings' && v.path === first) ? ['settings', ...route] : undefined;
}

type NavPagePlace = { kind: 'page'; id: string; view: ViewDef };
type NavGroupPlace = { kind: 'group'; id: string; title: string; pages: ViewDef[] };
type NavLinkPlace = { kind: 'link'; id: string; title: string; href: string };
type NavPlace = NavPagePlace | NavGroupPlace | NavLinkPlace;

export interface NavModel {
  places: NavPlace[];
  /** The page shown: the route's view, else the first visible one. */
  current: ViewDef | undefined;
  /** The place holding `current`; undefined for a hidden page. */
  activePlace: string | undefined;
}

/**
 * Turns the registered views into what the navigation shows. A view with no (or an unknown) group
 * is a place of its own. A group with one visible page is shown as that page; with none it is left out.
 * A `landing` group is one link to its own page; the route `#/<group>/<page>` makes that page current.
 */
export function navModel(views: readonly ViewDef[], route: readonly string[], groups: readonly NavGroupDef[] = NAV_GROUPS): NavModel {
  const visible = views.filter((v) => !v.hidden && v.joins === undefined);
  const landing = groups.find((g) => g.landing && g.id === route[0]);
  const inLanding = landing ? views.filter((v) => v.group === landing.id) : [];
  const current = landing
    ? (inLanding.find((v) => v.path === route[1] && route[1] !== landing.id) ?? inLanding.find((v) => v.path === landing.id) ?? inLanding.find((v) => !v.hidden) ?? inLanding[0])
    : (views.find((v) => v.path === route[0]) ?? visible[0]);
  const byOrder = (a: ViewDef, b: ViewDef): number => a.order - b.order;
  const known = new Set(groups.map((g) => g.id));
  const ranked: { order: number; place: NavPlace }[] = [];
  for (const v of visible) {
    if (!v.group || !known.has(v.group)) ranked.push({ order: v.order, place: { kind: 'page', id: v.id, view: v } });
  }
  for (const g of groups) {
    const pages = visible.filter((v) => v.group === g.id).sort(byOrder);
    const only = pages[0];
    if (pages.length >= 1 && g.landing) ranked.push({ order: g.order, place: { kind: 'link', id: g.id, title: g.title, href: `#/${g.id}` } });
    else if (pages.length === 1 && only) ranked.push({ order: g.order, place: { kind: 'page', id: only.id, view: only } });
    else if (pages.length > 1) ranked.push({ order: g.order, place: { kind: 'group', id: g.id, title: g.title, pages } });
  }
  ranked.sort((a, b) => a.order - b.order);
  const places = ranked.map((r) => r.place);
  const activePlace = places.find((p) => {
    if (p.kind === 'page') return p.view === current;
    if (p.kind === 'link') return current?.group === p.id;
    return p.pages.includes(current as ViewDef);
  })?.id;
  return { places, current, activePlace };
}
