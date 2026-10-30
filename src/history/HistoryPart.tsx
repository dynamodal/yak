import { useApp } from '../app/context';
import { useRoute } from '../app/router';
import { OpenDetails } from '../app/ui';
import { HistoryCard } from './HistoryCard';
import { HistorySection } from './HistoryView';

/**
 * The Version history section of Settings (#97): the navigator and the "warn when many are deleted or changed" thresholds, each a fold.
 * `#/settings/version-history/<anything>` opens the navigator; a number is the moment a warning linked to (`HistoryBanner`).
 */
export function HistoryPart() {
  const route = useRoute();
  const { spaces } = useApp();
  const target = route[0] === 'settings' && route[1] === 'version-history' ? route[2] : undefined;
  return (
    <>
      <OpenDetails summary="Go back in time" open={target !== undefined}>
        {spaces.length > 0 ? <HistorySection params={target ? [target] : []} /> : <p class="empty">Version history appears once this device keeps a space.</p>}
      </OpenDetails>
      <OpenDetails summary="Warnings when many are deleted or changed">
        <p class="hint">A warning appears when a lot of entries are deleted or changed at once, so a mistake or a bad sync can be undone from Version history while it is fresh. Shared across your devices.</p>
        <HistoryCard />
      </OpenDetails>
    </>
  );
}
