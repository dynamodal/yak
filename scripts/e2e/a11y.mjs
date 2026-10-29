// End-to-end accessibility: axe-core (a dev dependency, injected by the test only, never part of the
// app bundle) runs on every page and on the open dialogs in light and dark; the keyboard reaches
// the header and the timer; icon buttons have names; the timer and toasts announce through live regions.
//
//   npm run e2e a11y
//
import { createRequire } from 'node:module';
import { BASE, launch, check, watchPage, poll, finish, nameRunning } from './lib.mjs';

const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const browser = await launch();

const PAGES = [
  '#/home', '#/time/list', '#/time/week', '#/time/reports', '#/notes', '#/tasks', '#/help', '#/help/report',
  '#/settings', '#/settings/backup', '#/settings/import', '#/settings/devices', '#/settings/organize',
  '#/settings/spaces/PERSONAL', '#/settings/devices-sync/this', '#/settings/advanced', '#/settings/devices/add', '#/note-settings', '#/help/shortcuts', '#/settings/network',
];

// The Start/Stop button is named for its action; its ticking clock is not part of the name on purpose.
async function axe(page, label) {
  await page.addScriptTag({ path: axeSource });
  const all = (await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }))).violations;
  const violations = all
    .map((v) => (v.id === 'label-content-name-mismatch' ? { ...v, nodes: v.nodes.filter((n) => !n.html.includes('palette-btn')) } : v))
    .filter((v) => v.nodes.length);
  for (const v of violations) {
    const nodes = v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 400)} :: ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ''}`.slice(0, 600));
    check(false, `${label}: ${v.id} (${v.impact}) ${v.nodes.length}× ${nodes.join(' | ')}`);
  }
  check(violations.length === 0, `${label}: no axe violations`);
}

// The four contexts are independent, so they run at once (about a quarter of the wall time).
async function scan([scheme, width]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
  const page = await context.newPage();
  const tag = `${scheme} ${width}px`;
  watchPage(page, `a11y ${tag}`, { consoleErrors: true });
  await page.goto(`${BASE}?test#/time/list`);
  await page.waitForFunction(() => window.__app);
  await page.locator('.view').waitFor();

  // Something to show: a finished entry with a project and a tag, a running one, a note and a task.
  await page.getByRole('button', { name: 'Start timer' }).click();
  await nameRunning(page, 'Accessibility check');
  await page.getByRole('button', { name: 'Stop timer' }).click();
  await page.getByRole('button', { name: 'Start timer' }).click();
  await nameRunning(page, 'Still running');
  const personal = await page.evaluate(() => window.__app.spaces().personal);
  for (const hash of PAGES) {
    await page.evaluate((h) => { location.hash = h; }, hash.replace('PERSONAL', personal));
    // The page is up when the route is set, the view has content and nothing is still animating (a fade skews contrast).
    await page.waitForFunction((h) => location.hash === h && (document.querySelector('.view')?.childElementCount ?? 0) > 0 && document.getAnimations().every((a) => a.playState !== 'running'), hash.replace('PERSONAL', personal));
    await axe(page, `${tag} ${hash}`);
  }

  // The sync control in its four shapes, with its popover open (the shape, the name and the list must pass axe).
  const peer = (id, state, via) => ({ id, state, ...(via ? { via } : {}) });
  const sync = {
    off: { paired: false, peers: [] },
    direct: { paired: true, state: 'connected', peers: [peer('aaaaaaaa-1', 'connected', 'direct'), peer('bbbbbbbb-2', 'waiting-for-peer')] },
    relay: { paired: true, state: 'connected', peers: [peer('aaaaaaaa-1', 'connected', 'relay')] },
    offline: { paired: true, state: 'waiting-for-peer', peers: [peer('aaaaaaaa-1', 'waiting-for-peer')] },
  };
  await page.evaluate(() => { location.hash = '#/time/list'; });
  for (const [state, s] of Object.entries(sync)) {
    await page.evaluate((x) => window.__app.fakeStatus(x), s);
    await page.locator('.sync-btn').click();
    await page.locator('.status-panel').waitFor();
    await axe(page, `${tag} sync ${state} popover`);
    await poll(async () => { await page.keyboard.press('Escape'); return (await page.locator('.status-panel').count()) === 0; });
  }
  await page.evaluate(() => window.__app.fakeStatus(null));

  // Dialogs and pickers.
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.getByRole('button', { name: '+ Share with an account' }).click();
  await page.locator('dialog[open], dialog.sheet[open]').first().waitFor();
  await page.waitForTimeout(300);
  await axe(page, `${tag} share dialog`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#/time/list'; });
  await page.locator('.timer-pill').waitFor();
  await page.keyboard.press('Alt+p');
  await page.locator('dialog.palette').waitFor();
  await axe(page, `${tag} palette`);
  await page.keyboard.press('Escape');
  await page.locator('.tp-label').click();
  await axe(page, `${tag} timer popover`);
  const project = page.getByRole('button', { name: /^Project/ }).first();
  await project.click();
  await page.locator('.picker').first().waitFor();
  await axe(page, `${tag} project picker`);
  await page.keyboard.press('Escape');
  await context.close();
}
await Promise.all([['light', 1280], ['dark', 1280], ['light', 375], ['dark', 375]].map(scan));

// Keyboard and screen reader: the skip link comes first, the header and the timer are reachable
// by Tab, the toast region is always in the page, and every button and link has a name.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  watchPage(page, 'a11y keyboard', { consoleErrors: true });
  await page.goto(`${BASE}?test#/time/list`);
  await page.waitForFunction(() => window.__app);
  await page.locator('.view').waitFor();
  await page.keyboard.press('Tab');
  check((await page.evaluate(() => document.activeElement?.textContent)) === 'Skip to content', 'the first Tab stop is the skip link');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement?.id === 'main'), 'the skip link moves focus to the page');
  check((await page.evaluate(() => location.hash)) === '#/time/list', 'and leaves the route alone');
  check((await page.locator('main h1').count()) >= 1 || (await page.locator('h1').count()) >= 1, 'the page has a level-1 heading');
  check((await page.locator('.toasts[role="status"][aria-live="polite"]').count()) === 1, 'the toast live region is always present');
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const e = document.activeElement;
      const r = e?.getBoundingClientRect();
      return { tag: e?.tagName, name: e?.getAttribute('aria-label') || e?.textContent?.trim() || e?.getAttribute('title') || '', visible: !!r && r.width > 0 && r.height > 0, ring: e ? getComputedStyle(e).outlineStyle !== 'none' || getComputedStyle(e).boxShadow !== 'none' : false };
    });
    if (d.tag === 'BODY') break;
    seen.add(d.name);
    if (!d.name && d.tag !== 'INPUT' && d.tag !== 'TEXTAREA' && d.tag !== 'SELECT') check(false, `a focus stop has no name (${d.tag})`);
    if (!d.visible) check(false, `a focus stop is not visible: ${d.name}`);
    if (!d.ring) check(false, `a focus stop shows no focus ring: ${d.name}`);
  }
  check(seen.size >= 5, `Tab walks the page after the skip link (${seen.size} stops; the Time page has no timer bar any more)`);
  for (const sel of ['.tp-label', '.tp-round']) check(await page.locator(sel).evaluate((e) => e.tabIndex >= 0 && e.getBoundingClientRect().width > 0), `the timer pill's ${sel} is a visible Tab stop`);
  check(await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].every((e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.querySelector('img[alt]:not([alt=""])')).toString().trim())), 'every button and link has a name');
  await context.close();
}

await finish(browser);
