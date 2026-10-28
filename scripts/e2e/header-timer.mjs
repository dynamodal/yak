// End-to-end for the timer pill and the running cue (docs/decisions/header-timer.md, F-33j and F-33k): the round button
// starts and stops at once and opens nothing; the label opens the details popover (description, Recent, project, tags,
// billable, Start/Update, Discard); Alt+S starts and opens it with focus in the description, Esc keeps it running, Alt+S
// stops without a popover; recents across spaces; Discard is a soft delete with Undo; the draft survives navigation;
// the title, favicon and app badge follow; 375 px layout (idle on one row, running on its own row).
// Runs against dist/ served with the real headers, so CSP violations fail the run.
//
//   npm run e2e header-timer
//
import { join } from 'node:path';
import { BASE, launch, sleep, ok, fail, check, watchPage, poll, finish, pill, startRound, stopRound, detailsDialog, openDetails, startWith } from './lib.mjs';


const browser = await launch();

async function open(name, { viewport, hash = '#/time' } = {}) {
  const context = await browser.newContext({ viewport: viewport ?? { width: 1100, height: 900 } });
  // A stand-in for the Badging API (headless Chrome has none), recording what the app asks for.
  await context.addInitScript(() => {
    window.__badge = [];
    navigator.setAppBadge = (n) => { window.__badge.push(n === undefined ? 'set' : `set ${n}`); return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__badge.push('clear'); return Promise.resolve(); };
  });
  const page = await context.newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}?test${hash}`);
  await pill(page).waitFor();
  return page;
}

const header = pill;
const favicon = (p) => p.evaluate(() => document.getElementById('app-timer-icon')?.getAttribute('href') ?? '');
const badge = (p) => p.evaluate(() => window.__badge.slice());
const running = (p) => p.evaluate(() => ['space/personal', 'space/work'].flatMap((id) => Object.values(window.__app.json(id + '/time', 'time_entries')).filter((e) => e.stop === null && !e.deleted).map((e) => ({ ...e, space: id }))));
const entries = (p) => p.evaluate(() => ['space/personal', 'space/work'].flatMap((id) => Object.entries(window.__app.json(id + '/time', 'time_entries')).map(([key, e]) => ({ ...e, key, space: id }))));
const popoverOpen = async (p) => (await detailsDialog(p).count()) === 1;
const inWork = async (p) => { await p.evaluate(() => { location.hash = '#/notes'; }); await p.getByLabel('Space', { exact: true }).selectOption({ label: 'Work' }); };
const inPersonal = async (p) => { await p.evaluate(() => { location.hash = '#/notes'; }); await p.getByLabel('Space', { exact: true }).selectOption({ label: 'Personal' }); };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const clockSeconds = async (p) => {
  const [h, m, s] = (await header(p).locator('.clock').innerText()).split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

// ---- the pill: round button, popover, Alt+S, recents ----
{
  const p = await open('main');
  check(await poll(async () => (await p.title()).startsWith('◼ Not tracking')), `stopped: title says not tracking (${await p.title()})`);
  check((await favicon(p)).includes('timer-stopped'), 'stopped: stopped favicon');
  check((await header(p).innerText()).includes('Start') && (await header(p).locator('.tp-chip').innerText()) === 'Alt S', 'stopped: the pill says Start and shows the shortcut');
  check((await p.getByRole('button', { name: /^Continue/ }).count()) === 0, 'no Continue button in the header any more');
  check((await p.locator('.timer-bar').count()) === 0, 'no timer bar on the Time page');

  // Start from the popover, with a description (Enter).
  await startWith(p, 'Header check');
  check(await poll(async () => (await header(p).innerText()).includes('Header check')), 'running: the pill shows the description');
  check(!(await popoverOpen(p)), 'Enter in the popover starts and closes it');
  check(await poll(async () => /^▶ 0:00:0\d Header check – /.test(await p.title())), `running: title starts with the elapsed time (${await p.title()})`);
  check(await poll(async () => (await favicon(p)).includes('timer-running')), 'running: running favicon');
  check(await poll(async () => (await badge(p)).at(-1) === 'set'), `running: app badge set (${await badge(p)})`);
  check(await poll(async () => (await p.getByRole('status').filter({ hasText: 'Timer started' }).count()) >= 1), 'starting is announced');

  const href = await favicon(p);
  const res = await p.request.get(new URL(href, p.url()).href);
  check(res.ok() && (res.headers()['content-type'] ?? '').includes('svg') && new URL(href, p.url()).origin === new URL(p.url()).origin, 'favicon is a same-origin SVG file');

  await p.evaluate(() => { location.hash = '#/notes'; });
  await p.locator('.notes-page, .page').first().waitFor();
  check(await poll(async () => (await header(p).innerText()).includes('Header check')), 'on Notes: the pill still shows the running entry');
  const t1 = await clockSeconds(p);
  await sleep(2100);
  const t2 = await clockSeconds(p);
  check(t2 > t1, `on Notes: the pill clock ticks (${t1} → ${t2})`);
  check(/^▶ 0:00:0\d Header check/.test(await p.title()), `on Notes: title keeps counting (${await p.title()})`);

  // The round button stops at once and opens nothing.
  await stopRound(p).click();
  check(await poll(async () => (await running(p)).length === 0), 'the round button stops the entry on Notes');
  check(!(await popoverOpen(p)), 'stopping with the round button opens no popover');
  check(await poll(async () => (await p.title()).startsWith('◼ Not tracking')), `stopped again: title (${await p.title()})`);
  check(await poll(async () => (await favicon(p)).includes('timer-stopped')), 'stopped again: favicon');
  check(await poll(async () => (await badge(p)).at(-1) === 'clear'), 'stopped again: badge cleared');
  check(p.url().endsWith('#/notes'), 'stopping from the header stays on Notes');
  check(await poll(async () => (await p.getByRole('status').filter({ hasText: 'Timer stopped' }).count()) >= 1), 'stopping is announced');

  // Round start with nothing typed: an empty entry in the active space, no popover, same page.
  await startRound(p).click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === '' && r[0].space === 'space/personal'; }), 'the round button starts an empty entry in the active space');
  check(!(await popoverOpen(p)) && p.url().endsWith('#/notes'), 'starting with the round button opens no popover and stays on the page');
  check(await poll(async () => (await header(p).innerText()).includes('(no description)')), 'the pill shows (no description)');
  check(await poll(async () => /^▶ 0:00:0\d – /.test(await p.title())), `title without a description (${await p.title()})`);
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);

  // Recent: the first row continues the entry that stopped last ("Header check" came before the empty one, which has nothing to pick).
  let d = await openDetails(p);
  const rowTexts = await d.locator('.tp-recent-row').allInnerTexts();
  check(rowTexts[0]?.startsWith('Continue:') && rowTexts[0].includes('stopped'), `the first Recent row is Continue with a stopped time (${rowTexts[0]})`);
  check(rowTexts.some((t) => t.includes('Header check')), 'Recent lists earlier work');
  check((await d.getByRole('button', { name: 'Start', exact: true }).count()) === 1 && (await d.getByRole('button', { name: 'Discard' }).count()) === 1, 'the stopped popover has Start and Discard');
  check(await d.getByLabel('Description', { exact: true }).evaluate((el) => el === document.activeElement), 'the description has focus when the popover opens');
  // Esc closes and focus returns to the label.
  await p.keyboard.press('Escape');
  check(!(await popoverOpen(p)) && (await p.evaluate(() => document.activeElement?.classList.contains('tp-label'))), 'Esc closes the popover and returns focus to its opener');
  d = await openDetails(p);
  await d.locator('.tp-recent-row').first().click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === (rowTexts[0].includes('Header check') ? 'Header check' : r[0].description); }), 'picking Continue starts the entry again');
  check(!(await popoverOpen(p)), 'picking a recent closes the popover');

  // The draft survives navigation: type in the popover while stopped, leave, come back.
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);
  d = await openDetails(p);
  await d.getByLabel('Description', { exact: true }).fill('half typed');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { location.hash = '#/time/week'; });
  d = await openDetails(p);
  check((await d.getByLabel('Description', { exact: true }).inputValue()) === 'half typed', 'a half-typed description survives navigation');
  await p.keyboard.press('Escape');
  await startRound(p).click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === 'half typed'; }), 'the round button starts with the draft');
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);
  d = await openDetails(p);
  check((await d.getByLabel('Description', { exact: true }).inputValue()) === '', 'the draft is empty after it started');
  await p.keyboard.press('Escape');

  // Alt+S: starts at once, opens the popover with focus in the description; Esc keeps it running and returns focus.
  await detailsDialog(p).waitFor({ state: 'detached' });
  await p.getByRole('link', { name: 'Time', exact: true }).focus();
  await p.keyboard.press('Alt+s');
  check(await poll(async () => (await running(p)).length === 1), 'Alt+S starts the timer at once');
  check(await poll(async () => await popoverOpen(p)), 'Alt+S opens the popover');
  check(await poll(async () => await detailsDialog(p).getByLabel('Description', { exact: true }).evaluate((el) => el === document.activeElement)), 'Alt+S puts keyboard focus in the description');
  check((await detailsDialog(p).getByRole('button', { name: 'Update' }).count()) === 1, 'while running the popover offers Update');
  await p.keyboard.press('Escape');
  check(!(await popoverOpen(p)) && (await running(p)).length === 1, 'Esc closes the popover and leaves the timer running');
  check(await poll(async () => (await p.evaluate(() => document.activeElement?.textContent?.trim() ?? '')) === 'Time'), 'Esc returns focus to where it was before Alt+S');
  await p.keyboard.press('Alt+s');
  check(await poll(async () => (await running(p)).length === 0), 'Alt+S while running stops the timer');
  await sleep(300);
  check(!(await popoverOpen(p)), 'Alt+S while running opens no popover');

  // Alt+S, then pick a past entry from Recent to fill the running one (description, project, tags).
  await p.keyboard.press('Alt+s');
  await detailsDialog(p).waitFor();
  const pickRow = detailsDialog(p).locator('.tp-recent-row', { hasText: 'Header check' }).first();
  await pickRow.waitFor();
  await p.keyboard.press('ArrowDown');
  check(await p.evaluate(() => document.activeElement?.classList.contains('tp-recent-row')), 'ArrowDown moves from the description into Recent');
  await pickRow.click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === 'Header check'; }), 'picking a recent while running fills the running entry (one entry, no new one)');
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);

  // Update on a running entry edits its description.
  await startRound(p).click();
  d = await openDetails(p);
  await d.getByLabel('Description', { exact: true }).fill('Renamed while running');
  await d.getByRole('button', { name: 'Update' }).click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === 'Renamed while running'; }), 'Update changes the running entry');

  // Discard while running: a soft delete, with an Undo toast.
  d = await openDetails(p);
  await d.getByRole('button', { name: 'Discard' }).click();
  check(await poll(async () => (await running(p)).length === 0), 'Discard stops the running timer');
  const gone = (await entries(p)).find((e) => e.description === 'Renamed while running');
  check(gone && gone.deleted === true, 'Discard is a soft delete (the entry is kept, marked deleted)');
  await p.getByRole('button', { name: 'Undo' }).click();
  check(await poll(async () => { const e = (await entries(p)).find((x) => x.description === 'Renamed while running'); return e && !e.deleted && e.stop !== null; }), 'Undo brings the discarded entry back, stopped');

  // Continue across spaces: the entry that stopped last in Work continues in Work, from Personal.
  await inWork(p);
  await startRound(p).click();
  d = await openDetails(p);
  await d.getByLabel('Description', { exact: true }).fill('Work item');
  await d.getByRole('button', { name: 'Update' }).click();
  await poll(async () => (await running(p)).some((r) => r.description === 'Work item' && r.space === 'space/work'));
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);
  await inPersonal(p);
  d = await openDetails(p);
  const first = await d.locator('.tp-recent-row').first().innerText();
  check(first.startsWith('Continue:') && first.includes('Work item') && first.includes('Work'), `Continue is the last entry in any space, labelled with its space (${first})`);
  await d.locator('.tp-recent-row').first().click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === 'Work item' && r[0].space === 'space/work'; }), 'Continue starts in the entry\'s own space');
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);

  // reload: the cue comes back from the stored state
  await startRound(p).click();
  await poll(async () => (await running(p)).length === 1);
  // IndexedDB writes take a few milliseconds; a reload within that window loses the change. Give the write time to land.
  await sleep(200);
  await p.reload();
  await header(p).waitFor();
  check(await poll(async () => /^▶ \d:\d\d:\d\d/.test(await p.title()) && (await favicon(p)).includes('timer-running')), 'after a reload: running title and favicon');
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);
  await p.close();
}

// ---- 375 px: idle on one row, running on its own row ----
{
  const p = await open('mobile', { viewport: { width: 375, height: 800 } });
  const idleTop = await p.evaluate(() => document.querySelector('main.view').getBoundingClientRect().top);
  const idleBox = await header(p).boundingBox();
  const sync0 = await p.locator('.sync-btn').boundingBox();
  check(idleTop < 110, `375 px idle: content starts under 110 px (${Math.round(idleTop)})`);
  check(idleBox && sync0 && Math.abs(idleBox.y - sync0.y) < 12 && idleBox.width < 80, `375 px idle: the pill is an icon-only round button on the first row (${Math.round(idleBox?.width)} px wide)`);
  check(!(await header(p).locator('.tp-label').isVisible()), '375 px idle: the Start label is hidden');
  const round = await startRound(p).boundingBox();
  check(round && round.width >= 24, '375 px idle: the round button is a real target');
  await startRound(p).click();
  await poll(async () => (await running(p)).length === 1);
  {
    const d = await openDetails(p);
    await d.getByLabel('Description', { exact: true }).fill('A long description that will not fit on a narrow phone screen at all');
    await d.getByRole('button', { name: 'Update' }).click();
  }
  await poll(async () => (await running(p))[0]?.description?.startsWith('A long'));
  for (const view of ['time', 'time/week', 'notes', 'tasks', 'time/reports', 'organize', 'settings', 'settings/devices']) {
    await p.evaluate((v) => { location.hash = `#/${v}`; }, view);
    await sleep(300);
    const o = await overflow(p);
    const box = await header(p).boundingBox();
    check(o <= 0 && box && box.x >= 0 && box.x + box.width <= 375, `375 px running: no horizontal scroll on ${view} (${o}), the pill is inside the screen`);
    const sync = await p.locator('.sync-btn').boundingBox();
    const cmd = await p.locator('.palette-btn').boundingBox();
    const tabs = await p.locator('.tabs').boundingBox();
    check(sync && cmd && sync.x + sync.width <= 375 && cmd.x + cmd.width <= sync.x && sync.y + sync.height <= tabs.y + 1 && box.y >= tabs.y + tabs.height - 1, `375 px on ${view}: the command and sync buttons stay on the first row and the running pill has its own row below the tabs`);
    check(box.width > 335, `375 px on ${view}: the running pill is full width (${Math.round(box.width)})`);
  }
  check((await p.locator('.brand-icon').isVisible()) && (await p.locator('.brand-name').boundingBox())?.width <= 2, '375 px: the logo shows and the app name is hidden (kept for screen readers)');
  const top = await p.evaluate(() => document.querySelector('main.view').getBoundingClientRect().top);
  check(top < 170, `375 px running (two rows): content starts under 170 px (${Math.round(top)}); the limit is higher than idle's 110 px by design`);
  const stop = await stopRound(p).boundingBox();
  check(stop && stop.x + stop.width <= 375 && stop.width >= 24, '375 px: stop button visible and tappable');
  const text = await header(p).locator('.tp-desc').boundingBox();
  check(text && text.width > 100, `375 px running: the description has room (${Math.round(text?.width)} px)`);
  await stopRound(p).click();
  await poll(async () => (await running(p)).length === 0);
  await sleep(200);
  const o = await overflow(p);
  check(o <= 0, `375 px stopped with a long last entry: no horizontal scroll (${o})`);
  // Even narrower
  await p.setViewportSize({ width: 320, height: 800 });
  await startRound(p).click();
  await poll(async () => (await running(p)).length === 1);
  check((await overflow(p)) <= 0, '320 px running: no horizontal scroll');
  await stopRound(p).click();
  await p.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, 'header-375.png') : '/dev/null' }).catch(() => {});
  await p.close();
}

