import { DurableObject } from 'cloudflare:workers';

/**
 * First-party signaling relay. The static site is served by the assets binding; this script runs
 * only for `/signal/*` (see `run_worker_first` in wrangler.jsonc). A WebSocket upgrade to
 * `/signal/<topic>` is handed to one Durable Object per topic, which relays each message to the
 * other sockets in the room and stores nothing. Messages are encrypted by the clients.
 *
 * Wire protocol (kept in step with src/sync/signaling-ws.ts and scripts/mock-relay.mjs):
 *   server -> client on connect: {"event":"open","time":<server unix seconds>}
 *   client -> server:            any text up to MAX_MESSAGE_BYTES; the text `ping` is answered `pong`
 *   server -> other sockets:     {"id":"<unique>","time":<server unix seconds>,"message":"<text>"}
 *
 * Data links, the fallback when no direct WebRTC path opens: `/signal/<topic>/link/<pair>` (pair =
 * 32 hex characters both devices derive). Binary frames sealed by the clients are forwarded to the
 * other socket of the pair (at most two); `{"event":"left"}` tells the survivor when one ends.
 * Signaling broadcasts never reach link sockets and the other way round.
 *
 * Limits: the browser's `Origin` must be this site, a known app (Obsidian) or listed in
 * ALLOWED_ORIGINS; each address may open a limited number of connections per minute to one
 * topic (CONNECT_LIMIT) and in all (ADDRESS_LIMIT, the ceiling for a shared VPN or office address), and a daily share of the budget and number of topics (RelayBudget.admit); a room's links carry at most RELAY_DAY_BYTES per UTC day. A link that hits a
 * limit receives `{"event":"limit","reason":"day"|"rate"|"service"}` first; direct sync is never
 * affected.
 *
 * A refused WebSocket upgrade (the per-minute limits, the daily share or topics) is accepted and
 * closed at once with code 4429 (`rate retry=60`) or 4430 (`day scope=share|topics reset=<unix>`),
 * because a browser shows no HTTP status or body of a failed handshake. The origin check and the
 * budget (503) still refuse the handshake; the app tells those apart with `GET /signal/status`.
 *
 * Cost guard: every call here is a Cloudflare request (assets are not), so the Worker and the
 * rooms count them into one RelayBudget object (RELAY_DAY_REQUESTS a day). At 80% new data links
 * are refused, at 100% everything is; `RELAY=off` refuses everything at once. Refusals are JSON
 * with `"service":"yak-relay"`, and `GET /signal/status` answers the same way, so the app can
 * tell this relay's limits from Cloudflare's (src/sync/relay-status.ts).
 */

// Not exported: a Worker module may export only handlers and Durable Object classes.
/** Topics are `yk-` and the 32 hex characters derived from the pairing secret. */
const TOPIC_PATTERN = /^yk-[0-9a-f]{32}$/;
const MAX_SOCKETS_PER_ROOM = 16;
const MAX_MESSAGE_BYTES = 8 * 1024;
/** Data links (relay fallback): one socket per device of a pair, tagged `link:<pair>`; frames are sealed binary. */
const MAX_LINK_FRAME_BYTES = 64 * 1024;
const LINK_RATE_WINDOW_MS = 10_000;
const LINK_RATE_BYTES = 4 * 1024 * 1024;
const LINK_RATE_FRAMES = 400;
/** Per socket: at most this many messages in any window of this length. */
const RATE_LIMIT_MESSAGES = 20;
const RATE_LIMIT_WINDOW_MS = 10_000;

