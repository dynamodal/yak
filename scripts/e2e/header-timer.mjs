// End-to-end for the header timer and the running cue (docs/decisions/header-timer.md): start on
// Timer, go to Notes, see and stop the timer from the header; the title, favicon and app badge
// follow; start and continue from the header; one running timer across spaces; 375 px layout.
// Runs against dist/ served with the real headers, so CSP violations fail the run.
//
//   npm run e2e header-timer
//
import { join } from 'node:path';
import { BASE, launch, sleep, ok, fail, check, watchPage, poll, finish } from './lib.mjs';


const browser = await launch();

async function open(name, { viewport, hash = '#/timer' } = {}) {
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
  await page.locator('.header-timer').waitFor();
  return page;
}

const header = (p) => p.locator('.header-timer');
const bar = (p) => p.locator('.timer-bar');
const favicon = (p) => p.evaluate(() => document.getElementById('app-timer-icon')?.getAttribute('href') ?? '');
const badge = (p) => p.evaluate(() => window.__badge.slice());
const running = (p) => p.evaluate(() => ['space/personal', 'space/work'].flatMap((id) => Object.values(window.__app.json(id + '/time', 'time_entries')).filter((e) => e.stop === null && !e.deleted).map((e) => ({ ...e, space: id }))));
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const clockSeconds = async (p) => {
  const [h, m, s] = (await header(p).locator('.clock').innerText()).split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

// ---- start on Timer, stop from the header on Notes ----
{
  const p = await open('main');
  check(await poll(async () => (await p.title()).startsWith('◼ Not tracking')), `stopped: title says not tracking (${await p.title()})`);
  check((await favicon(p)).includes('timer-stopped'), 'stopped: stopped favicon');
  check((await header(p).innerText()).includes('Not tracking'), 'stopped: header says not tracking');
  check((await header(p).getByRole('button', { name: /^Continue: / }).count()) === 0, 'no continue button before any entry');

  await bar(p).getByLabel('Description', { exact: true }).fill('Header check');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).click();
  check(await poll(async () => (await header(p).innerText()).includes('Header check')), 'running: header shows the description');
  check(await poll(async () => /^▶ 0:00:0\d Header check – /.test(await p.title())), `running: title starts with the elapsed time (${await p.title()})`);
  check(await poll(async () => (await favicon(p)).includes('timer-running')), 'running: running favicon');
  check(await poll(async () => (await badge(p)).at(-1) === 'set'), `running: app badge set (${await badge(p)})`);

  const href = await favicon(p);
  const res = await p.request.get(new URL(href, p.url()).href);
  check(res.ok() && (res.headers()['content-type'] ?? '').includes('svg') && new URL(href, p.url()).origin === new URL(p.url()).origin, 'favicon is a same-origin SVG file');

  await p.evaluate(() => { location.hash = '#/notes'; });
  await p.locator('.notes-page, .page').first().waitFor();
  check(await poll(async () => (await header(p).innerText()).includes('Header check')), 'on Notes: header still shows the running entry');
  const t1 = await clockSeconds(p);
  await sleep(2100);
  const t2 = await clockSeconds(p);
  check(t2 > t1, `on Notes: header clock ticks (${t1} → ${t2})`);
  check(/^▶ 0:00:0\d Header check/.test(await p.title()), `on Notes: title keeps counting (${await p.title()})`);

  await header(p).getByRole('button', { name: 'Stop timer' }).click();
  check(await poll(async () => (await running(p)).length === 0), 'stop from the header on Notes stops the entry');
  check(await poll(async () => (await p.title()).startsWith('◼ Not tracking')), `stopped again: title (${await p.title()})`);
  check(await poll(async () => (await favicon(p)).includes('timer-stopped')), 'stopped again: favicon');
  check(await poll(async () => (await badge(p)).at(-1) === 'clear'), 'stopped again: badge cleared');
  check(p.url().endsWith('#/notes'), 'stopping from the header stays on Notes');

  // continue the last entry from the header
  await header(p).getByRole('button', { name: 'Continue: Header check' }).click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === 'Header check'; }), 'continue last entry starts the same work again');

  // the status area opens the switcher; from it, the Timer page
  await header(p).locator('.ht-desc').click();
  check(await poll(async () => (await p.locator('.ht-switcher').count()) === 1), 'clicking the running entry opens the switcher');
  check((await p.locator('.ht-switcher .ht-opt').allInnerTexts()).some((t) => t.includes('Header check')), 'the switcher lists recent work');
  await p.getByRole('button', { name: 'Open the Timer page' }).click();
  check(await poll(() => p.url().endsWith('#/timer')), 'the switcher opens the Timer page');
  check(await poll(async () => (await bar(p).getByLabel('Description', { exact: true }).inputValue()) === 'Header check'), 'Timer page shows the same running entry');

  // stop from the header on the Timer page too, then start from the header
  await header(p).getByRole('button', { name: 'Stop timer' }).click();
  check(await poll(async () => (await running(p)).length === 0), 'stop from the header on the Timer page');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).waitFor();
  check(true, 'Timer page bar follows (shows Start)');

  // The header's start uses what is typed in the bar (#21).
  await bar(p).getByLabel('Description', { exact: true }).fill('Typed in the bar');
  await header(p).getByRole('button', { name: 'Start timer' }).click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === 'Typed in the bar'; }), 'header start uses the text typed in the bar');
  await header(p).getByRole('button', { name: 'Stop timer' }).click();
  check(await poll(async () => (await bar(p).getByLabel('Description', { exact: true }).inputValue()) === ''), 'the bar is empty after the header started it');

  await p.evaluate(() => { location.hash = '#/timer/reports'; });
  await header(p).getByRole('button', { name: 'Start timer' }).click();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].description === '' && r[0].space === 'space/personal'; }), 'start from the header: an empty entry in the active space');
  check(await poll(async () => (await header(p).innerText()).includes('(no description)')), 'header shows (no description)');
  check(await poll(async () => /^▶ 0:00:0\d – /.test(await p.title())), `title without a description (${await p.title()})`);

  // one running timer across spaces: switch to Work and start there from the header after stopping
  await p.evaluate(() => { location.hash = '#/notes'; });
  await p.getByLabel('Space', { exact: true }).selectOption({ label: 'Work' });
  check(await poll(async () => (await header(p).innerText()).includes('(no description)')), 'the header shows a timer running in another space');
  await header(p).locator('.ht-desc').click();
  await p.getByRole('button', { name: 'Start a new timer' }).click();
  await p.evaluate(() => { location.hash = '#/timer/list'; });
  await bar(p).getByLabel('Description', { exact: true }).fill('Work item');
  await bar(p).getByLabel('Description', { exact: true }).blur();
  check(await poll(async () => { const r = await running(p); return r.length === 1 && r[0].space === 'space/work' && r[0].description === 'Work item'; }), 'starting in Work stops the Personal timer: one running');
  check(await poll(async () => (await header(p).innerText()).includes('Work item')), 'header follows the new timer');
  await header(p).getByRole('button', { name: 'Stop timer' }).click();
  check(await poll(async () => (await running(p)).length === 0), 'stopped from the header in Work');
  check(await poll(async () => (await header(p).getByRole('button', { name: 'Continue: Work item' }).count()) === 1), 'continue offers the entry that stopped last');

  // reload: the cue comes back from the stored state
  await header(p).getByRole('button', { name: 'Continue: Work item' }).click();
  await poll(async () => (await running(p)).length === 1);
  // IndexedDB writes take a few milliseconds; a reload within that window loses the change (found
  // here: the test reloaded faster than a person can). Give the write time to land.
  await sleep(200);
  await p.reload();
  await header(p).waitFor();
  check(await poll(async () => /^▶ \d:\d\d:\d\d Work item/.test(await p.title()) && (await favicon(p)).includes('timer-running')), 'after a reload: running title and favicon');
  await header(p).getByRole('button', { name: 'Stop timer' }).click();
  await poll(async () => (await running(p)).length === 0);
  await p.close();
}

