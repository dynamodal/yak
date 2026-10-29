import type { ComponentType } from 'preact';
import type { FeatureId } from './features';
import type { ViewProps } from './registry';

/**
 * Pages assembled from sections that other modules register, so a page can show work of several
 * features without importing them: the Organize page (`#/organize`) and the note settings page
 * (`#/note-settings`).
 */
export type SectionPage = 'organize' | 'note-settings';

export interface SectionDef {
  id: string;
  page: SectionPage;
  title: string;
  /** Position on the page, lowest first. */
  order: number;
  /** Left out while this device hides the feature (Settings › Features). */
  feature?: FeatureId;
  component: ComponentType<ViewProps>;
}

const sections: SectionDef[] = [];

export function registerSection(def: SectionDef): void {
  if (sections.some((s) => s.id === def.id && s.page === def.page)) return;
  sections.push(def);
  sections.sort((a, b) => a.order - b.order);
}

export function sectionsOf(page: SectionPage): readonly SectionDef[] {
  return sections.filter((s) => s.page === page);
}