interface Env {
  SIGNAL_ROOM: DurableObjectNamespace<SignalRoom>;
  /** The one account-wide counter of Cloudflare requests spent by `/signal` today. */
  RELAY_BUDGET: DurableObjectNamespace<RelayBudget>;
  /** `off` refuses every `/signal` connection without a code change (kill switch). */
  RELAY?: string;
  /** Tests: tell the budget object after this many requests instead of FLUSH_REQUESTS. */
  RELAY_FLUSH_REQUESTS?: string;
  /** Estimated Cloudflare requests `/signal` may spend per UTC day. Default 50 000 (half the Free plan's 100 000). */
  RELAY_DAY_REQUESTS?: string;
  /** Cap on new connections per address and topic (wrangler.jsonc `ratelimits`). Absent: not enforced. */
  CONNECT_LIMIT?: RateLimit;
  /** Cap on new connections and status checks per address, all topics together. Absent: not enforced. */
  ADDRESS_LIMIT?: RateLimit;
  /** Extra allowed `Origin` values, comma separated, for a relay run by someone else (docs/sync.md). */
  ALLOWED_ORIGINS?: string;
  /** Data a room may carry through its links per UTC day, in bytes. Default 100 MiB. */
  RELAY_DAY_BYTES?: string;
  /** One address's share of RELAY_DAY_REQUESTS a day (default 0.1: 2 requests a socket, so 2 500 sockets at the default budget) and its limit of different topics a day (default 150), sized for a team behind one office address. */
  ADDRESS_DAY_SHARE?: string;
  ADDRESS_DAY_TOPICS?: string;
  /** Workers Analytics Engine dataset for operator stats (wrangler.jsonc `analytics_engine_datasets`). Absent: nothing is recorded. */
  RELAY_STATS?: AnalyticsEngineDataset;
  /** Secrets for the operator stats endpoint; without all three it answers 404. */
  ADMIN_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

/**
 * Origins that may open a socket besides the site itself: the Obsidian plugin runs in Obsidian's
 * own page (desktop, iOS, Android). The check stops casual misuse from other websites; a script
 * can still set any header, so the byte and connection limits are what protect the relay.
 */
const DEFAULT_ALLOWED_ORIGINS = ['app://obsidian.md', 'capacitor://localhost', 'http://localhost', 'https://localhost'];
const DEFAULT_DAY_BYTES = 100 * 1024 * 1024;

/**
 * Cost model, in Cloudflare requests (Free plan: about 100 000 a day, assets not counted):
 * every call of this Worker is 1, an accepted socket is 1 more (the room object), and incoming
 * WebSocket messages bill 20 to 1. Bytes are not billed, so they are not the budget.
 */
const DEFAULT_DAY_REQUESTS = 50_000;
const DEFAULT_ADDRESS_SHARE = 0.1;
const DEFAULT_ADDRESS_TOPICS = 150;
/** Past this share of the budget new data links are refused; signaling goes on until the whole budget is spent. */
const LINKS_OFF_SHARE = 0.8;
/** This Worker adds up its own requests and tells the budget object after this many, or this long. */
const FLUSH_REQUESTS = 50;
const CACHE_MS = 30_000;
/** A room reports its messages to the budget after this many (10 billed requests). */
const REPORT_EVERY_MESSAGES = 200;
const MESSAGES_PER_REQUEST = 20;
/** The usage counter is written to storage after this many unsaved bytes (and when a link closes). */
const USAGE_SAVE_BYTES = 64 * 1024;

/** Room statistics are kept in buckets of this length for this long. */
const BUCKET_MS = 10 * 60 * 1000;
const BUCKETS_KEPT = 145;
const STATS_SAVE_MESSAGES = 50;

interface Bucket {
  /** Start of the bucket, ms since the epoch. */
  t: number;
  /** Messages and bytes relayed: signaling and data links together. */
  m: number;
  b: number;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Whether a rate-limit binding lets this key through; an absent binding always does. */
async function within(binding: RateLimit | undefined, key: string): Promise<boolean> {
  return binding ? (await binding.limit({ key })).success : true;
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === new URL(request.url).host) return true;
  const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra].includes(origin);
}

type Level = 'ok' | 'links' | 'off';

interface BudgetState {
  level: Level;
  /** Unix seconds when the budget starts over (next UTC midnight). */
  resetsAt: number;
}

const nextMidnight = (): number => Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) / 1000);

const CORS = { 'Access-Control-Allow-Origin': '*' };

/** A refusal the app can read: JSON with the marker field, and the reason also in a header. */
function refuse(status: number, reason: 'service' | 'origin' | 'address', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ service: 'yak-relay', error: 'refused', reason, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Relay-Limit': reason, 'Cache-Control': 'no-store', ...CORS, ...headers },
  });
}

// Close codes of a refused WebSocket (4000 to 4999 is for applications). Keep in step with src/sync/relay-refusal.ts.
const CLOSE_RATE = 4429;
const CLOSE_DAY = 4430;

