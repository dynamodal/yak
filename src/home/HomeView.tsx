import { useMemo } from 'preact/hooks';
import { allHomeCards } from '../app/home-cards';
import { effectiveHidden, useHiddenModules } from '../app/features';
import { Page, PageHeader } from '../app/ui';

/**
 * A summary of where things stand. Read-only apart from what a card offers (checking a task, opening an item).
 * Each card hides itself when it has nothing to show; when none shows, the empty note below takes its place (CSS `:empty`).
 */
export function HomeView() {
  const stored = useHiddenModules();
  const cards = useMemo(() => allHomeCards(effectiveHidden(stored)), [stored]);
  return (
    <Page width="wide" class="hm-page">
      <PageHeader title="Home" />
      <div class="hm-grid">
        {cards.map((c) => (
          <c.component key={c.id} />
        ))}
      </div>
      <p class="hm-empty hint">Nothing to show yet. Track some time, write a note or add a task, and a summary appears here.</p>
    </Page>
  );
}
