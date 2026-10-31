import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, Page, PageHeader } from '../app/ui';
import { STORAGE_PREFIX } from '../constants';
import { fetchNetworkStats, fetchRelayUsage, last24, type NetworkResult, projectDay, type RelayUsage, summarize, type UsageResult } from '../sync/network-stats';
import { HourBars } from './HourBars';

const KEY = `${STORAGE_PREFIX}-admin-key`;
const load = (): string => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Operator view of relay use (#173). Not in the Settings list: open `#/settings/network`, enter the admin key
 * once on this device (kept in localStorage, never synced). Without the key or the Worker secrets it shows nothing.
 */
export function NetworkStatsView() {
  const { sync } = useApp();
  const [key, setKey] = useState(load());
  const [draft, setDraft] = useState('');
  const [hours, setHours] = useState(24);
  const [result, setResult] = useState<NetworkResult | undefined>();
  const [usage, setUsage] = useState<UsageResult | undefined>();
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchNetworkStats(sync.status.signalingUrl, key, hours).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [sync, key, hours]);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchRelayUsage(sync.status.signalingUrl, key).then((r) => alive && setUsage(r));
    return () => {
      alive = false;
    };
  }, [sync, key]);
  const summary = result?.ok ? summarize(result.rows) : undefined;
  return (
    <Page width="settings" class="st">
      <PageHeader title="Network stats" />
      {!key ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              localStorage.setItem(KEY, draft.trim());
            } catch {
              // Kept for this page only.
            }
            setKey(draft.trim());
          }}
        >
          <p class="hint">Operator view of the relay. Enter the admin key set on the Worker. It stays on this device.</p>
          <input type="password" aria-label="Admin key" value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} autocomplete="off" />{' '}
          <Button type="submit" disabled={!draft.trim()}>
            Show stats
          </Button>
        </form>
      ) : (
        <>
          <div class="row">
            <label>
              Period{' '}
              <select aria-label="Period" value={hours} onChange={(e) => setHours(Number((e.target as HTMLSelectElement).value))}>
                <option value={24}>Last 24 hours</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last 7 days</option>
              </select>
            </label>
            <Button
              onClick={() => {
                try {
                  localStorage.removeItem(KEY);
                } catch {
                  // Nothing stored.
                }
                setKey('');
                setResult(undefined);
              }}
            >
              Forget the key
            </Button>
          </div>
          {usage?.ok ? <UsageSection u={usage.usage} /> : null}
          {usage && !usage.ok && usage.reason === 'key' ? <p class="error">The Worker did not accept this key.</p> : null}
          {usage && !usage.ok && usage.reason === 'failed' ? <p class="error">Today's usage could not be read.</p> : null}
          {usage && !usage.ok && usage.reason === 'off' ? <p class="error">This relay has no operator stats turned on.</p> : null}
          <h3>Traffic per hour (Analytics Engine)</h3>
          {!result && <p class="hint">Loading…</p>}
          {result && !result.ok && (
            <p class={result.reason === 'off' ? 'hint' : 'error'}>
              {result.reason === 'key' ? 'The Worker did not accept this key.' : result.reason === 'off' ? 'Not turned on for this relay (docs/sync.md, Operator stats).' : 'The stats could not be read.'}
            </p>
          )}
          {summary && (
            <>
              <p role="status">
                Active rooms (busiest hour): {summary.peakRooms} · {summary.messages.toLocaleString()} messages · {mb(summary.bytes)} · relay fallback carries{' '}
                {Math.round(summary.linkShare * 100)}% of the bytes
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Hour (UTC)</th>
                    <th>Kind</th>
                    <th>Rooms</th>
                    <th>Messages</th>
                    <th>MB</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.ok &&
                    result.rows.map((r) => (
                      <tr key={r.hour + r.kind}>
                        <td>{r.hour.slice(0, 16)}</td>
                        <td>{r.kind === 'link' ? 'data link (fallback)' : 'signaling'}</td>
                        <td>{r.rooms}</td>
                        <td>{r.messages}</td>
                        <td>{(r.bytes / (1024 * 1024)).toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Page>
  );
}

const pct = (part: number, whole: number): string => `${whole > 0 ? Math.round((part / whole) * 100) : 0}%`;
const plural = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Today against the cap, where it is heading, the last 24 hours and who used the relay (#109). From the relay's own estimate. */
function UsageSection(props: { u: RelayUsage }) {
  const { u } = props;
  const projected = projectDay(u.used, u.requestsPerHour.today, u.now);
  return (
    <section aria-label="Today's relay usage">
      <h3>Today (UTC)</h3>
      <p role="status">
        {u.used.toLocaleString()} of {u.limit.toLocaleString()} estimated requests ({pct(u.used, u.limit)}) · data links stop at {u.linksOffAt.toLocaleString()} · Cloudflare's plan:{' '}
        {u.planLimit.toLocaleString()} a day
      </p>
      <meter min={0} max={u.limit} high={u.linksOffAt} optimum={0} value={u.used} aria-label="Requests used today" />
      <p class={projected >= u.linksOffAt ? 'error' : 'hint'}>
        On pace for about {projected.toLocaleString()} by 00:00 UTC ({pct(projected, u.limit)} of the budget). The estimate errs a little low; Cloudflare's dashboard has the exact count.
      </p>
      <HourBars values={last24(u.requestsPerHour, u.now)} label="Estimated requests per hour" unit="requests" />
      <ul class="hint">
        <li>
          Now: {plural(u.accountsNow, 'account', 'accounts')}, {plural(u.devicesNow, 'device', 'devices')}, {plural(u.linksNow, 'data link', 'data links')}
        </li>
        <li>
          Today: {plural(u.rooms.accounts, 'account', 'accounts')} ({plural(u.devicesToday, 'device', 'devices')}), {plural(u.rooms.shares, 'shared space', 'shared spaces')},{' '}
          {plural(u.rooms.invites, 'one-time code or share link', 'one-time codes or share links')}, {plural(u.linkPairsToday, 'device pair', 'device pairs')} through data links
          {u.rooms.other > 0 ? `, ${plural(u.rooms.other, 'room', 'rooms')} from older versions` : ''}
        </li>
      </ul>
      {u.history.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Day (UTC)</th>
              <th>Requests</th>
              <th>Accounts</th>
              <th>Devices</th>
              <th>Shared spaces</th>
              <th>Data-link pairs</th>
            </tr>
          </thead>
          <tbody>
            {[...u.history].reverse().map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.used.toLocaleString()}</td>
                <td>{d.accounts}</td>
                <td>{d.devices}</td>
                <td>{d.shares}</td>
                <td>{d.linkPairs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