/**
 * A browser hides the status of a failed handshake, so a limit of one address is told in a close
 * instead: accept the upgrade here in the Worker and close at once with a code and a short reason
 * (`rate retry=<s>`, `day scope=<share|topics> reset=<unix s>`). The room object is never reached,
 * so it costs no more than the HTTP 429 it replaces (the call itself is counted by `gate`) and the
 * socket is not admitted to any tally. Callers that are not WebSocket upgrades keep their 429.
 */
function refuseSocket(code: number, reason: string): Response {
  const sockets = new WebSocketPair();
  const [client, server] = [sockets[0], sockets[1]];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

// What this Worker instance knows of the budget; instances differ, so it is an estimate that errs low.
let pending = 0;
let cached: BudgetState = { level: 'ok', resetsAt: 0 };
let cachedAt = 0;

/** Counts requests spent and returns the budget level. Asks the budget object only every FLUSH_REQUESTS or CACHE_MS. */
async function gate(env: Env, cost: number): Promise<BudgetState> {
  if (env.RELAY === 'off') return { level: 'off', resetsAt: nextMidnight() };
  pending += cost;
  const now = Date.now();
  if (pending >= (Number(env.RELAY_FLUSH_REQUESTS) || FLUSH_REQUESTS) || now - cachedAt > CACHE_MS) {
    const spent = pending;
    pending = 0;
    cachedAt = now;
    try {
      cached = await env.RELAY_BUDGET.get(env.RELAY_BUDGET.idFromName('budget')).charge(spent);
    } catch {
      // The budget object is unreachable: keep the last known level rather than refusing everyone.
    }
  }
  return cached;
}

/**
 * Charges the room's request (the call that reached this Worker is counted by `gate`) and applies the
 * per-address daily limits kept in the budget object. Fails open if that object is unreachable.
 */
async function admit(env: Env, address: string, topic: string): Promise<'ok' | 'share' | 'topics'> {
  if (env.RELAY === 'off') return 'ok';
  try {
    return await env.RELAY_BUDGET.get(env.RELAY_BUDGET.idFromName('budget')).admit(await digestHex(address, 8), await digestHex(topic, 8));
  } catch {
    return 'ok';
  }
}

async function digestHex(text: string, bytes: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** First 8 hex characters of SHA-256 over the topic: enough to count rooms, too short to find one. */
async function roomHash(topic: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(topic));
  return [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SqlRow {
  hour: string;
  kind: string;
  rooms: number;
  messages: number;
  bytes: number;
}

/**
 * `GET /signal/admin/stats?hours=24` with `Authorization: Bearer <ADMIN_KEY>`: relay use per hour from
 * Workers Analytics Engine, by kind (`signal` messages, `link` frames of the relay fallback). The
 * Cloudflare API token stays a Worker secret; rooms appear only as short hashes.
 */
async function adminStats(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_KEY || !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return new Response('Not found', { status: 404 });
  const given = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!(await within(env.ADDRESS_LIMIT, `admin|${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`)) || !sameKey(given, env.ADMIN_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } });
  }
  const hours = Math.min(168, Math.max(1, Math.floor(Number(new URL(request.url).searchParams.get('hours'))) || 24));
  const sql =
    `SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour, blob2 AS kind, count(DISTINCT blob1) AS rooms, ` +
    `sum(_sample_interval) AS messages, sum(_sample_interval * double1) AS bytes FROM yak_relay ` +
    `WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR GROUP BY hour, kind ORDER BY hour FORMAT JSON`;
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
    body: sql,
  });
  if (!response.ok) return new Response(JSON.stringify({ error: 'query failed', status: response.status }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
  const rows = ((await response.json()) as { data?: SqlRow[] }).data ?? [];
  return new Response(JSON.stringify({ service: 'yak-relay', hours, rows }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
}

const ROUTE = /^\/signal\/([^/]+)(?:\/link\/([0-9a-f]{32}))?$/;
const STATS_ROUTE = /^\/signal\/([^/]+)\/stats$/;

/**
 * `GET /signal/status`: lets the app tell this relay's own limits from Cloudflare refusing us. Only
 * this Worker can answer with the marker field; a Cloudflare error page cannot. Not rate-limited
 * by origin, but by address, and counted like any other call.
 */
async function status(request: Request, env: Env): Promise<Response> {
  const budget = await gate(env, 1);
  if (!(await within(env.ADDRESS_LIMIT, request.headers.get('CF-Connecting-IP') ?? 'unknown'))) return refuse(429, 'address', {}, { 'Retry-After': '60' });
  const origin = request.headers.get('Origin');
  const body = {
    service: 'yak-relay',
    state: budget.level === 'ok' ? 'ok' : 'limited',
    ...(budget.level !== 'ok' ? { scope: budget.level === 'off' ? 'all' : 'links', resetsAt: budget.resetsAt } : {}),
    ...(origin ? { originAllowed: originAllowed(request, env) } : {}),
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
}

/**
 * `GET /signal/<topic>/stats`: what this account's room has carried, for the Devices page. Only a
 * device holding the sync code knows the topic, so no other secret is needed. Counts only (devices
 * connected, messages and bytes per hour and day); the room never sees content or device ids.
 * Counted and rate-limited like any other call; the app asks at most once a minute.
 */
async function roomStats(request: Request, env: Env, rawTopic: string): Promise<Response> {
  let topic: string;
  try {
    topic = decodeURIComponent(rawTopic);
  } catch {
    return new Response('Bad topic', { status: 400 });
  }
  if (!TOPIC_PATTERN.test(topic)) return new Response('Bad topic', { status: 400 });
  const budget = await gate(env, 2);
  if (budget.level !== 'ok') return refuse(503, 'service', { scope: budget.level === 'off' ? 'all' : 'links', resetsAt: budget.resetsAt }, { 'Retry-After': '3600' });
  // A same-site GET carries no Origin; when there is one it must be allowed.
  if (request.headers.get('Origin') && !originAllowed(request, env)) return refuse(403, 'origin');
  if (!(await within(env.ADDRESS_LIMIT, request.headers.get('CF-Connecting-IP') ?? 'unknown'))) return refuse(429, 'address', {}, { 'Retry-After': '60' });
  return env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(topic)).fetch(new Request(new URL('/stats', request.url), { headers: { 'X-Stats': '1' } }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/signal/status') return status(request, env);
    if (url.pathname === '/signal/admin/stats') return adminStats(request, env);
    const statsMatch = STATS_ROUTE.exec(url.pathname);
    if (statsMatch) return roomStats(request, env, statsMatch[1] ?? '');
    const match = ROUTE.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    let topic: string;
    try {
      topic = decodeURIComponent(match[1] ?? '');
    } catch {
      return new Response('Bad topic', { status: 400 });
    }
    if (!TOPIC_PATTERN.test(topic)) return new Response('Bad topic', { status: 400 });
    // The pair tag (when present) rides in the URL to the room, which tags the socket with it.
    // Every call is counted, refused ones too: Cloudflare bills them all.
    const budget = await gate(env, 1);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    if (budget.level === 'off') return refuse(503, 'service', { scope: 'all', resetsAt: budget.resetsAt }, { 'Retry-After': '3600' });
    if (budget.level === 'links' && match[2]) return refuse(503, 'service', { scope: 'links', resetsAt: budget.resetsAt }, { 'Retry-After': '3600' });
    if (!originAllowed(request, env)) return refuse(403, 'origin');
    // Per account (topic) at one address, so accounts behind one VPN or office address do not
    // crowd each other out; the per-address ceiling still stops one address trying many topics.
    const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await within(env.CONNECT_LIMIT, `${address}|${topic}`)) || !(await within(env.ADDRESS_LIMIT, address))) {
      return refuseSocket(CLOSE_RATE, 'rate retry=60');
    }
    // The room object's own request, charged to the budget with this address's daily share.
    const admitted = await admit(env, address, topic);
    if (admitted !== 'ok') return refuseSocket(CLOSE_DAY, `day scope=${admitted} reset=${budget.resetsAt}`);
    const headers = new Headers(request.headers);
    if (env.RELAY_STATS) headers.set('X-Room', await roomHash(topic));
    return env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(topic)).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;

/** Per-socket state that survives hibernation (the object's memory does not). */
interface Attachment {
  connectedAt: number;
  windowStart: number;
  count: number;
  /** Link sockets: bytes and frames in the current window. */
  bytes?: number;
}

interface Usage {
  day: string;
  bytes: number;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export class SignalRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so an idle room can hibernate.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Usage>('usage');
      if (saved) this.usage = saved;
      this.room = await ctx.storage.get<string>('room');
      await this.loadBuckets();
    });
  }

  /** Short hash of the room's topic, for the operator statistics. */
  private room: string | undefined;

  /** One data point per message: room hash, kind and size; no content, no device ids. */
  private record(kind: 'signal' | 'link', bytes: number): void {
    if (!this.env.RELAY_STATS || !this.room) return;
    try {
      this.env.RELAY_STATS.writeDataPoint({ blobs: [this.room, kind], doubles: [bytes], indexes: [this.room] });
    } catch {
      // Statistics must never break relaying.
    }
  }

  /** Link bytes carried today (UTC). Kept in memory and saved in batches, so a hibernating room loses at most a few KiB of count. */
  private usage: Usage = { day: '', bytes: 0 };
  private unsaved = 0;
  /** Messages not yet reported to the budget, and the level it last answered with. */
  private unreported = 0;
  private level: Level = 'ok';
  /** Message and byte counts per 10 minutes, saved in batches like the byte usage. */
  private buckets: Bucket[] = [];
  private bucketsUnsaved = 0;

  private async loadBuckets(): Promise<void> {
    this.buckets = (await this.ctx.storage.get<Bucket[]>('buckets')) ?? [];
  }

  private countTraffic(bytes: number): void {
    const t = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    let last = this.buckets[this.buckets.length - 1];
    if (!last || last.t !== t) {
      last = { t, m: 0, b: 0 };
      this.buckets.push(last);
      this.buckets = this.buckets.filter((x) => t - x.t < BUCKETS_KEPT * BUCKET_MS);
    }
    last.m += 1;
    last.b += bytes;
    if (++this.bucketsUnsaved >= STATS_SAVE_MESSAGES) this.saveBuckets();
  }

  private saveBuckets(): void {
    this.bucketsUnsaved = 0;
    void this.ctx.storage.put('buckets', this.buckets);
  }

  private stats(): Response {
    const now = Date.now();
    const sum = (ms: number): { messages: number; bytes: number } =>
      this.buckets.filter((x) => now - (x.t + BUCKET_MS) < ms).reduce((a, x) => ({ messages: a.messages + x.m, bytes: a.bytes + x.b }), { messages: 0, bytes: 0 });
    const sockets = this.ctx.getWebSockets();
    const links = sockets.filter((ws) => linkTagOf(this.ctx.getTags(ws))).length;
    const last = this.buckets[this.buckets.length - 1];
    return new Response(
      JSON.stringify({
        service: 'yak-relay',
        devices: sockets.length - links,
        links,
        hour: sum(60 * 60 * 1000),
        day: sum(24 * 60 * 60 * 1000),
        ...(last ? { lastActivity: Math.floor((last.t + BUCKET_MS) / 1000) } : {}),
      }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } },
    );
  }

  /** Adds a message to the count; every REPORT_EVERY_MESSAGES the budget object is told and its level read back. */
  private countMessage(): void {
    this.unreported += 1;
    if (this.unreported >= REPORT_EVERY_MESSAGES) this.report();
  }

  private report(): void {
    const requests = Math.ceil(this.unreported / MESSAGES_PER_REQUEST);
    this.unreported = 0;
    if (requests === 0) return;
    this.env.RELAY_BUDGET.get(this.env.RELAY_BUDGET.idFromName('budget'))
      .charge(requests)
      .then((state) => {
        this.level = this.env.RELAY === 'off' ? 'off' : state.level;
      })
      .catch(() => undefined);
  }

  /** Counts a link frame against the room's daily budget; false when it is spent. */
  private charge(bytes: number): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (this.usage.day !== day) this.usage = { day, bytes: 0 };
    const cap = Number(this.env.RELAY_DAY_BYTES) || DEFAULT_DAY_BYTES;
    if (this.usage.bytes + bytes > cap) return false;
    this.usage.bytes += bytes;
    this.unsaved += bytes;
    if (this.unsaved >= USAGE_SAVE_BYTES) this.saveUsage();
    return true;
  }

  private saveUsage(): void {
    this.unsaved = 0;
    void this.ctx.storage.put('usage', this.usage);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('X-Stats') === '1') return this.stats();
    const room = request.headers.get('X-Room');
    if (room && room !== this.room) {
      this.room = room;
      void this.ctx.storage.put('room', room);
    }
    const pair = ROUTE.exec(new URL(request.url).pathname)?.[2];
    if (pair) return this.acceptLink(pair);
    const existing = this.ctx.getWebSockets().filter((ws) => this.ctx.getTags(ws).length === 0);
    if (existing.length >= MAX_SOCKETS_PER_ROOM) {
      // A device that slept leaves a half-open socket the server has not noticed yet; make room
      // for the live one by dropping the oldest instead of locking the device out.
      const oldest = [...existing].sort((a, b) => connectedAt(a) - connectedAt(b))[0];
      oldest?.close(1008, 'replaced by a newer connection');
    }
    const pairSockets = new WebSocketPair();
    const [client, server] = [pairSockets[0], pairSockets[1]];
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { connectedAt: Date.now(), windowStart: Date.now(), count: 0 };
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ event: 'open', time: nowSeconds() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A data link socket for one device pair; at most two per pair, the newest replacing the oldest. */
  private acceptLink(pair: string): Response {
    const tag = linkTag(pair);
    const existing = this.ctx.getWebSockets(tag);
    if (existing.length >= 2) {
      const oldest = [...existing].sort((a, b) => connectedAt(a) - connectedAt(b))[0];
      oldest?.close(1008, 'replaced by a newer connection');
    }
    const sockets = new WebSocketPair();
    const [client, server] = [sockets[0], sockets[1]];
    this.ctx.acceptWebSocket(server, [tag]);
    const attachment: Attachment = { connectedAt: Date.now(), windowStart: Date.now(), count: 0, bytes: 0 };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.countMessage();
    this.countTraffic(typeof message === 'string' ? message.length : message.byteLength);
    const tag = linkTagOf(this.ctx.getTags(ws));
    this.record(tag ? 'link' : 'signal', typeof message === 'string' ? message.length : message.byteLength);
    if (tag) {
      this.forwardLink(ws, tag, message);
      return;
    }
    if (typeof message !== 'string') {
      ws.close(1003, 'text only');
      return;
    }
    // `.length` counts UTF-16 units, so only measure bytes when it could matter.
    if (message.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) {
      ws.close(1009, 'message too large');
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment | null;
    const now = Date.now();
    const state: Attachment = attachment ?? { connectedAt: now, windowStart: now, count: 0 };
    if (now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
      state.windowStart = now;
      state.count = 0;
    }
    state.count += 1;
    ws.serializeAttachment(state);
    if (state.count > RATE_LIMIT_MESSAGES) {
      ws.close(1008, 'rate limit');
      return;
    }
    if (this.level === 'off') return; // the whole budget is spent: nothing more is relayed
    const frame = JSON.stringify({ id: crypto.randomUUID(), time: nowSeconds(), message });
    for (const other of this.ctx.getWebSockets()) {
      // Link sockets carry sealed data frames, never signaling.
      if (other === ws || this.ctx.getTags(other).length > 0) continue;
      try {
        other.send(frame);
      } catch {
        // A socket that is already closing is skipped.
      }
    }
  }

  /** Forward a sealed binary frame to the other socket of the pair; the relay cannot read it. */
  private forwardLink(ws: WebSocket, tag: string, message: string | ArrayBuffer): void {
    if (typeof message === 'string') {
      // Keepalive pings are answered by the runtime and never get here; any other text is refused.
      ws.close(1003, 'binary only');
      return;
    }
    if (message.byteLength > MAX_LINK_FRAME_BYTES) {
      ws.close(1009, 'frame too large');
      return;
    }
    const now = Date.now();
    const state = (ws.deserializeAttachment() as Attachment | null) ?? { connectedAt: now, windowStart: now, count: 0, bytes: 0 };
    if (now - state.windowStart >= LINK_RATE_WINDOW_MS) {
      state.windowStart = now;
      state.count = 0;
      state.bytes = 0;
    }
    state.count += 1;
    state.bytes = (state.bytes ?? 0) + message.byteLength;
    ws.serializeAttachment(state);
    if (state.count > LINK_RATE_FRAMES || state.bytes > LINK_RATE_BYTES) {
      ws.send(JSON.stringify({ event: 'limit', reason: 'rate' }));
      ws.close(1008, 'rate limit');
      return;
    }
    if (this.level !== 'ok') {
      this.tellLimit(tag, 'service');
      return;
    }
    if (!this.charge(message.byteLength)) {
      // Tell both devices so each can say so; direct sync is unaffected.
      this.tellLimit(tag, 'day');
      return;
    }
    for (const other of this.ctx.getWebSockets(tag)) {
      if (other === ws) continue;
      try {
        other.send(message);
      } catch {
        // A socket that is already closing is skipped.
      }
    }
  }

  override webSocketClose(ws: WebSocket): void {
    // Nothing to clean up: the room is whatever sockets are open. The runtime answers a client's
    // Close frame by itself (compatibility date after 2022-10-31). A link's other device is told
    // so it stops sending into the void.
    this.tellLeft(ws);
    if (this.unsaved > 0) this.saveUsage();
    if (this.bucketsUnsaved > 0) this.saveBuckets();
    this.report();
  }

  override webSocketError(ws: WebSocket, _error: unknown): void {
    this.tellLeft(ws);
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
  }

  private tellLimit(tag: string, reason: 'day' | 'service'): void {
    for (const socket of this.ctx.getWebSockets(tag)) {
      try {
        socket.send(JSON.stringify({ event: 'limit', reason }));
      } catch {
        // Already closing.
      }
    }
  }

  private tellLeft(ws: WebSocket): void {
    const tag = linkTagOf(this.ctx.getTags(ws));
    if (!tag) return;
    for (const other of this.ctx.getWebSockets(tag)) {
      if (other === ws) continue;
      try {
        other.send(JSON.stringify({ event: 'left' }));
      } catch {
        // Already closing.
      }
    }
  }
}

