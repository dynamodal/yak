/**
 * Why a direct connection did or did not open (#110). Built on the device from its own peer
 * connection: kinds and counts of candidates, how far the attempt got. Addresses and ports are
 * looked at while the attempt runs and never kept in a record.
 */

export interface CandidateCounts {
  /** Host candidates with a real IP address. */
  host: number;
  /** Host candidates hidden behind an mDNS `.local` name. */
  mdns: number;
  /** Public address learned from a STUN server. */
  srflx: number;
  /** Learned during checks (an address the other side did not offer). */
  prflx: number;
  relay: number;
  /** Of all the above, how many are IPv6. */
  v6: number;
}

/** How far an attempt got, in order. */
export type AttemptStage = 'no-answer' | 'no-candidates' | 'unfinished' | 'checks-failed' | 'secure-failed' | 'open';

/** `varies`: two STUN servers saw different public ports (a "hard" NAT); `stable`: one mapping. */
export type NatKind = 'stable' | 'varies' | 'unknown';

export interface AttemptRecord {
  /** Milliseconds since the epoch when the attempt started. */
  at: number;
  role: 'offer' | 'answer';
  /** What started it (`hello`, `retry`, `direct path check`, `network change`, …); set by the mesh. */
  trigger?: string;
  local: CandidateCounts;
  remote: CandidateCounts;
  natLocal: NatKind;
  natRemote: NatKind;
  /** Both devices reported the same public address (compared on the device; the address is not kept). */
  samePublic: 'yes' | 'no' | 'unknown';
  stage: AttemptStage;
  /** Candidate pairs the checks tried, when known. */
  pairs?: number;
  /** On `open`: the kinds of the chosen pair and its protocol. */
  path?: string;
  /** Round-trip time of the chosen pair, rounded to 10 ms. */
  rttMs?: number;
  /** Time from the start to the end of the attempt. */
  ms: number;
}

export const emptyCounts = (): CandidateCounts => ({ host: 0, mdns: 0, srflx: 0, prflx: 0, relay: 0, v6: 0 });

/** The fields of one candidate line that matter here. Kept only while an attempt runs. */
export interface ParsedCandidate {
  type: string;
  address: string;
  port: string;
  component: string;
  protocol: string;
}

/** `candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> …`, with or without `a=`. */
export function parseCandidate(line: string): ParsedCandidate | undefined {
  const m = /^(?:a=)?candidate:\S+ (\d+) (\S+) \d+ (\S+) (\d+) typ (\S+)/i.exec(line.trim());
  if (!m) return undefined;
  return { component: m[1]!, protocol: m[2]!.toLowerCase(), address: m[3]!, port: m[4]!, type: m[5]!.toLowerCase() };
}

export const sdpCandidates = (sdp: string): ParsedCandidate[] =>
  sdp
    .split(/\r?\n/)
    .filter((l) => l.startsWith('a=candidate:'))
    .map(parseCandidate)
    .filter((c): c is ParsedCandidate => c !== undefined);

export function countCandidates(list: readonly ParsedCandidate[]): CandidateCounts {
  const counts = emptyCounts();
  for (const c of list) {
    if (c.type === 'host') {
      if (c.address.toLowerCase().endsWith('.local')) counts.mdns++;
      else counts.host++;
    } else if (c.type === 'srflx') counts.srflx++;
    else if (c.type === 'prflx') counts.prflx++;
    else if (c.type === 'relay') counts.relay++;
    if (c.address.includes(':')) counts.v6++;
  }
  return counts;
}

/** Two server-reflexive candidates for one public address with different ports: the NAT maps per destination. */
export function natKind(list: readonly ParsedCandidate[]): NatKind {
  const ports = new Map<string, Set<string>>();
  for (const c of list) {
    if (c.type !== 'srflx' || c.component !== '1') continue;
    const set = ports.get(c.address) ?? new Set<string>();
    set.add(c.port);
    ports.set(c.address, set);
  }
  if (ports.size === 0) return 'unknown';
  return [...ports.values()].some((s) => s.size > 1) ? 'varies' : 'stable';
}

export function samePublic(local: readonly ParsedCandidate[], remote: readonly ParsedCandidate[]): 'yes' | 'no' | 'unknown' {
  const mine = new Set(local.filter((c) => c.type === 'srflx').map((c) => c.address));
  const theirs = remote.filter((c) => c.type === 'srflx').map((c) => c.address);
  if (mine.size === 0 || theirs.length === 0) return 'unknown';
  return theirs.some((a) => mine.has(a)) ? 'yes' : 'no';
}

