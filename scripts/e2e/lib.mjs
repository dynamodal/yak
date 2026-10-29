// Shared helpers for the browser suites in scripts/e2e/ and the screenshot scripts.
//
// Environment (set by `npm run e2e`, or by hand to run one suite alone):
//   TARGET       address of the served build, default http://127.0.0.1:4190/
//   MOCKPORT     port of the mock ntfy a suite starts, default 8795 (serve-dist.mjs needs it in EXTRA_CONNECT)
//   CHROME_PATH  Chromium to launch; otherwise the Playwright cache in ~/.cache/ms-playwright is searched
//   E2E_BROWSER  `webkit` runs the suite in Playwright's WebKit (local only; Chromium is the default and CI's choice)
//
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright-core';
import { startMockNtfy } from '../mock-ntfy.mjs';

export const BASE = process.env.TARGET || 'http://127.0.0.1:4190/';
export const MOCK_PORT = Number(process.env.MOCKPORT || 8795);

/** Flags that give a page a fake camera and accept the permission prompt without a person. */
export const FAKE_CAMERA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

export const WEBKIT = process.env.E2E_BROWSER === 'webkit';

export function findChrome() {
  if (WEBKIT) return undefined; // WebKit comes from Playwright's own install (`npx playwright-core install webkit`)
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  for (const dir of existsSync(cache) ? readdirSync(cache).sort().reverse() : []) {
    for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome']) {
      if (existsSync(join(cache, dir, rel))) return join(cache, dir, rel);
    }
  }
  throw new Error('No Chromium found: set CHROME_PATH or run `npx playwright-core install chromium`');
}

/**
 * Playwright's WebKit does not fire `load` for a page that reloads itself with `location.reload()`
 * (the app does, after joining, restoring or resetting). The page does reload, so in WebKit
 * `waitForEvent('load')` marks the page and waits for a fresh document, which has no mark.
 */
function patchWebkit(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}, ...a) => {
    // WebKit knows no clipboard or camera permission (it rejects them); there is no fake camera either.
    const context = await newContext({ ...options, permissions: undefined }, ...a);
    context.grantPermissions = async () => {};
    const newPage = context.newPage.bind(context);
    context.newPage = async (...b) => {
      const page = await newPage(...b);
      const waitForEvent = page.waitForEvent.bind(page);
      page.waitForEvent = (event, options) => {
        if (event !== 'load') return waitForEvent(event, options);
        return page.evaluate(() => { window.__beforeReload = true; }).then(() => page.waitForFunction(() => !window.__beforeReload, null, { timeout: options?.timeout ?? 30000 }));
      };
      return page;
    };
    return context;
  };
  return browser;
}

/**
 * Test-build timers (docs/testing.md "Test-build timers"): suites that wait out a long product timer opt in with
 * `launch({ fastTimers: true })`. Every page then runs the direct-path retry, the link retry delays and the relay
 * stats refresh TIMER_SCALE times faster (`window.__yakTimerScale`, read only by a test build), and `waitFor(ms)`
 * shortens a time-based wait by the same ratio. `E2E_REAL_TIMERS=1` turns both off: the push-to-main run uses it,
 * so the product's real timers stay exercised.
 */
export const TIMER_SCALE = process.env.E2E_REAL_TIMERS === '1' ? 1 : 4;
const MIN_WAIT_MS = 4000;

/**
 * A time-based wait (a negative check: "nothing arrives") for `ms` of real timers, shortened by TIMER_SCALE but never
 * below 4 s (or `ms` itself when that is shorter): a link needs a few seconds to open, and a wait that ends before
 * it could would prove nothing.
 */
export const waitFor = (ms) => Math.round(Math.max(ms / TIMER_SCALE, Math.min(ms, MIN_WAIT_MS)));