const linkTag = (pair: string): string => `link:${pair}`;
const linkTagOf = (tags: string[]): string | undefined => tags.find((t) => t.startsWith('link:'));

function connectedAt(ws: WebSocket): number {
  return (ws.deserializeAttachment() as Attachment | null)?.connectedAt ?? 0;
}

/**
 * One object for the whole relay: the estimated Cloudflare requests spent today. Workers and rooms
 * report in batches, so this object itself sees few calls (each one is a request too).
 */
export class RelayBudget extends DurableObject<Env> {
  private day = '';
  private used = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<{ day: string; used: number }>('budget');
      if (saved) ({ day: this.day, used: this.used } = saved);
    });
  }

  /** Starts a new day: the count and every address's tally go back to zero. */
  private async rollover(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.day === today) return;
    this.day = today;
    this.used = 0;
    await this.ctx.storage.delete([...(await this.ctx.storage.list({ prefix: 'addr:' })).keys()]);
  }

  /**
   * One accepted socket from an address (both arguments hashed): counts 2 requests for the account
   * and holds that address to its share of the day (ADDRESS_DAY_SHARE of the budget) and to
   * ADDRESS_DAY_TOPICS different topics, so one client cannot spend the budget for everyone. Only
   * hashes and counts are stored, until UTC midnight.
   */
  async admit(address: string, topic: string): Promise<'ok' | 'share' | 'topics'> {
    await this.rollover();
    const limit = Number(this.env.RELAY_DAY_REQUESTS) || DEFAULT_DAY_REQUESTS;
    const share = Math.max(2, Math.floor(limit * (Number(this.env.ADDRESS_DAY_SHARE) || DEFAULT_ADDRESS_SHARE)));
    const maxTopics = Number(this.env.ADDRESS_DAY_TOPICS) || DEFAULT_ADDRESS_TOPICS;
    const key = `addr:${address}`;
    const tally = (await this.ctx.storage.get<{ spent: number; topics: string[] }>(key)) ?? { spent: 0, topics: [] };
    if (tally.spent + 2 > share) return 'share';
    if (!tally.topics.includes(topic)) {
      if (tally.topics.length >= maxTopics) return 'topics';
      tally.topics.push(topic);
    }
    tally.spent += 2;
    this.used += 2;
    await this.ctx.storage.put(key, tally);
    await this.ctx.storage.put('budget', { day: this.day, used: this.used });
    return 'ok';
  }

  /** Adds `requests` to today's count and returns where the budget stands. */
  async charge(requests: number): Promise<BudgetState> {
    await this.rollover();
    this.used += Math.max(0, Math.floor(requests));
    await this.ctx.storage.put('budget', { day: this.day, used: this.used });
    const limit = Number(this.env.RELAY_DAY_REQUESTS) || DEFAULT_DAY_REQUESTS;
    const level: Level = this.used >= limit ? 'off' : this.used >= limit * LINKS_OFF_SHARE ? 'links' : 'ok';
    return { level, resetsAt: nextMidnight() };
  }
}
