import { useEffect, useState } from 'preact/hooks';
import { shareLinks } from './share-links';
import { useNow } from './hooks';
import { useShares } from './use-shares';

/**
 * What needs the person now (F-33): a device or an account that waits for an answer, and whatever a module
 * registers (`registerNeed`: "No backup yet"). Settings lists them first ("Needs you"); a pending join also puts a
 * dot on the Settings tab. Kept light on purpose: the invite code that hosts a device join loads on demand and
 * only reports into `pendingJoins` here.
 */
export interface NeedItem {
  id: string;
  /** What is waiting: "Phone asks to join". */
  text: string;
  /** Where it is answered. */
  href: string;
  /** The link's label: "Review", "Set up". */
  action: string;
  /** Time-limited items show the minutes left. */
  expiresAt?: number;
  /** A health warning rather than a request. */
  tone: 'ask' | 'warn';
}

export interface PendingJoin {
  deviceId: string;
  name?: string;
  expiresAt: number;
}

let pending: readonly PendingJoin[] = [];
const joinListeners = new Set<() => void>();

/** `invites.ts` tells this which devices are waiting for approval on this device. */
export function setPendingJoins(list: readonly PendingJoin[]): void {
  if (JSON.stringify(list) === JSON.stringify(pending)) return;
  pending = list;
  for (const l of joinListeners) l();
}

export function pendingJoins(): readonly PendingJoin[] {
  return pending;
}

export interface NeedDef {
  id: string;
  order: number;
  /** A hook, called on every render of the list: return the need, or undefined when there is none. */
  useNeed(): NeedItem | undefined;
}

const defs: NeedDef[] = [];

export function registerNeed(def: NeedDef): void {
  if (defs.some((d) => d.id === def.id)) return;
  defs.push(def);
  defs.sort((a, b) => a.order - b.order);
}

/** Minutes left until `at`, at least 1 while it has not passed. */
export function minutesLeft(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 60_000));
}

/** Re-renders when a device waits for approval or stops waiting. */
export function usePendingJoins(): readonly PendingJoin[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((t) => t + 1);
    joinListeners.add(bump);
    return () => void joinListeners.delete(bump);
  }, []);
  return pending;
}

/** Share requests waiting on this device, as needs. */
function shareNeeds(): NeedItem[] {
  const h = shareLinks.hosting;
  if (!h) return [];
  return h.requests
    .filter((r) => r.state === 'waiting' || r.state === 'approving')
    .map((r) => ({ id: `share:${h.space}:${r.ask.deviceId}`, text: `${r.ask.name ?? 'Another account'} asks to join ${h.spaceName}`, href: `#/settings/spaces/${h.space}`, action: 'Review', expiresAt: h.expiresAt, tone: 'ask' as const }));
}

/** The pending requests only (devices and accounts), for the Settings tab's dot. */
export function usePendingRequests(): NeedItem[] {
  const joins = usePendingJoins();
  useShares();
  const device: NeedItem[] = joins.map((j) => ({ id: `join:${j.deviceId}`, text: `${j.name ?? 'A new device'} asks to join`, href: '#/settings/devices/add', action: 'Review', expiresAt: j.expiresAt, tone: 'ask' }));
  return [...device, ...shareNeeds()];
}

/** Everything that needs the person, requests first. The registered needs are a fixed list of hooks. */
export function useNeeds(): NeedItem[] {
  const requests = usePendingRequests();
  useNow(30_000);
  const own = defs.map((d) => d.useNeed()).filter((n): n is NeedItem => n !== undefined);
  return [...requests, ...own];
}
