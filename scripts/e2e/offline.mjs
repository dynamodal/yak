// Offline support end to end: the worker installs and precaches the build, the app works with no
// network after one visit (timer, notes editor, reports), a new deploy shows the update banner and
// Reload switches to it with old caches gone, the probe's own test worker still passes, and the
// kill switch removes the worker. Runs against dist/ served with the real headers; it rewrites
// dist/sw.js to simulate deploys and restores it at the end.
//
//   npm run e2e offline
//
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, launch, sleep, ok, check, watchPage, poll, finish, newNote } from './lib.mjs';

const until = (fn, ms = 10000) => poll(fn, ms);

const DIST = process.env.DIST_DIR || join(process.cwd(), 'dist');
const SW = join(DIST, 'sw.js');

const original = readFileSync(SW, 'utf8');
const manifestOf = (src) => JSON.parse(/\{version:"[^"]*",pages:\[[^\]]*\],assets:\[[^\]]*\](?:,backupFirst:!0)?\}/.exec(src)[0].replace(/(\w+):/g, '"$1":').replace(/:!0/g, ':true'));
const manifest = manifestOf(original);
const V1 = manifest.version;
const V2 = 'e2e' + Date.now().toString(16).slice(-9);

// Every file Vite wrote (including the lazy editor chunk) is in the generated list.
const built = readdirSync(join(DIST, 'assets')).map((f) => `assets/${f}`).filter((f) => !f.endsWith('.map'));
check(built.every((f) => manifest.assets.includes(f)) && built.length === manifest.assets.filter((f) => f.startsWith('assets/')).length, `precache lists all ${built.length} built files`);
check(manifest.assets.some((f) => /assets\/editor-/.test(f)), 'the lazily loaded editor chunk is precached');
check(['manifest.webmanifest', 'icon-192.png', 'icon-512.png'].every((f) => manifest.assets.includes(f)), 'the install manifest and icons are precached');
check(['licenses.json', 'THIRD-PARTY-LICENSES.txt'].every((f) => manifest.assets.includes(f)), 'the licence list and texts are precached');
check(JSON.stringify(manifest.pages) === JSON.stringify(['', 'probe']), 'pages: /, /probe');

// Installable app: the manifest is served as JSON with its own type and every icon it names loads.
{
  const res = await fetch(new URL('manifest.webmanifest', BASE));
  const m = await res.json();
  check(res.ok && /application\/manifest\+json/.test(res.headers.get('content-type') ?? ''), 'manifest served as application/manifest+json');
  check(m.display === 'standalone' && m.start_url && m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifest is standalone with a maskable 512 icon');
  const icons = await Promise.all(m.icons.map((i) => fetch(new URL(i.src, BASE))));
  check(icons.every((r) => r.ok && r.headers.get('content-type') === 'image/png'), 'every manifest icon loads as a PNG');
}

// Errors expected while the network is cut off: failed loads, not code errors.
let offline = false;
let expectViolation = false;
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
const watch = (page, name) =>
  watchPage(page, name, {
    consoleErrors: true,
    ignore: (t) => (expectViolation && /Content Security Policy|Refused to/i.test(t)) || (offline && /ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/i.test(t)),
  });
const page = await context.newPage();
watch(page, 'app');

const controllerVersion = (p = page) =>
  p.evaluate(() => new Promise((resolve) => {
    const c = navigator.serviceWorker.controller;
    if (!c) return resolve(null);
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data.version);
    c.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    setTimeout(() => resolve('no answer'), 2000);
  }));
const cacheNames = () => page.evaluate(() => caches.keys());
const entries = () => page.evaluate(() => window.__app.json('space/personal/time', 'time_entries'));
const notes = () => page.evaluate(() => window.__app.json('space/personal', 'notes'));
const bar = () => page.locator('.timer-bar');

try {
  // ---- first online visit: install and take control ----
  await page.goto(`${BASE}?test#/timer/list`);
  await bar().waitFor();
  check(await until(() => page.evaluate(() => navigator.serviceWorker.controller !== null)), 'the worker controls the page after the first visit');
  check((await controllerVersion()) === V1, `controller reports the built version ${V1}`);
  check(JSON.stringify(await cacheNames()) === JSON.stringify([`app-precache-${V1}`]), 'one cache, named after the version');
  const cached = await page.evaluate((name) => caches.open(name).then((c) => c.keys()).then((k) => k.length), `app-precache-${V1}`);
  check(cached === manifest.pages.length + manifest.assets.length, `cache holds all ${cached} pages and files`);
  check((await page.locator('.offline-chip').count()) === 0, 'no Offline chip while online');
  check((await page.locator('.update-banner').count()) === 0, 'no update banner on the first visit');
  const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => r.scope)));
  check(regs.length === 1 && regs[0] === new URL(BASE).href, `registered once at scope ${regs[0]}`);

  // Open Notes once while online (the editor chunk is also precached at install).
  await page.goto(`${BASE}?test#/notes`);
  await newNote(page);
  await page.locator('input[aria-label="Note title"]').waitFor();
  await page.keyboard.type('Online note');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').waitFor();
  ok('notes editor loaded online');

  // ---- offline: reload and use the app ----
  offline = true;
  await context.setOffline(true);
  await page.goto(`${BASE}?test#/timer`); // same document: only the hash changes
  // Checked before the reload: emulated offline fires the offline event, but a document loaded
  // afterwards still reads navigator.onLine as true in headless Chromium.
  check(await until(() => page.locator('.offline-chip').isVisible()), 'header shows the Offline chip');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no horizontal overflow at 375 px with the Offline chip (${overflow})`);
  const offlineLoad = await page.reload();
  await bar().waitFor({ timeout: 10000 });
  check(offlineLoad?.fromServiceWorker() === true, 'app reloads with no network, served by the worker');

  await bar().getByLabel('Description', { exact: true }).fill('Offline work');
  await bar().getByLabel('Description', { exact: true }).press('Enter');
  await bar().getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await sleep(1200);
  await bar().getByRole('button', { name: 'Stop', exact: true }).click();
  await bar().getByRole('button', { name: 'Start', exact: true }).waitFor();
  const done = Object.values(await entries()).filter((e) => !e.deleted && e.description === 'Offline work' && e.stop !== null);
  check(done.length === 1, 'timer starts and stops offline');

  await page.goto(`${BASE}?test#/notes`);
  await newNote(page);
  await page.locator('input[aria-label="Note title"]').waitFor();
  await page.keyboard.type('Offline note');
  await page.keyboard.press('Enter');
  await page.locator('.cm-content').click();
  await page.keyboard.type('Written without a network.');
  check(
    await until(async () => Object.values(await notes()).some((n) => n.path === 'Offline note.md' && n.text.replace(/^---\n[\s\S]*?\n---\n/, '') === 'Written without a network.')),
    'notes editor (lazy chunk) works offline',
  );

  await page.goto(`${BASE}?test#/timer/reports/detailed`);
  check(await until(() => page.locator('main').innerText().then((t) => t.includes('Offline work'))), 'Detailed report lists the offline entry');

  await page.goto(`${BASE}?test#/help/open-source`);
  check(await until(() => page.locator('.oss-list li').count().then((n) => n > 10)), 'Help › Open source lists the packages offline');

  expectViolation = true;
  const blocked = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
    const s = document.createElement('style');
    s.textContent = 'body{}';
    document.head.append(s);
    setTimeout(() => resolve(false), 1500);
  }));
  expectViolation = false;
  check(blocked, 'the cached page keeps its Content-Security-Policy (inline style blocked)');

  // ---- back online; a new deploy ----
  await context.setOffline(false);
  offline = false;
  await page.goto(`${BASE}?test#/timer/list`);
  await bar().waitFor();
  check(await until(async () => (await page.locator('.offline-chip').count()) === 0), 'Offline chip disappears when back online');

  writeFileSync(SW, original.replaceAll(V1, V2));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  check(await until(() => page.locator('.update-banner').isVisible(), 15000), 'update banner appears after the new deploy');
  check((await page.locator('.update-banner').innerText()).includes('A new version is available'), 'banner text');
  check((await page.locator('.update-banner').innerText()).includes('Make a backup before reloading'), 'the banner asks for a backup first when the waiting version says so (#283)');
  check((await page.locator('.update-banner a[href="#/settings/backup"]').count()) === 1, 'and links to Backups');
  check((await controllerVersion()) === V1, 'the old version stays in charge until Reload is pressed');

  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
  await page.locator('.update-banner').getByRole('button', { name: 'Reload' }).click();
  // Do not poll the old worker with messages while it hands over: a message in flight keeps it
  // "busy", and Chromium then holds back the waiting version's activation until the 4 s fallback
  // reload in applyUpdate() (#30). Wait for the page to reload instead, then ask once.
  await until(() => navigations >= 1, 30000, 200);
  const activated = await until(async () => (await controllerVersion()) === V2, 30000);
  check(activated, `Reload activates the new version ${V2}`);
  if (!activated) {
    // Say what the page is doing, and fail now instead of hanging until the suite times out.
    const probe = await Promise.race([
      page.evaluate(() => ({ controller: navigator.serviceWorker.controller?.state ?? null, url: location.href, banner: !!document.querySelector('.update-banner') })).catch((e) => `evaluate failed: ${e.message}`),
      sleep(5000).then(() => 'page does not answer (renderer busy or crashed)'),
    ]);
    console.log('diagnostic:', JSON.stringify(probe), 'navigations', navigations);
    process.exit(1);
  }
  // The count must now hold still.
  let seen = -1;
  await until(async () => {
    const stable = seen === navigations;
    seen = navigations;
    return stable;
  }, 15000, 1500);
  check(navigations === 1, `the page reloaded exactly once (${navigations})`);
  check(JSON.stringify(await cacheNames()) === JSON.stringify([`app-precache-${V2}`]), 'old caches are deleted on activate');
  await bar().waitFor();
  check((await page.locator('.update-banner').count()) === 0, 'no banner after the update');

  // ---- the probe page and its own test worker ----
  const probe = await context.newPage();
  watch(probe, 'probe');
  await probe.goto(`${BASE}probe`);
  const swCard = probe.locator('section.card', { has: probe.locator('h2', { hasText: /^Service worker$/ }) });
  check(await until(async () => /\bok\b/.test((await swCard.getAttribute('class')) ?? '')), 'probe card "Service worker" passes');
  const after = await probe.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => r.scope)));
  check(after.length === 1 && after[0] === new URL(BASE).href, 'only the app registration remains after the probe');
  check((await controllerVersion(probe)) === V2, '/probe is served by the app worker (cached for offline)');
  await probe.close();

  // ---- kill switch ----
  const killDir = mkdtempSync(join(tmpdir(), 'yak-kill-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', killDir, '--emptyOutDir', '--logLevel', 'error'], { env: { ...process.env, APP_OFFLINE: 'off' }, stdio: 'inherit' });
    const kill = readFileSync(join(killDir, 'sw.js'), 'utf8');
    check(kill.includes('unregister') && !kill.includes('"fetch"'), 'kill switch built with APP_OFFLINE=off');
    writeFileSync(SW, kill);
  } finally {
    rmSync(killDir, { recursive: true, force: true });
  }
  // The kill switch reloads the page while this runs.
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update())).catch(() => undefined);
  check(
    await until(async () => (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.length))) === 0 && (await cacheNames()).length === 0, 15000),
    'kill switch unregisters the worker and deletes its caches',
  );
  await page.goto(`${BASE}?test#/timer`);
  await page.reload();
  await bar().waitFor();
  await sleep(1500);
  check((await page.evaluate(() => navigator.serviceWorker.controller)) === null, 'after the kill switch the app loads from the network, uncontrolled');

  // Restoring the real worker brings offline support back on the next load.
  writeFileSync(SW, original);
  await page.reload();
  check(await until(() => page.evaluate(() => navigator.serviceWorker.controller !== null)), 'redeploying the worker restores offline support');
} finally {
  writeFileSync(SW, original);
  await browser.close();
}

await finish();
