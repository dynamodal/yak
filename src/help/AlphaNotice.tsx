import { useState } from 'preact/hooks';
import { useNeeds } from '../app/needs';
import { Button } from '../app/ui';
import { APP_NAME } from '../constants';
import { testMode } from '../core/test-build';
import { alphaNoticeSeen, markAlphaNoticeSeen } from './changes';

/** In a test build the notice stays away unless the URL has `alpha`, so it never covers a suite's page. */
const hiddenForTests = (): boolean => testMode() && !new URLSearchParams(location.search).has('alpha');

/** One-time notice per device: this is an alpha, keep backups, how to report. */
export function AlphaNotice() {
  const [seen, setSeen] = useState(() => alphaNoticeSeen() || hiddenForTests());
  // While the "No backup yet" bar is up it is the one call to action for backups; this notice then leaves its own button out.
  const backupBarUp = useNeeds().some((n) => n.id === 'backup-never');
  if (seen) return null;
  const done = (href?: string): void => {
    markAlphaNoticeSeen();
    setSeen(true);
    if (href) location.hash = href;
  };
  return (
    <div class="notice alpha-notice" role="status" aria-label={`${APP_NAME} is in alpha`}>
      <p>
        <strong>{APP_NAME} is in alpha.</strong> Things will change and some will break. We aim to migrate your data whenever the format changes, but turn on backups
        so a problem never costs you your work, and tell us when something goes wrong (Settings › <strong>Help</strong>).
      </p>
      <p class="row">
        {backupBarUp ? null : <Button variant="primary" onClick={() => done('#/settings/backups')}>Turn on backups</Button>}
        <Button onClick={() => done('#/help/report')}>How to report a problem</Button>
        <Button variant="quiet" onClick={() => done()}>Got it</Button>
      </p>
    </div>
  );
}
