// Performance with a year of data (#211): seeds two spaces (about 2,500 entries, 3,200 notes and tasks),
// then measures first load and how long each page takes to settle in a real browser.
//
//   PERF_FIXTURE=/tmp/year npx vitest run src/perf     # writes the seed documents once
//   npm run build   (a test build: YAK_TEST_BUILD=1 npm run build)
//   node scripts/perf.mjs /tmp/year [--budget]
//
// "Settles" = no DOM change for 200 ms; the number is the time of the last change, from the route change.
// Budgets are for a laptop; `--budget` exits 1 when one is exceeded.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './e2e/lib.mjs';

const dir = process.argv[2];
const enforce = process.argv.includes('--budget');
if (!dir) throw new Error('usage: node scripts/perf.mjs <fixture folder> [--budget]');

const server = spawn(process.execPath, [join(import.meta.dirname, 'serve-dist.mjs'), '0'], { stdio: ['ignore', 'pipe', 'ignore'] });
let output = '';
server.stdout.on('data', (d) => (output += d));
let match;
while (!(match = /serving dist on http:\/\/127\.0\.0\.1:(\d+)/.exec(output))) await new Promise((r) => setTimeout(r, 50));
const BASE = `http://127.0.0.1:${match[1]}/`;

const b64 = (f) => readFileSync(join(dir, f)).toString('base64');
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));

await page.goto(BASE + '?test#/time');
await page.waitForFunction(() => window.__app?.spaces().personal);
for (const s of ['personal', 'work']) {
  for (const [doc, file] of [[`space/${s}`, `${s}.bin`], [`space/${s}/time`, `${s}-time.bin`]]) {
    await page.evaluate(([d, data]) => window.__app.applyUpdate(d, data), [doc, b64(file)]);
  }
}
await page.waitForTimeout(3000); // let IndexedDB persist

const counts = await page.evaluate(() => ({
  entries: Object.keys(window.__app.json('space/personal/time', 'time_entries') ?? {}).length,
  notes: Object.keys(window.__app.json('space/personal', 'notes') ?? {}).length,
}));
console.log('seeded (personal):', counts);
await page.evaluate(() => window.__history.flush());
const storage = await page.evaluate(async () => {
  const ids = await window.__history.docIds();
  const history = {};
  for (const id of ids) history[id] = await window.__history.count(id);
  return { usageMB: Math.round(((await navigator.storage.estimate()).usage ?? 0) / 1e5) / 10, history };
});
console.log('browser storage after seeding:', storage.usageMB, 'MB; history segments per document:', JSON.stringify(storage.history));
const rows = [];
const budgets = {
  'first load (reload, timer page ready)': 3000,
  'Timer': 1500,
  'Week (#/time/week)': 1500,
  'Reports (this year)': 2500,
  'Notes': 2500,
  'Tasks': 2500,
  'Organize': 1500,
  'Notes: typing, slowest of 30 keys': 200,
  'Universal search: open': 1500,
  'Universal search: results after typing': 400,
};

/** Runs `action` (a hash to go to, a function, or nothing) and resolves when the DOM has been quiet for 200 ms. */
async function settle(action) {
  await page.evaluate(() => {
    window.__settle = new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      let longest = 0;
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => (longest = Math.max(longest, e.duration))));
      try { po.observe({ type: 'longtask' }); } catch { /* not supported */ }
      const mo = new MutationObserver(() => (last = performance.now()));
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      window.__settleStart = t0;
      const tick = () => {
        if (performance.now() - last > 200 && performance.now() - t0 > 250) {
          mo.disconnect();
          po.disconnect();
          resolve({ last, longest: Math.round(longest) });
        } else setTimeout(tick, 50);
      };
      tick();
    });
  });
  if (typeof action === 'string') await page.evaluate((h) => { window.__settleStart = performance.now(); location.hash = h; }, action);
  else if (action) { await page.evaluate(() => { window.__settleStart = performance.now(); }); await action(); }
  return page.evaluate(async () => {
    const r = await window.__settle;
    return { ms: Math.max(0, Math.round(r.last - window.__settleStart)), longest: r.longest };
  });
}

async function record(what, run) {
  const r = await run();
  rows.push({ what, ...r });
}

// First load: reload with the year in IndexedDB; the time is when the main thread first runs free with both spaces loaded.
await record('first load (reload, timer page ready)', async () => {
  const fresh = await page.context().newPage();
  await fresh.addInitScript(() => {
    window.__t = 0;
    const id = setInterval(() => {
      try {
        if (Object.keys(window.__app.json('space/work/time', 'time_entries') ?? {}).length === 1250 && document.querySelector('main')) {
          window.__t = performance.now();
          clearInterval(id);
        }
      } catch { /* app not up yet */ }
    }, 5);
  });
  await fresh.goto(BASE + '?test#/time');
  await fresh.waitForFunction(() => window.__t, null, { timeout: 60000, polling: 50 });
  const ms = Math.round(await fresh.evaluate(() => window.__t));
  await fresh.close();
  return { ms, longest: 0 };
});
await record('Timer', () => settle('#/time'));
await page.waitForTimeout(300);
await record('Week (#/time/week)', () => settle('#/time/week'));
await settle('#/time/reports');
if ((await page.locator('.rp-controls select').count()) === 0) await page.locator('main button[aria-expanded="false"]').first().click();
await record('Reports (this year)', () => settle(() => page.locator('.rp-controls select').first().selectOption('this_year')));
await record('Notes', () => settle('#/notes'));
await record('Tasks', () => settle('#/tasks'));
await record('Organize', () => settle('#/settings/organize'));
await settle('#/time');

// Typing in a note with 3,200 notes around it: the time each key takes to reach the screen.
await settle('#/notes');
await page.locator('main a[href^="#/notes/"], main [role="link"], main li a').first().click();
const editor = page.locator('.cm-content').first();
await editor.waitFor();
await editor.click();
await record('Notes: typing, slowest of 30 keys', async () => {
  const times = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('x');
    times.push(await page.evaluate(() => new Promise((r) => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t0))); })));
  }
  times.sort((a, b) => a - b);
  console.log('  typing: median', Math.round(times[15]), 'ms');
  return { ms: Math.round(times[29]), longest: 0 };
});

await record('Universal search: open', async () => {
  const t0 = Date.now();
  await page.keyboard.press('Control+Shift+F');
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Search query').waitFor();
  return { ms: Date.now() - t0, longest: 0 };
});
await record('Universal search: results after typing', async () => {
  const input = page.getByLabel('Search query');
  const t0 = Date.now();
  await input.fill('meeting budget');
  await page.getByRole('dialog').locator('section[aria-label]').first().waitFor();
  return { ms: Date.now() - t0, longest: 0 };
});

let over = false;
for (const r of rows) {
  const budget = budgets[r.what];
  const bad = budget !== undefined && r.ms > budget;
  over ||= bad;
  console.log(`${String(r.ms).padStart(6)} ms  longest task ${String(r.longest).padStart(4)} ms  ${bad ? 'OVER ' + budget : '     '}  ${r.what}`);
}
await browser.close();
server.kill();
process.exit(enforce && over ? 1 : 0);
