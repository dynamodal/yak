import { useEffect, useState } from 'preact/hooks';
import { currentAlert, dismissAlert, onAlert } from '../core/history/alert';
import { navigate } from '../app/router';
import { Button } from '../app/ui';

/** A warning that a lot of entries were deleted or changed at once, with a way to look at the moment before. */
export function HistoryBanner() {
  const [alert, setAlert] = useState(currentAlert);
  useEffect(() => onAlert(() => setAlert(currentAlert())), []);
  if (!alert) return null;
  const from = alert.local ? 'this device' : 'another device';
  const parts = [alert.deleted > 0 ? `${alert.deleted} deleted` : '', alert.changed > 0 ? `${alert.changed} older entries changed` : ''].filter(Boolean);
  return (
    <div class="backup-banner warn history-banner" role="alert">
      <span>
        A lot of entries changed at once, from {from}: {parts.join(', ')}. If that was not you, look at what they were before.
      </span>
      <Button
        onClick={() => {
          dismissAlert();
          navigate('settings', 'version-history', String(alert.before));
        }}
      >
        Review
      </Button>
      <Button onClick={dismissAlert}>Dismiss</Button>
    </div>
  );
}
