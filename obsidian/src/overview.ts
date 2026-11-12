/**
 * What the settings tab shows about spaces and devices (#170): which spaces this vault keeps, each kept space's
 * status, and the account's other devices, read-only. Pure functions of plain facts, so they are tested without Obsidian.
 */

export interface OverviewSpace {
  id: string;
  name: string;
  archived: boolean;
}

export interface SpaceRow {
  id: string;
  name: string;
  kept: boolean;
  /** Only for a kept space. */
  status: string;
}

export interface SpaceFacts {
  spaces: OverviewSpace[];
  /** Whether this vault keeps the space, as the account document says. */
  keeps: (spaceId: string) => boolean;
  /** Spaces whose documents have arrived. */
  loaded: ReadonlySet<string>;
  /** Spaces whose folder is gone and waits for a decision. */
  held: ReadonlySet<string>;
}

/** One row per live space; archived spaces are listed only while this vault still keeps them. */
export function spaceRows(f: SpaceFacts): SpaceRow[] {
  return f.spaces
    .filter((s) => !s.archived || f.keeps(s.id))
    .map((s) => {
      const kept = f.keeps(s.id);
      let status = '';
      if (kept) status = f.held.has(s.id) ? 'Folder missing: decide in "Review folders that need a decision"' : f.loaded.has(s.id) ? 'Kept here' : 'Waiting for its notes';
      return { id: s.id, name: s.name, kept, status };
    });
}

export interface DeviceFacts {
  me: string;
  devices: Map<string, { name?: string; removed: boolean; left: boolean }>;
  spaces: OverviewSpace[];
  keeps: (deviceId: string, spaceId: string) => boolean;
  peers: { id: string; state: string; lastSeenAt?: number }[];
  now: number;
}

export interface DeviceRow {
  id: string;
  name: string;
  /** "Connected", "Last seen 3 min ago", or "Not seen yet". */
  presence: string;
  /** Names of the spaces it keeps, or a sentence when none. */
  kept: string;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The other devices of the account, connected ones first; removed and departed devices are left out. */
export function deviceRows(f: DeviceFacts): DeviceRow[] {
  const rows = [...f.devices]
    .filter(([id, d]) => id !== f.me && !d.removed && !d.left)
    .map(([id, d]) => {
      const peer = f.peers.find((p) => p.id === id);
      const connected = peer?.state === 'connected';
      const presence = connected ? 'Connected' : peer?.lastSeenAt ? `Last seen ${ago(f.now - peer.lastSeenAt)}` : 'Not connected';
      const names = f.spaces.filter((s) => !s.archived && f.keeps(id, s.id)).map((s) => s.name);
      return { id, name: d.name ?? `Device ${id.slice(0, 4)}`, presence, kept: names.length ? names.join(', ') : 'No spaces kept', connected };
    });
  rows.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  return rows.map(({ connected: _c, ...r }) => r);
}
