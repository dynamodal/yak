import type { ComponentChildren, ComponentType } from 'preact';
import { effectiveHidden, type FeatureId } from './features';
import { cx } from './ui/cx';

/**
 * A card on the Home page (F-33p). Modules register one from their own `index.ts`, so Home never imports a feature module;
 * the card reads its own data and renders `null` while it has nothing to show. `feature` hides it with its feature switch.
 */
export interface HomeCardDef {
  id: string;
  /** Position on the page, lowest first. */
  order: number;
  feature?: FeatureId;
  /** Spans the whole row (for something urgent). */
  wide?: boolean;
  component: ComponentType;
}

const cards: HomeCardDef[] = [];

export function registerHomeCard(def: HomeCardDef): void {
  if (cards.some((c) => c.id === def.id)) return;
  cards.push(def);
  cards.sort((a, b) => a.order - b.order);
}

/** The cards this device shows: the ones whose feature is not hidden. */
export function allHomeCards(hidden: ReadonlySet<FeatureId> = effectiveHidden([])): readonly HomeCardDef[] {
  return cards.filter((c) => !c.feature || !hidden.has(c.feature));
}

export interface HomeCardProps {
  id: string;
  title: string;
  /** Where "more" goes: the page the card summarises. */
  link?: { href: string; label: string };
  wide?: boolean;
  children?: ComponentChildren;
}

/** The frame every card shares: a titled region with an optional link to the full page. */
export function HomeCard({ id, title, link, wide, children }: HomeCardProps) {
  return (
    <section class={cx('hm-card', wide && 'hm-wide')} data-card={id} aria-labelledby={`hm-${id}-title`}>
      <header class="hm-card-head">
        <h2 id={`hm-${id}-title`}>{title}</h2>
        {link ? (
          <a class="hm-more" href={link.href}>
            {link.label}
          </a>
        ) : null}
      </header>
      {children}
    </section>
  );
}