function scaleTimers(browser) {
  if (TIMER_SCALE <= 1) return browser;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const context = await newContext(...a);
    await context.addInitScript((n) => { window.__yakTimerScale = n; }, TIMER_SCALE);
    return context;
  };
  return browser;
}

/** Launches Chromium (or WebKit with E2E_BROWSER=webkit); `fakeCamera` adds the fake-camera flags (Chromium only); `fastTimers`: see TIMER_SCALE. */
export async function launch({ fakeCamera = false, fastTimers = false, args = [] } = {}) {
  const browser = WEBKIT
    ? patchWebkit(await webkit.launch())
    : await chromium.launch({ executablePath: findChrome(), args: [...(fakeCamera ? FAKE_CAMERA_ARGS : []), ...args] });
  return fastTimers ? scaleTimers(browser) : browser;
}

export const startMock = () => startMockNtfy({ port: MOCK_PORT });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
export const failureCount = () => failures;
export const ok = (m) => console.log('ok  :', m);
export const fail = (m) => {
  failures++;
  console.error('FAIL:', m);
};
export const check = (cond, m) => (cond ? ok(m) : fail(m));

/**
 * Makes a page error or a Content-Security-Policy violation fail the run.
 * `consoleErrors` also fails on any console error; `ignore(text)` skips messages that are expected.
 */
export function watchPage(page, name, { consoleErrors = false, ignore } = {}) {
  page.on('pageerror', (e) => fail(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (ignore?.(text)) return;
    // WebKit reports two style-src-attr violations at start-up (no inline style in the DOM, pages render
    // styled; docs/decisions/app.md F-202). Chromium reports none, so only WebKit skips them.
    if (WEBKIT && /^Refused to apply a stylesheet because its hash/.test(text)) return;
    if (/Content Security Policy|Refused to/i.test(text)) fail(`${name} CSP: ${text.slice(0, 200)}`);
    else if (consoleErrors && m.type() === 'error') fail(`${name} console error: ${text.slice(0, 200)}`);
  });
}

/** A new isolated profile (own IndexedDB and localStorage) with its page watched. */
export async function newProfile(browser, name, contextOptions = {}, watchOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  watchPage(page, name, watchOptions);
  return page;
}

/** Polls `fn` until it is truthy (a throw counts as not yet). Returns the milliseconds waited, or -1 on timeout. */
export async function until(fn, ms = 5000, every = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      // A call that never returns (a page evaluating while it navigates) must not outlive the deadline.
      const left = Math.max(1, ms - (Date.now() - t0));
      if (await Promise.race([fn(), sleep(left).then(() => false)])) return Date.now() - t0;
    } catch {
      // not ready yet, for example while the page reloads
    }
    await sleep(every);
  }
  return -1;
}

/** Like `until`, but resolves to true or false. */
export async function poll(fn, ms = 5000, every = 100) {
  return (await until(fn, ms, every)) >= 0;
}

