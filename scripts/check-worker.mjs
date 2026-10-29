// Checks the real Worker (worker/index.ts) under `wrangler dev`: the Origin rule, the per-address
// and per-topic connection limits (refused as an accepted upgrade closed with code 4429 or 4430), the per-room daily byte cap, the account-wide request budget, the kill switch
// and `GET /signal/status`. Small limits are set with `--var`, each phase on a fresh state.
//
//   npm run build && node scripts/check-worker.mjs   # starts `npx wrangler@4.151.0 dev` itself (needs the network once)
//
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const PORT = 8799;
const HOST = `127.0.0.1:${PORT}`;
const topic = (n) => `yk-${n.toString(16).padStart(32, '0')}`;
const pair = 'c'.repeat(32);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (cond, msg) => { console.log(cond ? 'ok  :' : 'FAIL:', msg); if (!cond) failed++; };

/** Runs `fn` against a fresh wrangler dev with the given vars, then stops it. */
async function withWorker(vars, fn) {
  const state = mkdtempSync(join(tmpdir(), 'yak-wrangler-'));
  const args = ['--yes', 'wrangler@4.151.0', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  const wrangler = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  wrangler.stdout.on('data', (d) => (log += d));
  wrangler.stderr.on('data', (d) => (log += d));
  const stop = () => { try { process.kill(-wrangler.pid, 'SIGTERM'); } catch { /* already gone */ } };
  try {
    for (let i = 0; i < 300 && !/Ready on/.test(log); i++) await sleep(200);
    if (!/Ready on/.test(log)) { console.log(log); throw new Error('wrangler did not start'); }
    await fn();
  } finally {
    stop();
    await sleep(500);
    rmSync(state, { recursive: true, force: true });
  }
}

/** Resolves `{ ws }` when the upgrade works, or `{ status, body, headers }` when the server refused it. */
const connect = (path, origin = `http://${HOST}`) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://${HOST}/signal/${path}`, { headers: origin === null ? {} : { Origin: origin } });
    ws.on('open', () => {
      // A refusal is an accepted upgrade closed at once with a code (4429, 4430), not an HTTP status.
      const closed = new Promise((done) => ws.on('close', (code, reason) => done({ code, reason: reason.toString() })));
      resolve({ ws, closed });
    });
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    ws.on('error', () => {});
  });
/** Like `connect`, but an upgrade that is closed at once comes back as `{ code, reason }` (a refusal) with no `ws`. */
const attempt = async (path, origin) => {
  const r = await connect(path, origin);
  if (!r.ws) return r;
  const closed = await Promise.race([r.closed, sleep(150).then(() => undefined)]);
  return closed ? closed : r;
};
const json = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const getStatus = async () => { const r = await fetch(`http://${HOST}/signal/status`, { headers: { Origin: 'https://relay.example' } }); return { status: r.status, body: await r.json(), headers: r.headers }; };

// Phase 1: Origin, byte cap, address limit, readable refusals.
await withWorker({ RELAY_DAY_BYTES: 100_000, ALLOWED_ORIGINS: 'https://relay.example' }, async () => {
  const none = await connect(topic(1), null);
  check(none.status === 403 && json(none).service === 'yak-relay' && json(none).reason === 'origin', 'no Origin header is refused (403), in JSON the app can read');
  check(none.headers['x-relay-limit'] === 'origin', 'the refusal names its reason in X-Relay-Limit');
  check((await connect(topic(1), 'https://evil.example')).status === 403, 'another site is refused (403)');
  for (const o of [`http://${HOST}`, 'app://obsidian.md', 'capacitor://localhost', 'https://relay.example']) {
    const r = await connect(topic(1), o);
    check(!!r.ws, `${o} is allowed`);
    r.ws?.close();
  }

  const st = await getStatus();
  check(st.status === 200 && st.body.service === 'yak-relay' && st.body.state === 'ok', '/signal/status answers ok with the marker field');
  check(st.body.originAllowed === true && st.headers.get('access-control-allow-origin') === '*', 'status says the Origin is allowed and can be read from another page');

  const a = (await connect(`${topic(2)}/link/${pair}`)).ws;
  const b = (await connect(`${topic(2)}/link/${pair}`)).ws;
  const gotA = [];
  const gotB = [];
  a.on('message', (d, bin) => !bin && gotA.push(d.toString()));
  let delivered = 0;
  b.on('message', (d, bin) => (bin ? delivered++ : gotB.push(d.toString())));
  const frame = Buffer.alloc(20_000, 1);
  for (let i = 0; i < 4; i++) a.send(frame);
  await sleep(700);
  check(delivered === 4, `frames within the room cap are delivered (${delivered} of 4)`);
  for (let i = 0; i < 4; i++) a.send(frame);
  await sleep(700);
  check(delivered === 5, `frames beyond ${100_000} bytes a day are dropped (${delivered} delivered of 8)`);
  check(gotA.some((m) => m.includes('"day"')) && gotB.some((m) => m.includes('"day"')), 'both devices are told the room limit is reached');
  a.close();
  b.close();

  const results = [];
  let refused;
  for (let i = 0; i < 70; i++) {
    const r = await attempt(topic(500));
    results.push(r.code ?? 101);
    if (r.code === 4429) refused ??= r;
    r.ws?.close();
  }
  check(results.includes(4429) && refused.reason === 'rate retry=60', `an address that opens many connections to one topic gets the upgrade closed with 4429 "rate retry=60" (${results.filter((s) => s === 4429).length} of 70)`);
  check(!results.includes(429), 'no HTTP 429 on the handshake: a browser could not read it');
  check(results.slice(0, 10).every((s) => s === 101), 'the first connections are accepted');
  // Another account at the same address (a shared VPN or office) is not crowded out.
  const other = await attempt(topic(501));
  check(other.ws !== undefined, `another topic from the same address is still accepted (${other.code ?? other.status ?? 101})`);
  other.ws?.close();
});