// ---- 1280 px: one header row ----
{
  const p = await open('wide', { viewport: { width: 1280, height: 900 } });
  const [brand, tabs, timer, cmd, dot] = await Promise.all(['.brand', '.tabs', '.timer-pill', '.palette-btn', '.sync-btn'].map((sel) => p.locator(sel).boundingBox()));
  const header = await p.locator('.topbar').boundingBox();
  check((await p.locator('.brand-icon').isVisible()) && (await p.locator('.brand-icon').getAttribute('alt')) === '', '1280 px: the decorative icon shows beside the name');
  check([brand, tabs, timer, cmd, dot].every((b) => b && b.y >= header.y && b.y + b.height <= header.y + header.height), 'logo, tabs, timer, command button and sync button share one header row at 1280 px');
  check(brand.x + brand.width <= tabs.x + 1 && timer.x >= tabs.x && timer.x + timer.width <= cmd.x && cmd.x + cmd.width <= dot.x, 'left to right: logo and name, tabs, timer, command button, sync button');
  check((await p.locator('.brand-name').innerText()).length > 0 && (await p.locator('.palette-chip').innerText()) === 'Alt P' && (await p.locator('.tp-chip').innerText()) === 'Alt S', '1280 px: the app name and the shortcut chips show');
  check(header.height < 70, `1280 px: the header is one slim row (${Math.round(header.height)} px)`);
  const top = await p.evaluate(() => document.querySelector('main.view').getBoundingClientRect().top);
  check(top < 80, `1280 px: content starts under 80 px (${Math.round(top)})`);
  await p.close();
}

await finish(browser);