// ---- 375 px ----
{
  const p = await open('mobile', { viewport: { width: 375, height: 800 } });
  await bar(p).getByLabel('Description', { exact: true }).fill('A long description that will not fit on a narrow phone screen at all');
  await bar(p).getByRole('button', { name: 'Start', exact: true }).click();
  await poll(async () => (await running(p)).length === 1);
  for (const view of ['timer', 'timer/week', 'notes', 'tasks', 'timer/reports', 'organize', 'settings', 'settings/devices']) {
    await p.evaluate((v) => { location.hash = `#/${v}`; }, view);
    await sleep(300);
    const o = await overflow(p);
    const box = await header(p).boundingBox();
    check(o <= 0 && box && box.x >= 0 && box.x + box.width <= 375, `375 px running: no horizontal scroll on ${view} (${o}), header timer inside the screen`);
    const dot = await p.locator('.status-dot-btn').boundingBox();
    check(dot && dot.x >= 0 && dot.x + dot.width <= 375 && dot.y < box.y + box.height, `375 px on ${view}: the status dot is on the timer's row, inside the screen`);
  }
  check(!(await p.locator('.brand').isVisible()), '375 px: the app name is hidden');
  check((await p.locator('.brand-icon').count()) === 1 && !(await p.locator('.brand-icon').isVisible()), '375 px: the icon is hidden with the name');
  const top = await p.evaluate(() => document.querySelector('main.view').getBoundingClientRect().top);
  check(top < 110, `375 px: content starts under 110 px (${Math.round(top)})`);
  const stop = await header(p).getByRole('button', { name: 'Stop timer' }).boundingBox();
  check(stop && stop.x + stop.width <= 375 && stop.width >= 24, '375 px: stop button visible and tappable');
  await header(p).getByRole('button', { name: 'Stop timer' }).click();
  await poll(async () => (await running(p)).length === 0);
  await sleep(200);
  const o = await overflow(p);
  check(o <= 0, `375 px stopped with a long last entry: no horizontal scroll (${o})`);
  await p.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, 'header-375.png') : '/dev/null' }).catch(() => {});
  await p.close();
}

// ---- 1280 px: one header row ----
{
  const p = await open('wide', { viewport: { width: 1280, height: 900 } });
  const [brand, tabs, timer, dot] = await Promise.all(['.brand', '.tabs', '.header-timer', '.status-dot-btn'].map((sel) => p.locator(sel).boundingBox()));
  const header = await p.locator('.topbar').boundingBox();
  check((await p.locator('.brand-icon').isVisible()) && (await p.locator('.brand-icon').getAttribute('alt')) === '', '1280 px: the decorative icon shows beside the name');
  check([brand, tabs, timer, dot].every((b) => b && b.y >= header.y && b.y + b.height <= header.y + header.height), 'name, tabs, timer and status dot share one header row at 1280 px');
  check(header.height < 70, `1280 px: the header is one slim row (${Math.round(header.height)} px)`);
  const top = await p.evaluate(() => document.querySelector('main.view').getBoundingClientRect().top);
  check(top < 80, `1280 px: content starts under 80 px (${Math.round(top)})`);
  await p.close();
}

await finish(browser);