// Phase: one address cannot cycle topics or spend more than its daily share.
await withWorker({ ALLOWED_ORIGINS: 'https://relay.example', ADDRESS_DAY_TOPICS: 3 }, async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await attempt(topic(700 + i));
    statuses.push(r.code ?? 101);
    if (r.code === 4430) check(/^day scope=topics reset=\d{10}$/.test(r.reason) && Number(r.reason.split('reset=')[1]) * 1000 > Date.now(), 'the topic cap closes with 4430 "day scope=topics reset=<unix s>", the reset in the future');
    r.ws?.close();
  }
  check(statuses.slice(0, 3).every((s) => s === 101) && statuses.slice(3).every((s) => s === 4430), `an address gets 3 new topics a day, then 4430 (${statuses.join(' ')})`);
  const again = await attempt(topic(700));
  check(again.ws !== undefined, 'a topic it already used is still accepted');
  again.ws?.close();
});
await withWorker({ ALLOWED_ORIGINS: 'https://relay.example', RELAY_DAY_REQUESTS: 100, ADDRESS_DAY_SHARE: 0.1 }, async () => {
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const r = await attempt(topic(800));
    statuses.push(r.code ?? 101);
    if (r.code === 4430) check(r.reason.startsWith('day scope=share reset='), 'the daily share closes with 4430, scope "share"');
    r.ws?.close();
    await sleep(50);
  }
  check(statuses.filter((s) => s === 101).length === 5 && statuses[7] === 4430, `an address spends at most its share of the day's budget (${statuses.join(' ')})`);
});

// The default per-address share is 10% of the day's budget (an office of 10 to 20 people behind one address).
await withWorker({ ALLOWED_ORIGINS: 'https://relay.example', RELAY_DAY_REQUESTS: 100 }, async () => {
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const r = await attempt(topic(900));
    statuses.push(r.code ?? 101);
    r.ws?.close();
    await sleep(50);
  }
  check(statuses.filter((s) => s === 101).length === 5 && statuses[6] === 4430, `by default an address spends 10% of the day's budget (${statuses.join(' ')})`);
});

// Non-WebSocket endpoints keep HTTP 429: the status call past the per-address ceiling.
await withWorker({ ALLOWED_ORIGINS: 'https://relay.example' }, async () => {
  const codes = [];
  for (let i = 0; i < 140; i++) codes.push((await fetch(`http://${HOST}/signal/status`)).status);
  check(codes.includes(429), `/signal/status past the address ceiling still answers HTTP 429 (${codes.filter((c) => c === 429).length} of 140)`);
});

// Phase 2: the account-wide request budget. 40 requests a day; the budget object is told every 4.
await withWorker({ RELAY_DAY_REQUESTS: 40, RELAY_FLUSH_REQUESTS: 4 }, async () => {
  const early = await connect(`${topic(3)}/link/${pair}`);
  check(!!early.ws, 'with budget left, a data link opens');
  early.ws?.close();
  let linkRefused;
  let signalingRefused;
  const kept = [];
  for (let i = 0; i < 26 && !signalingRefused; i++) {
    const link = await connect(`${topic(200 + i)}/link/${pair}`);
    if (link.status === 503) linkRefused ??= { at: i, ...link };
    link.ws?.close();
    const sig = await connect(topic(300 + i));
    if (sig.status === 503) signalingRefused = { at: i, ...sig };
    else if (sig.ws) kept.push(sig.ws);
  }
  kept.forEach((w) => w.close());
  const ln = linkRefused && json(linkRefused);
  check(ln?.reason === 'service' && ln?.scope === 'links' && linkRefused.headers['x-relay-limit'] === 'service', `at 80% of the budget new data links get 503 "service" (after ${linkRefused?.at} rounds)`);
  const sn = signalingRefused && json(signalingRefused);
  check(sn?.reason === 'service' && sn?.scope === 'all' && typeof sn?.resetsAt === 'number', `past the whole budget signaling is refused too, with the reset time (after ${signalingRefused?.at} rounds)`);
  check(!linkRefused || !signalingRefused || linkRefused.at < signalingRefused.at, 'links were refused before signaling');
  const st = await getStatus();
  check(st.body.state === 'limited' && st.body.scope === 'all' && typeof st.body.resetsAt === 'number', '/signal/status reports the budget as spent, with when it resets');
});

// Phase 3: the kill switch.
await withWorker({ RELAY: 'off' }, async () => {
  const r = await connect(topic(4));
  check(r.status === 503 && json(r).reason === 'service', 'RELAY=off refuses every connection (503 "service")');
  const st = await getStatus();
  check(st.body.state === 'limited', '/signal/status says so');
});

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
