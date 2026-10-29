import { useEffect, useState } from 'preact/hooks';
import { hasNewChanges, onChangesSeen } from './changes';

/** Help in the bare header of the welcome screen, where no tab leads to it. In the app, Help is in Settings › Help, the palette and Welcome. */
export function HelpButton() {
  return (
    <a class="help-btn" href="#/help" title="Help">
      Help
    </a>
  );
}

type Latest = { token: string | undefined; change: { title: string } | undefined };

/** The newest What's new entry. The entries are bundled Markdown (`topics.ts`), so they load after the first paint instead of weighing on the main bundle. */
function useLatest(): Latest | undefined {
  const [latest, setLatest] = useState<Latest>();
  useEffect(() => {
    let live = true;
    void import('./topics').then((t) => live && setLatest({ token: t.latestChange(), change: t.allChanges()[0] })).catch(() => undefined);
    return () => void (live = false);
  }, []);
  return latest;
}

/** True while What's new has an entry this device has not seen: the "New" chip in the header. */
export function useHasNewChanges(latest: Latest | undefined): boolean {
  const newest = latest?.token;
  const [, bump] = useState(0);
  useEffect(() => onChangesSeen(() => bump((n) => n + 1)), []);
  return hasNewChanges(newest);
}

/** A "New" chip in the header while What's new has an unseen entry; it opens What's new, which marks the entries seen. */
export function WhatsNewChip() {
  const latestEntry = useLatest();
  const fresh = useHasNewChanges(latestEntry);
  const latest = latestEntry?.change;
  if (!fresh) return null;
  return (
    <a class="new-chip" href="#/help/whats-new" title={latest ? `What's new: ${latest.title}` : "What's new"}>
      New<span class="visually-hidden">: what's new{latest ? `, ${latest.title}` : ''}</span>
    </a>
  );
}