/** Closes what was opened (browsers, mock servers), prints the verdict and ends the process. */
export async function finish(...closables) {
  for (const c of closables) await c?.close?.();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

/**
 * A device that joined by an approved one-time code keeps the account's spaces by itself and opens on
 * the Timer (F-20). Waits for that; a device that still shows the "Keep all spaces" notice (a space it
 * has not decided on) gets it pressed.
 */
export async function keepAllSpaces(page) {
  const button = page.getByRole('button', { name: 'Keep all spaces' });
  const onTimer = () => page.evaluate(() => location.hash.startsWith('#/time')).catch(() => false);
  const deadline = Date.now() + 30000;
  let pressedAt = 0;
  while (Date.now() < deadline) {
    if (await onTimer()) return;
    if (!pressedAt && (await button.isVisible().catch(() => false))) {
      // The app keeps the spaces by itself a moment after the notice shows, which removes the button mid-click:
      // a default click then waits out its whole 30 s timeout for a button that is gone. Short timeout, then look again.
      pressedAt = Date.now();
      await button.click({ timeout: 2000 }).catch(() => undefined);
    }
    // A join that was not approved by a one-time code (the keyless tests) never goes to the Timer; an approved one may show the notice for a moment and still does.
    if (pressedAt && Date.now() - pressedAt > 4000) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The joined device neither kept the spaces nor opened the Timer');
}

/** Start selecting on a list page: the Select button in the page header (it reads Done while selecting). */
export async function startSelecting(page) {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
}

/** Pick an item from a Notes sidebar menu ("New…" or "Notes menu"). */
export async function notesMenu(page, label, item) {
  await page.getByRole('toolbar', { name: 'Notes' }).getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** A new note from the Notes sidebar's "New…" menu. */
export const newNote = (page) => notesMenu(page, 'New…', 'New note');

/**
 * Opens what hides the join form and the connection server field: on the Welcome screen the "Already use Yak?" line,
 * on Devices the "Advanced" part. Returns the page. Safe elsewhere: it waits briefly and does nothing when neither shows.
 */
export async function openJoin(page) {
  await page.locator('details.welcome-more, details.advanced, input[aria-label="One-time code"]').first().waitFor({ timeout: 5000 }).catch(() => {});
  const closed = page.locator('details.welcome-more:not([open]) > summary, details.advanced:not([open]) > summary');
  if (await closed.count()) await closed.first().click();
  return page;
}

/** The passphrase the e2e scripts use (28 characters or more, so no warning). */
export const PASS = 'e2e passphrase for tests only';

/**
 * Completes the passphrase sheet (F-324) that is open on `page`: creates the passphrase (typing its own, so a
 * suite knows it) or enters it, then presses the sheet's button, which runs the action that asked.
 * Resolves false when no sheet shows within `wait` ms.
 */
export async function fillSheet(page, pass = PASS, wait = 10000) {
  const sheet = page.locator('[data-passphrase-sheet]');
  if (!(await sheet.first().waitFor({ timeout: wait }).then(() => true, () => false))) return false;
  const kind = await sheet.first().getAttribute('data-passphrase-sheet');
  if (kind === 'create') {
    const own = sheet.getByRole('button', { name: 'Type my own' });
    if (await own.count()) await own.click();
    await sheet.locator('input[aria-label="New passphrase"]').fill(pass);
    await sheet.locator('input[aria-label="Repeat the passphrase"]').fill(pass);
    await sheet.getByLabel("I've written it down").check();
    await sheet.getByRole('button', { name: /^Create and / }).click();
  } else if (kind === 'enter') {
    await sheet.locator('input[aria-label="Passphrase"]').fill(pass);
    await sheet.getByRole('button', { name: /^Unlock and / }).click();
  } else {
    await sheet.getByRole('button').filter({ hasNotText: /^(Cancel|Close)$/ }).last().click();
  }
  await sheet.first().waitFor({ state: 'detached', timeout: 30000 });
  return true;
}

/**
 * "Start syncing my devices" on the Devices page: the passphrase sheet creates the passphrase (#311, F-324).
 * Presses the button, completes the sheet, waits until pairing is up.
 */
export async function startSyncing(page, pass = PASS) {
  await page.getByRole('button', { name: 'Start syncing my devices' }).click();
  await fillSheet(page, pass);
  await page.getByRole('button', { name: 'Make a one-time code' }).waitFor({ timeout: 30000 });
}

/** Completes the passphrase sheet if the last click opened it (the unlock lasts 5 minutes after its last use). */
export const unlockIfAsked = (page, pass = PASS, wait = 3000) => fillSheet(page, pass, wait);

/**
 * Add `guest` to `host`'s account with a one-time code: host makes it, guest enters it, both screens
 * show the same code, host approves, guest confirms and reloads (#257). `keep` presses "Keep all spaces" on the guest.
 * Returns the code.
 */
export async function joinByInvite(host, guest, { keep = true, pass = PASS } = {}) {
  // Adding a device is its own page (F-33): go there when the page shown does not offer it.
  const toAdd = async (p, what) => {
    // Let the page settle first: a fresh profile shows Welcome (its join form is in a fold), which needs no navigation.
    await p.locator('.main-tabs, details.welcome-more').first().waitFor({ state: 'attached', timeout: 30000 });
    if (!(await what(p).count())) {
      await p.evaluate(() => { location.hash = '#/settings/devices/add'; });
      await what(p).first().waitFor({ timeout: 30000 });
    }
  };
  await toAdd(host, (p) => p.getByRole('button', { name: /Make a (new )?one-time code/ }));
  await toAdd(guest, (p) => p.locator('input[aria-label="One-time code"]'));
  await host.getByRole('button', { name: /Make a (new )?one-time code/ }).first().click();
  const code = (await host.locator('[data-invite-code]').innerText()).trim();
  await (await openJoin(guest)).locator('input[aria-label="One-time code"]').fill(code);
  const before = await guest.evaluate(() => location.hash);
  const loaded = guest.waitForEvent('load', { timeout: 60000 });
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.locator('[data-join="compare"] code.compare-code').waitFor({ timeout: 30000 });
  await host.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
  await unlockIfAsked(host, pass);
  await guest.getByRole('button', { name: 'The codes match' }).click();
  await loaded;
  if (keep) await keepAllSpaces(guest);
  await guest.waitForFunction(() => window.__app);
  // The joined device opens on the Timer (F-20); suites carry on from the page they joined on.
  if (keep) await guest.evaluate((h) => { location.hash = h; }, before);
  return code;
}

/** Open the "Advanced" fold of Settings (ids, fingerprints, switching to device keys, reset). */
/** Opens a row of a Settings section (a device, a space, an account) by its name, unless it is open; returns the row. */
export async function openRow(page, name) {
  const row = page.locator('.st-row', { has: page.locator('.st-row-title', { hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }) }).first();
  await row.waitFor();
  if ((await row.locator('.st-row-head').getAttribute('aria-expanded')) !== 'true') await row.locator('.st-row-head').click();
  return row;
}

export async function openAdvanced(page) {
  // The Advanced section of Settings (F-33b): go there when the page shown has none.
  if (!(await page.locator('details.advanced').count())) {
    await page.evaluate(() => { location.hash = '#/settings/advanced'; });
    await page.locator('details.advanced').first().waitFor();
  }
  const fold = page.locator('details.advanced').first();
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').first().click();
  return fold;
}

// ---- The timer pill (header) and its details popover; the Time page has no bar of its own
export const pill = (p) => p.locator('.timer-pill');
export const startRound = (p) => pill(p).getByRole('button', { name: 'Start timer' });
export const stopRound = (p) => pill(p).getByRole('button', { name: 'Stop timer' });
export const detailsDialog = (p) => p.getByRole('dialog', { name: 'Timer details' });
/** Opens the details popover from the pill's label (no-op when open) and returns it. */
export async function openDetails(p) {
  const label = pill(p).locator('.tp-label');
  if ((await label.getAttribute('aria-expanded')) !== 'true') await label.click();
  const d = detailsDialog(p);
  await d.waitFor();
  await sleep(120); // the popover's Esc and outside-click listeners attach after the next frame
  return d;
}
/** With a timer running: opens the details and sets its description (Update). */
export async function nameRunning(p, description) {
  const d = await openDetails(p);
  await d.getByLabel('Description', { exact: true }).fill(description);
  await d.getByRole('button', { name: 'Update' }).click();
}
/** Starts a timer from the popover with a description (Enter), the way a person types it. */
export async function startWith(p, description) {
  const d = await openDetails(p);
  await d.getByLabel('Description', { exact: true }).fill(description);
  await d.getByLabel('Description', { exact: true }).press('Enter');
  await stopRound(p).waitFor();
}
