// End-to-end: the default signaling server is this site's own relay. Two profiles pair without
// touching the Connection server field, and two profiles holding a pairing stored on ntfy.sh (the
// old default) move to the relay on load and connect. Requests to ntfy.sh are blocked and counted.
//
//   npm run e2e relay-default
//
import { BASE, launch, ok, fail, watchPage, until, finish, keepAllSpaces, openJoin, openAdvanced, startSyncing, joinByInvite } from './lib.mjs';

const RELAY = BASE.replace(/^http/, 'ws').replace(/\/$/, '') + '/signal';

const browser = await launch({ fakeCamera: true, fastTimers: true });
let ntfyRequests = 0;
const mk = async (n) => {
  const context = await browser.newContext({ permissions: ['camera'] });
  await context.route('https://ntfy.sh/**', (route) => { ntfyRequests++; return route.abort(); });
  const page = await context.newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  return page;
};
const st = (p) => p.evaluate(() => window.__app.state());
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('app-app-pairing') ?? 'null'));

// 1. A fresh pairing with the default setting.
const a = await mk('A');
const b = await mk('B');
await (await openJoin(a)).locator('summary', { hasText: /^Connection server$/ }).click();
const shown = await a.locator('input[aria-label="Connection server"]').inputValue();
shown === RELAY ? ok(`default signaling server is ${shown}`) : fail(`default signaling server is ${shown}, expected ${RELAY}`);
await startSyncing(a);
const secret = await joinByInvite(a, b);
const t = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
t >= 0 ? ok(`paired over the site relay in ${t} ms`) : fail('did not connect over the site relay');
await a.evaluate(() => window.__app.append('space/work', 't', 'via site relay '));
// Settings › Advanced counts this account's relay room: two devices connected, some messages today.
await openAdvanced(a);
(await until(async () => /Relay: 2 devices connected · [1-9]\d* messages? today/.test(await a.locator('.relay-stats summary').textContent().catch(() => '')), 90000)) >= 0
  ? ok('Advanced shows the relay room stats') : fail(`relay stats: ${await a.locator('.relay-stats').textContent().catch(() => 'missing')}`);
(await until(async () => (await b.evaluate(() => window.__app.text('space/work', 't'))).includes('via site relay'), 5000)) >= 0
  ? ok('edit synced') : fail('edit did not sync');
const sa = await stored(a);
sa?.signalingUrl === RELAY && sa?.signalingVersion === 2 ? ok('stored pairing names the relay') : fail(`stored pairing: ${JSON.stringify({ ...sa, secret: undefined })}`);

// 2. Two devices with a pairing stored under the old ntfy.sh default move to the relay together.
const c = await mk('C');
const d = await mk('D');
const old = { secret, signalingUrl: 'https://ntfy.sh' };
for (const p of [c, d]) {
  await p.evaluate((v) => localStorage.setItem('app-app-pairing', JSON.stringify(v)), old);
  await p.reload();
}
await a.close();
await b.close();
const m = await until(async () => (await st(c)) === 'connected' && (await st(d)) === 'connected', 20000);
m >= 0 ? ok(`old ntfy.sh pairings migrated and connected in ${m} ms`) : fail('migrated pairings did not connect');
const sc = await stored(c);
sc?.signalingUrl === RELAY && sc?.signalingVersion === 2 ? ok('migration saved') : fail(`after migration: ${JSON.stringify({ ...sc, secret: undefined })}`);

// 3. ntfy.sh stays selectable and is kept once chosen.
const e = await mk('E');
await (await openJoin(e)).locator('summary', { hasText: /^Connection server$/ }).click();
await e.getByRole('button', { name: 'ntfy.sh', exact: true }).click();
const chosen = await e.locator('input[aria-label="Connection server"]').inputValue();
chosen === 'https://ntfy.sh' ? ok('ntfy.sh button fills the field') : fail(`ntfy.sh button gave ${chosen}`);

ntfyRequests === 0 ? ok('no request went to ntfy.sh') : fail(`${ntfyRequests} requests went to ntfy.sh`);
await finish(browser);
