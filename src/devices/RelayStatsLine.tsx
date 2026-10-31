import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { scaledMs } from '../core/test-build';
import { relayBusyText, relayStatsDetails, relayStatsText, relayTotalsLines, type RelayStats } from '../sync/relay-stats';
import { HourBars } from './HourBars';


/**
 * "Relay: 3 devices connected · 420 messages today" for this account's relay room, and in its details the relay's totals for everyone (#109). Asked when the page opens and
 * then once a minute while it is visible; each ask is three counted requests. Nothing for ntfy or when not paired.
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
  const busy = stats.relay ? relayBusyText(stats.relay) : undefined;
  return (
    <>
      {busy ? <p class="hint relay-busy">{busy}</p> : null}
      <details class="relay-stats">
        <summary role="status">{relayStatsText(stats)}</summary>
        <ul class="hint">
          {relayStatsDetails(stats).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {stats.relay ? (
          <>
            <ul class="hint" aria-label="Everyone on the relay">
              {relayTotalsLines(stats.relay).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {stats.relay.messagesPerHour.length > 0 ? <HourBars values={stats.relay.messagesPerHour} label="Messages through the relay, everyone" unit="messages" /> : null}
          </>
        ) : null}
      </details>
    </>
  );
}
