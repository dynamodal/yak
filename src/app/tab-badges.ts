import { useHealth } from './hooks';
import { allTabBadges } from './registry';
import type { TabBadge } from './Nav';

/**
 * The dots on the tabs, by tab id. Settings carries one when a module reports a warning through `core/health.ts`
 * (amber), and a neutral one while something low-priority waits: a module's badge (What's new) or merges worth a look.
 */
export function useTabBadges(pendingNotices: number): Record<string, TabBadge> {
  const warn = useHealth().some((i) => i.level === 'warn');
  // A fixed list of hooks: modules register at start-up, before the first render.
  const active = allTabBadges().map((b) => ({ b, on: b.useActive() }));
  const out: Record<string, TabBadge> = {};
  for (const { b, on } of active) if (on) out[b.tab] = { level: 'info', label: b.label };
  if (pendingNotices > 0 && !out.settings) out.settings = { level: 'info', label: `${pendingNotices} merge${pendingNotices === 1 ? '' : 's'} worth a look` };
  if (warn) out.settings = { level: 'warn', label: 'something needs attention' };
  return out;
}