const STAGE_TEXT: Record<AttemptStage, string> = {
  'no-answer': 'no answer',
  'no-candidates': 'no addresses',
  unfinished: 'replaced while checking',
  'checks-failed': 'connectivity checks failed',
  'secure-failed': 'secure channel did not open',
  open: 'open',
};

const countsText = (c: CandidateCounts): string => {
  const parts = (['host', 'mdns', 'srflx', 'prflx', 'relay'] as const).filter((k) => c[k] > 0).map((k) => `${k} ${c[k]}`);
  if (c.v6 > 0) parts.push(`v6 ${c.v6}`);
  return parts.length > 0 ? parts.join(' ') : 'none';
};

/** One debug-log line, without addresses: `offer retry: local host 1 srflx 2, remote mdns 1; same public yes; connectivity checks failed (4 pairs)`. */
export function attemptLine(a: AttemptRecord): string {
  const head = [a.role, a.trigger].filter(Boolean).join(' ');
  const nat = a.natLocal === 'varies' || a.natRemote === 'varies' ? `; nat varies (${a.natLocal}/${a.natRemote})` : '';
  const pairs = a.pairs !== undefined ? ` (${a.pairs} pairs)` : '';
  const path = a.stage === 'open' && a.path ? ` ${a.path}${a.rttMs !== undefined ? ` rtt ${a.rttMs}ms` : ''}` : '';
  return `${head}: local ${countsText(a.local)}, remote ${countsText(a.remote)}; same public ${a.samePublic}${nat}; ${STAGE_TEXT[a.stage]}${pairs}${path}; ${Math.round(a.ms / 100) / 10} s`;
}

const hidesAddresses = (c: CandidateCounts): boolean => c.mdns > 0 && c.host === 0 && c.srflx === 0;
const total = (c: CandidateCounts): number => c.host + c.mdns + c.srflx + c.prflx + c.relay;

/** A plain reason for the device's row while it syncs through the relay; undefined when the attempt opened. */
export function attemptHint(a: AttemptRecord): string | undefined {
  switch (a.stage) {
    case 'open':
      return undefined;
    case 'no-answer':
      return 'The other device did not answer the last try in time.';
    case 'unfinished':
      return 'The last try was cut short; another follows.';
    case 'secure-failed':
      return 'The devices reached each other, but the secure channel did not open.';
    default:
      break;
  }
  if (total(a.remote) === 0) return 'The other device offered no addresses: its browser settings or a VPN may hide them.';
  if (total(a.local) === 0) return 'This device offered no addresses: its browser settings or a VPN may hide them.';
  if (hidesAddresses(a.local) && hidesAddresses(a.remote)) {
    return 'Both browsers hide their local addresses, and this network could not resolve them. Allowing the camera for this site on both devices lets them use real addresses.';
  }
  if (a.samePublic === 'yes') return 'Both devices are on the same network, but it keeps them apart (guest Wi-Fi or client isolation), or a firewall blocks the connection.';
  if (a.natLocal === 'varies' || a.natRemote === 'varies') return 'The devices are on different networks, and a router on one side allows no direct path.';
  if (a.samePublic === 'no') return 'The devices are on different networks, and their routers did not let them connect directly.';
  return 'No direct path was found.';
}

/** The connection report: nothing that names a device, an account, an address or a port. */
export function connectionReport(input: {
  version: string;
  browser: string;
  now: number;
  peers: readonly { state: string; via?: string; attempts?: readonly AttemptRecord[] }[];
}): string {
  const lines = ['Connection report (no names, ids, addresses or ports)', `App ${input.version} · ${input.browser}`, `Made ${new Date(input.now).toISOString().slice(0, 16)}Z`];
  input.peers.forEach((p, i) => {
    lines.push('', `Other device ${i + 1}: ${p.state}${p.via ? ` (${p.via})` : ''}`);
    const attempts = p.attempts ?? [];
    if (attempts.length === 0) lines.push('  no attempts recorded since the page opened');
    for (const a of attempts) lines.push(`  ${new Date(a.at).toISOString().slice(11, 16)}Z ${attemptLine(a)}`);
  });
  return lines.join('\n');
}
