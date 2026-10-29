import { useEffect, useState } from 'preact/hooks';
import { hasNewChanges, onChangesSeen } from './changes';
import { allChanges, latestChange } from './topics';

/** Help in the bare header of the welcome screen, where no tab leads to it. In the app, Help is in Settings › Help, the palette and Welcome. */
export function HelpButton() {
  return (
    <a class="help-btn" href="#/help" title="Help">
      Help
    </a>
  );
}

/** True while What's new has an entry this device has not seen: the "New" chip in the header. */
export function useHasNewChanges(): boolean {
  const newest = latestChange();
  const [fresh, setFresh] = useState(() => hasNewChanges(newest));
  useEffect(() => onChangesSeen(() => setFresh(hasNewChanges(newest))), [newest]);
  return fresh;
}

/** A "New" chip in the header while What's new has an unseen entry; it opens What's new, which marks the entries seen. */
export function WhatsNewChip() {
  const fresh = useHasNewChanges();
  const latest = allChanges()[0];
  if (!fresh) return null;
  return (
    <a class="new-chip" href="#/help/whats-new" title={latest ? `What's new: ${latest.title}` : "What's new"}>
      New<span class="visually-hidden">: what's new{latest ? `, ${latest.title}` : ''}</span>
    </a>
  );
}
