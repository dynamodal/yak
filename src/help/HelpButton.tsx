import { useEffect, useState } from 'preact/hooks';
import { hasNewChanges, onChangesSeen } from './changes';
import { latestChange } from './topics';

/** Help in the bare header of the welcome screen, where no tab leads to it. In the app, Help is in Settings (About & help), the palette and Welcome. */
export function HelpButton() {
  return (
    <a class="help-btn" href="#/help" title="Help">
      Help
    </a>
  );
}

/** True while What's new has an entry this device has not seen: the neutral dot on the Settings tab. */
export function useHasNewChanges(): boolean {
  const newest = latestChange();
  const [fresh, setFresh] = useState(() => hasNewChanges(newest));
  useEffect(() => onChangesSeen(() => setFresh(hasNewChanges(newest))), [newest]);
  return fresh;
}
