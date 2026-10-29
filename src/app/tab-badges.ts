import { useHealth } from './hooks';
import { usePendingRequests } from './needs';
import { allTabBadges } from './registry';
import type { TabBadge } from './Nav';

/**
 * The pills on the tabs, by tab id. Only what needs the person: Settings carries a count when devices or accounts wait for an answer
 * (F-33: "Needs you") or merges are worth a look, and an amber "!" when a module reports a warning through `core/health.ts`.
 * A healthy state (synced, connected) never shows one. What's new has its own "New" chip by the logo (F-74).
 */
export function useTabBadges(pendingNotices: number): Record<string, TabBadge> {
  const warn = useHealth().some((i) => i.level === 'warn');
  const asks = usePendingRequests().length;
  // A fixed list of hooks: modules register at start-up, before the first render.
  const active = allTabBadges().map((b) => ({ b, on: b.useActive() }));
  const out: Record<string, TabBadge> = {};
  for (const { b, on } of active) if (on) out[b.tab] = { level: 'info', text: '1', label: b.label };
  if (pendingNotices > 0 && !out.settings) out.settings = { level: 'info', text: String(pendingNotices), label: `${pendingNotices} merge${pendingNotices === 1 ? '' : 's'} worth a look` };
  if (asks > 0) out.settings = { level: 'info', text: String(asks), label: asks === 1 ? 'a device or account asks to join' : `${asks} requests wait for you` };
  if (warn) out.settings = { level: 'warn', text: '!', label: 'something needs attention' };
  return out;
}
