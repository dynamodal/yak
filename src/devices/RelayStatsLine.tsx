import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { scaledMs } from '../core/test-build';
import { relayStatsDetails, relayStatsText, type RelayStats } from '../sync/relay-stats';


/**
 * "Relay: 3 devices connected · 420 messages today" for this account's relay room. Asked when the page opens and
 * then once a minute while it is visible; each ask is one Cloudflare request. Nothing for ntfy or when not paired.
 */
export function RelayStatsLine(props: { paired: boolean }) {
  const { sync } = useApp();
  const [stats, setStats] = useState<RelayStats | undefined>();
  useEffect(() => {
    if (!props.paired) {
      setStats(undefined);
      return;
    }
    let alive = true;
    const ask = (): void => {
      if (document.visibilityState === 'hidden') return;
      void sync.relayStats().then((s) => alive && setStats(s));
    };
    ask();
    const timer = setInterval(ask, scaledMs(60_000));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sync, props.paired]);
  if (!stats) return null;
  return (
    <details class="relay-stats">
      <summary role="status">{relayStatsText(stats)}</summary>
      <ul class="hint">
        {relayStatsDetails(stats).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}
