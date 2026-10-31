// End-to-end: two devices whose WebRTC can never connect (ICE restricted to relay candidates with
// none available) still sync both ways through the site relay, the Devices row says so, and once
// WebRTC is allowed again the pair moves to a direct link.
//
//   npm run e2e relay-fallback
//
import { BASE, launch, ok, fail, watchPage, until, finish, keepAllSpaces, openJoin, startSyncing, joinByInvite, openAdvanced } from './lib.mjs';

const browser = await launch({ fakeCamera: true, fastTimers: true });
const mk = async (n) => {
  const context = await browser.newContext({ permissions: ['camera'] });
  // While window.__blockRtc is true every peer connection is limited to TURN candidates, and there
  // are no TURN servers: no path can open.
  await context.addInitScript(() => {
    window.__blockRtc = true;
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config = {}) {
        super(window.__blockRtc ? { ...config, iceTransportPolicy: 'relay' } : config);
      }
    };
  });
  const page = await context.newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  return page;
};
const st = (p) => p.evaluate(() => window.__app.state());
// The other device's row on Settings, opened (its state line is in the open row).
const rowText = async (p) => {
  if (!(await p.locator('.st-home').count())) await p.evaluate(() => { location.hash = '#/settings/devices-sync'; });
  const r = p.locator('[data-device-row]:not([data-device-row="this"])').first();
  await r.waitFor();
  const head = r.locator('.st-row-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  return r.innerText();
};

const a = await mk('A');
const b = await mk('B');
await startSyncing(a);
await joinByInvite(a, b);

const t = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 30000);
t >= 0 ? ok(`connected without WebRTC in ${t} ms`) : fail('did not connect through the relay');
const label = await until(async () => /through the relay/.test(await rowText(a)), 5000);
label >= 0 ? ok('the device row says it syncs through the relay') : fail(`device row: ${await rowText(a)}`);

// #110: the row gives the last direct attempt's reason, and the connection report lists attempts without addresses.
const why = await until(async () => /Why not directly: .*offered no addresses/.test(await rowText(a)), 30000);
why >= 0 ? ok('the device row says why not directly') : fail(`no reason on the row: ${await rowText(a)}`);
{
  const fold = await openAdvanced(a);
  const report = fold.locator('details', { has: a.locator('summary', { hasText: 'Connection report' }) });
  await report.locator('summary').click();
  await until(async () => /Other device 1/.test(await report.locator('pre').innerText()), 5000);
  const text = await report.locator('pre').innerText();
  /Other device 1: connected \(relay\)/.test(text) && /no addresses/.test(text) && !/\d+\.\d+\.\d+\.\d+/.test(text.split('\n').slice(3).join('\n'))
    ? ok('the connection report lists the attempts, without addresses')
    : fail(`connection report: ${text}`);
  await a.evaluate(() => { location.hash = '#/settings/devices-sync'; });
}

await a.evaluate(() => window.__app.append('space/work', 't', 'from A '));
await b.evaluate(() => window.__app.append('space/work', 't', 'from B '));
const same = await until(async () => {
  const [x, y] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__app.text('space/work', 't'))));
  return x === y && x.includes('from A') && x.includes('from B');
}, 10000);
same >= 0 ? ok('edits converged both ways through the relay') : fail('edits did not converge through the relay');

await b.evaluate(() => window.__app.append('space/work', 'big', 'x'.repeat(600_000) + ' end'));
const big = await until(async () => (await a.evaluate(() => window.__app.text('space/work', 'big'))).endsWith(' end'), 30000);
big >= 0 ? ok(`600 kB edit arrived through the relay in ${big} ms`) : fail('large edit did not arrive through the relay');

// Allow WebRTC: the initiator's next offer (within a minute) opens a direct link.
await Promise.all([a, b].map((p) => p.evaluate(() => { window.__blockRtc = false; })));
const direct = await until(async () => !/through the relay/.test(await rowText(a)) && /Syncing/.test(await rowText(a)), 90000);
direct >= 0 ? ok(`switched to a direct link in ${direct} ms`) : fail(`still on the relay: ${await rowText(a)}`);
await a.evaluate(() => window.__app.append('space/work', 't', 'after switch '));
const after = await until(async () => (await b.evaluate(() => window.__app.text('space/work', 't'))).includes('after switch'), 10000);
after >= 0 ? ok('edit synced after the switch') : fail('edit did not sync after the switch');

await finish(browser);
