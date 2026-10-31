// A local stand-in for the Worker signaling relay (worker/index.ts), for unit tests and offline
// development. Same wire protocol: /signal/<topic> WebSocket rooms, an `open` event on connect,
// messages relayed to the other sockets as {id, time, message}, `ping` answered `pong`, topic,
// size and room-size limits, and `/signal/<topic>/link/<pair>` data links (binary frames forwarded
// to the other socket, `left` event). Nothing is stored.
//
//   node scripts/mock-relay.mjs 8789     # then use ws://localhost:8789/signal as the signaling server
//
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

// Keep in step with worker/index.ts.
const TOPIC_PATTERN = /^yk-[0-9a-f]{32}$/;
const MAX_SOCKETS_PER_ROOM = 16;
const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_LINK_FRAME_BYTES = 64 * 1024;

/**
 * @param {{ port?: number, now?: () => number }} [options]
 */
export async function startMockRelay(options = {}) {
  const now = options.now ?? (() => Date.now());
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const rooms = new Map();
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const links = new Map();
  const state = { links: 0, linkFrames: 0, linkBytes: 0, connections: 0, rejected: 0, messages: 0, pings: 0, refused: 0, silent: false };
  /** Refuse the next `count` upgrades the way the Worker does (accept, then close with a code); see `refuse()`. */
  let refusing;

  /** Traffic per topic, for `GET /signal/<topic>/stats` (the Worker keeps buckets; the mock keeps totals). */
  const traffic = new Map();
  const count = (topic, bytes) => {
    const t = traffic.get(topic) ?? { messages: 0, bytes: 0, last: 0 };
    t.messages += 1;
    t.bytes += bytes;
    t.last = Math.floor(now() / 1000);
    traffic.set(topic, t);
  };
  /** The relay-wide totals every user sees (#109); the mock counts open rooms and sockets only. */
  const totals = () => {
    let accounts = 0;
    let devices = 0;
    for (const sockets of rooms.values()) if (sockets.size > 0) { accounts++; devices += sockets.size; }
    let messages = 0;
    for (const t of traffic.values()) messages += t.messages;
    const perHour = Array.from({ length: 24 }, () => 0);
    perHour[23] = messages;
    return { accountsNow: accounts, devicesNow: devices, accountsToday: accounts, devicesToday: devices, sharesToday: 0, usedShare: 0, messagesPerHour: perHour };
  };
  const server = createServer((req, res) => {
    const stats = /^\/signal\/([^/?]+)\/stats(?:\?|$)/.exec(req.url ?? '');
    if (stats && TOPIC_PATTERN.test(stats[1])) {
      const topic = stats[1];
      const t = traffic.get(topic);
      let linkCount = 0;
      for (const [key, sockets] of links) if (key.startsWith(`${topic}/`)) linkCount += sockets.size;
      const total = { messages: t?.messages ?? 0, bytes: t?.bytes ?? 0 };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ service: 'yak-relay', devices: rooms.get(topic)?.size ?? 0, links: linkCount, hour: total, day: total, ...(t ? { lastActivity: t.last } : {}), relay: totals() }));
      return;
    }
    // The operator's usage (#109): only for the mock's own key; any other key gets 404, like a Worker without ADMIN_KEY.
    if (/^\/signal\/admin\/usage(?:\?|$)/.test(req.url ?? '') && req.headers.authorization === 'Bearer mock-admin-key') {
      const t = totals();
      const today = Array.from({ length: 24 }, () => 0);
      today[new Date(now()).getUTCHours()] = 120;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ service: 'yak-relay', now: now(), used: 120, limit: 50000, linksOffAt: 40000, planLimit: 100000, resetsAt: 0, requestsPerHour: { today, yesterday: today.map(() => 0) }, messagesPerHour: { today, yesterday: today.map(() => 0) }, rooms: { accounts: t.accountsToday, shares: 0, invites: 0, other: 0 }, devicesToday: t.devicesToday, accountsNow: t.accountsNow, devicesNow: t.devicesNow, linksNow: 0, linkPairsToday: 0, history: [] }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const match = /^\/signal\/([^/?]+)(?:\/link\/([0-9a-f]{32}))?(?:\?|$)/.exec(req.url ?? '');
    let topic = '';
    try {
      topic = match ? decodeURIComponent(match[1]) : '';
    } catch {
      topic = '';
    }
    if (!TOPIC_PATTERN.test(topic)) {
      state.rejected += 1;
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const pair = match?.[2];
    if (refusing && refusing.count > 0) {
      const { code, reason } = refusing;
      refusing.count -= 1;
      state.refused += 1;
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => {});
        ws.close(code, reason);
      });
      return;
    }
    if (pair) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const key = `${topic}/${pair}`;
        let sockets = links.get(key);
        if (!sockets) links.set(key, (sockets = new Set()));
        if (sockets.size >= 2) {
          const oldest = sockets.values().next().value;
          oldest?.close(1008, 'replaced by a newer connection');
          sockets.delete(oldest);
        }
        sockets.add(ws);
        state.links += 1;
        ws.on('message', (data, isBinary) => {
          const text = isBinary ? undefined : data.toString('utf8');
          if (text === 'ping') return ws.send('pong');
          if (!isBinary) return ws.close(1003, 'binary only');
          const frame = Buffer.isBuffer(data) ? data : Buffer.concat(data);
          if (frame.length > MAX_LINK_FRAME_BYTES) return ws.close(1009, 'frame too large');
          state.linkFrames += 1;
          state.linkBytes += frame.length;
          count(topic, frame.length);
          api.onFrame?.(frame);
          for (const other of sockets) if (other !== ws && other.readyState === other.OPEN) other.send(frame, { binary: true });
        });
        ws.on('close', () => {
          sockets.delete(ws);
          for (const other of sockets) if (other.readyState === other.OPEN) other.send(JSON.stringify({ event: 'left' }));
          if (sockets.size === 0) links.delete(key);
        });
        ws.on('error', () => {});
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(topic);
      if (!room) rooms.set(topic, (room = new Set()));
      if (room.size >= MAX_SOCKETS_PER_ROOM) {
        const oldest = room.values().next().value;
        oldest?.close(4000, 'replaced by a newer connection');
        room.delete(oldest);
      }
      room.add(ws);
      state.connections += 1;
      ws.send(JSON.stringify({ event: 'open', time: Math.floor(now() / 1000) }));
      ws.on('message', (data, isBinary) => {
        if (isBinary) return ws.close(1003, 'text only');
        const text = data.toString('utf8');
        if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) return ws.close(1009, 'message too large');
        if (text === 'ping') {
          state.pings += 1;
          if (!state.silent) ws.send('pong');
          return;
        }
        state.messages += 1;
        count(topic, Buffer.byteLength(text));
        const frame = JSON.stringify({ id: randomUUID(), time: Math.floor(now() / 1000), message: text });
        for (const other of room) if (other !== ws && other.readyState === other.OPEN) other.send(frame);
      });
      ws.on('close', () => {
        room.delete(ws);
        if (room.size === 0) rooms.delete(topic);
      });
      ws.on('error', () => {});
    });
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const api = {
    /** @type {((frame: Buffer) => void) | undefined} */
    onFrame: undefined,
    url: `ws://127.0.0.1:${port}/signal`,
    httpUrl: `http://127.0.0.1:${port}`,
    state,
    /** Abruptly close every socket, as a proxy or restart would. */
    dropAll() {
      for (const room of rooms.values()) for (const ws of room) ws.terminate();
      for (const sockets of links.values()) for (const ws of sockets) ws.terminate();
    },
    /** Tell every link socket the relay's budget is spent (tests); `reason` is `day` or `rate`. */
    limitLinks(reason) {
      for (const sockets of links.values()) for (const ws of sockets) ws.send(JSON.stringify({ event: 'limit', reason }));
    },
    /**
     * Refuse the next `count` upgrades (all when omitted) like the Worker: accept, then close at once
     * with 4429 `rate retry=<s>` or 4430 `day scope=<share|topics> reset=<unix s>`. `refuse(null)` stops.
     */
    refuse(kind, options = {}) {
      if (!kind) {
        refusing = undefined;
        return;
      }
      const reason = kind === 'rate' ? `rate retry=${options.retry ?? 60}` : `day scope=${options.scope ?? 'share'} reset=${options.reset ?? Math.floor(now() / 1000) + 3600}`;
      refusing = { code: kind === 'rate' ? 4429 : 4430, reason, count: options.count ?? Infinity };
    },
    openSockets() {
      let n = 0;
      for (const room of rooms.values()) n += room.size;
      return n;
    },
    close() {
      for (const room of rooms.values()) for (const ws of room) ws.terminate();
      for (const sockets of links.values()) for (const ws of sockets) ws.terminate();
      return new Promise((resolve) => {
        wss.close();
        server.close(() => resolve(undefined));
        server.closeAllConnections?.();
      });
    },
  };
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 8789);
  const relay = await startMockRelay({ port });
  console.log(`mock relay listening on ${relay.url}`);
}
