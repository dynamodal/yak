// End-to-end: when the relay does not work, the Devices page says whose limit it is. The relay's
// WebSockets are made to fail and its /signal/status answer is faked four ways: Yak's own
// daily allowance used up, the relay fine but refusing this device, a Cloudflare error page, and
// no answer at all. Direct sync is always said to be unaffected.
//
//   npm run e2e relay-diagnosis
//
import { BASE, launch, check, watchPage, until, finish, startSyncing } from './lib.mjs';

const browser = await launch({ fakeCamera: true });

async function scenario(name, answer, expected) {
  const context = await browser.newContext({ permissions: ['camera'] });
  let asked = 0;
  await context.routeWebSocket(/\/signal\//, (ws) => ws.close({ code: 1011, reason: 'test' }));
  await context.route('**/signal/status', (route) => {
    asked++;
    return answer(route);
  });
  const page = await context.newPage();
  watchPage(page, name, { ignore: () => true });
  await page.goto(BASE + '?test#/devices');
  await startSyncing(page);
  // The relay notices sit under the Sync line in Devices and sync (F-33).
  await page.evaluate(() => { location.hash = '#/settings/devices-sync'; });
  const t = await until(async () => expected.test(await page.locator('main').innerText()), 40000, 500);
  check(t >= 0, `${name}: the page says ${expected}`);
  check(/Direct sync/.test(await page.locator('main').innerText()), `${name}: and that direct sync is not affected`);
  check(asked >= 1 && asked <= 2, `${name}: the status was asked about ${asked} time(s), not in a loop`);
  await context.close();
}

const marker = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ service: 'yak-relay', ...body }) });
await scenario('own allowance used up', marker({ state: 'limited', scope: 'all', resetsAt: Math.floor(Date.now() / 1000) + 3600 }, 503), /Yak's relay has used its daily allowance/);
await scenario('relay refuses this device', marker({ state: 'ok', originAllowed: false }), /does not accept connections from this page/);
await scenario('Cloudflare refuses', (route) => route.fulfill({ status: 429, contentType: 'text/html', body: '<html>error code: 1015</html>' }), /Cloudflare, which hosts the relay, is refusing requests/);
await scenario('no answer', (route) => route.abort('connectionfailed'), /relay cannot be reached from this network/);

// The relay names a limit of this network in a close code (4429 per minute, 4430 per day), so the page
// says so at once, without asking /signal/status, and waits. A close without a limit code is a plain
// drop: the page says the relay cannot be reached right now and goes on retrying (no long pause).
async function closeScenario(name, close, expected, { pauses }) {
  const context = await browser.newContext({ permissions: ['camera'] });
  let asked = 0;
  const attempts = [];
  await context.routeWebSocket(/\/signal\//, (ws) => {
    if (!/\/link\//.test(ws.url())) attempts.push(Date.now());
    ws.close(close);
  });
  await context.route('**/signal/status', (route) => {
    asked++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ service: 'yak-relay', state: 'ok', originAllowed: true }) });
  });
  const page = await context.newPage();
  watchPage(page, name, { ignore: () => true });
  await page.goto(BASE + '?test#/devices');
  await startSyncing(page);
  await page.evaluate(() => { location.hash = '#/settings/devices-sync'; });
  const t = await until(async () => expected.test(await page.locator('main').innerText()), 40000, 500);
  check(t >= 0, `${name}: the page says ${expected}`);
  const text = await page.locator('main').innerText();
  check(pauses ? !/cannot be reached/.test(text) : !/too many|daily share|limit/i.test(text), `${name}: and does not blame a limit it was not told of`);
  const before = attempts.length;
  await page.waitForTimeout(9000);
  const more = attempts.length - before;
  check(pauses ? more === 0 : more >= 1, `${name}: ${pauses ? 'no new signaling connection while it waits' : 'it keeps retrying'} (${more} in 9 s)`);
  if (pauses) check(asked === 0, `${name}: the status was not asked, the close said it`);
  await context.close();
}
await closeScenario('per-minute refusal', { code: 4429, reason: 'rate retry=60' }, /too many connections to the relay in a minute/, { pauses: true });
await closeScenario('daily share refusal', { code: 4430, reason: `day scope=share reset=${Math.floor(Date.now() / 1000) + 3600}` }, /daily share of Yak's relay/, { pauses: true });
await closeScenario('plain drop', { code: 1011, reason: 'test' }, /cannot be reached right now/, { pauses: false });

await finish(browser);
