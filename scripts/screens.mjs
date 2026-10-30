// Screenshots of every page with the same seeded data and a frozen clock, for checking that a
// styling change looks the same (or review one that should not). Needs a test build (the `?test`
// hooks) served with the real headers. Output goes to the directory you name; keep it outside the
// repo, never commit images.
//
//   npm install --no-save playwright-core   # already there after `npm ci`
//   YAK_TEST_BUILD=1 npm run build
//   node scripts/serve-dist.mjs 4207 &
//   TARGET=http://127.0.0.1:4207/ node scripts/screens.mjs shoot /tmp/shots/before
//   ... change, rebuild (same command), restart the server if it serves a copy ...
//   TARGET=http://127.0.0.1:4207/ node scripts/screens.mjs shoot /tmp/shots/after
//   node scripts/screens.mjs compare /tmp/shots/before /tmp/shots/after
//
// ONLY=notes,tasks limits `shoot` to those shots.
// Each shot is taken at 1280, 768 and 375 px (WIDTHS=1280,700,375 picks others), in light and dark. The clock is fixed at NOW (seed
// dates are relative to it), so two runs of the same build give identical pixels. `compare` lists
// every file whose pixels differ and how many pixels changed, and exits 1 if any do.
//
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './e2e/lib.mjs';

const BASE = process.env.TARGET || 'http://127.0.0.1:4207/';
const NOW = new Date('2026-03-25T14:30:00Z');
const iso = (h, m = 0, dayOffset = 0) => new Date(Date.UTC(2026, 2, 25 + dayOffset, h, m)).toISOString();
const SEED = {
  clients: [{ ref: 'acme', name: 'Acme' }],
  projects: [
    { ref: 'web', name: 'Website', client: 'acme', rate: 100, currency: 'USD', color: '#2f6fde' },
    { ref: 'audit', name: 'Audit', rate: 80, currency: 'EUR', color: '#1a7f37' },
    { ref: 'long', name: 'ZX-OPS Q4-0000-TEST-0001 very long sample project code', color: '#8250df' },
    { ref: 'old', name: 'Old job', active: false, billable: false, color: '#b26a00' },
  ],
  entries: [
    { start: iso(8), stop: iso(10), description: 'Design review', project: 'web', billable: true, tags: ['ui', 'review'] },
    { start: iso(10, 15), stop: iso(11, 45), description: 'Audit work', project: 'audit', billable: true },
    { start: iso(12), stop: null, description: 'Running task', project: 'web', tags: ['ops'] },
    { start: iso(9, 0, -1), stop: iso(12, 30, -1), description: 'Admin', project: 'old', tags: ['ops'] },
    { start: iso(13, 0, -1), stop: iso(14, 0, -1), description: 'Notes cleanup' },
    { start: iso(8, 0, -2), stop: iso(9, 0, -2), description: 'Planning', project: 'audit' },
    { start: iso(7, 0, -1), stop: iso(8, 30, -1), description: 'Long code', project: 'long', billable: true },
  ],
};

// A shot is a route, or a name mapped to one in ROUTES. Pages that only redirect are left out.
const ONLY = process.env.ONLY?.split(','); // ONLY=notes,tasks shoots just those
const SHOTS = [
  'home', 'timer', 'week', 'reports', 'reports/detailed', 'reports/weekly', 'notes', 'notes-open', 'tasks', 'tasks-board', 'tasks-table',
  'settings', 'settings/backups/open', 'settings/version-history/open', 'settings/devices', 'settings/organize', 'settings/notes', 'help', 'help/shortcuts', 'help/report', 'import',
  'timer-editing', 'timer-forced', 'tasks-forced', 'tasks-filters', 'tasks-table-filters', 'timer-filters',
  // Notes switched off (F-33n): the Tasks tab and a task on its own page.
  'tasks-no-notes', 'tasks-board-no-notes', 'tasks-table-no-notes', 'task-detail-no-notes',
];
const ROUTES = {
  timer: 'time/list', week: 'time/week', reports: 'time/reports', 'reports/detailed': 'time/reports/detailed', 'reports/weekly': 'time/reports/weekly',
  'notes-open': 'notes', 'tasks-board': 'tasks/board', 'tasks-table': 'tasks/table', 'timer-editing': 'time/list', 'timer-forced': 'time/list', 'tasks-forced': 'tasks', 'tasks-filters': 'tasks', 'tasks-table-filters': 'tasks/table', 'timer-filters': 'time/list',
  'tasks-no-notes': 'tasks', 'tasks-board-no-notes': 'tasks/board', 'tasks-table-no-notes': 'tasks/table', 'task-detail-no-notes': 'tasks',
};

/** A fresh profile starts on Welcome: name the first space and start with everything on. Skipped when Welcome is absent. */
async function firstRun(page) {
  const name = page.locator('input[aria-label="Name of the first space"]');
  if (!(await name.waitFor({ timeout: 5000 }).then(() => true, () => false))) return;
  await name.fill('personal');
  await page.getByRole('button', { name: 'Time, notes and tasks' }).click();
  await name.waitFor({ state: 'detached' });
}

async function shoot(outDir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    await page.clock.setFixedTime(NOW);
    await page.goto(`${BASE}?test#/time/reports`);
    await firstRun(page);
    await page.waitForFunction(() => window.__reports, null, { timeout: 15000 });
    await page.evaluate((s) => window.__reports.seed('personal', s), SEED);
    await page.goto(`${BASE}?test#/notes`);
    await page.getByRole('toolbar', { name: 'Notes' }).getByRole('button', { name: 'New…', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New note', exact: true }).click();
    await page.locator('input[aria-label="Note title"]').waitFor();
    await page.keyboard.type('Acme');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.locator('.cm-content').click();
    await page.keyboard.type('Kickoff with [[Beta]] about #invoices.');
    await page.waitForTimeout(300);
    await page.goto(`${BASE}?test#/tasks`);
    for (const t of ['Write report @office due:2026-03-20', 'Send invoice due:2026-03-27', 'Call Acme !high', 'Plan sprint']) {
      await page.locator('input[aria-label="New task"]').fill(t);
      await page.locator('input[aria-label="New task"]').press('Enter');
    }
    await page.waitForTimeout(300);
    for (const width of (process.env.WIDTHS ?? '1280,768,375').split(',').map(Number)) {
      await page.setViewportSize({ width, height: width > 400 ? 900 : 812 });
      for (const shot of SHOTS.filter((x) => !ONLY || ONLY.includes(x))) {
        const route = ROUTES[shot] ?? shot;
        // `-no-notes` shots run with the Notes feature hidden on this device; reload when that changes.
        const notesOff = shot.endsWith('-no-notes');
        const wasOff = await page.evaluate(() => localStorage.getItem('hidden_modules') === '["notes"]');
        if (notesOff !== wasOff) {
          await page.evaluate((off) => (off ? localStorage.setItem('hidden_modules', '["notes"]') : localStorage.removeItem('hidden_modules')), notesOff);
          await page.reload();
        }
        await page.goto(`${BASE}?test#/${route}`);
        // `-forced` shots set the opposite theme on <html>, as the Settings page does.
        // Route changes keep the document, so every other shot clears it again.
        await page.evaluate((t) => (t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme')), shot.endsWith('-forced') ? (scheme === 'light' ? 'dark' : 'light') : null);
        await page.waitForTimeout(800);
        if (shot === 'notes-open') {
          // The note route is #/notes/<uuid>: open the note by clicking it in the tree.
          await page.locator('a.tree-note', { hasText: /^Acme$/ }).click();
          await page.locator('.cm-content').waitFor();
          await page.waitForTimeout(300);
        }
        if (shot === 'task-detail-no-notes') {
          await page.getByRole('link', { name: 'Call Acme' }).click();
          await page.locator('.cm-content').waitFor();
          await page.waitForTimeout(300);
        }
        if (shot.endsWith('-filters')) {
          await page.getByRole('button', { name: /^Filters/ }).click();
          await page.waitForTimeout(200);
        }
        if (shot === 'timer-editing') {
          const row = page.locator('.te-row .te-line').first();
          if (await row.count()) await row.click({ position: { x: 4, y: 4 } });
          await page.waitForTimeout(200);
        }
        if (width < 400 && (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))) console.log(`sideways scroll: ${shot} at ${width} px (${scheme})`);
        await page.mouse.move(0, 0);
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
        await page.screenshot({ path: join(outDir, `${shot.replace(/\//g, '-')}-${width}-${scheme}.png`), fullPage: true, caret: 'hide', animations: 'disabled' });
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`shots in ${outDir}`);
}

async function compare(a, b) {
  const browser = await launch();
  const page = await browser.newPage();
  let diffs = 0;
  for (const file of readdirSync(a).filter((f) => f.endsWith('.png')).sort()) {
    if (!existsSync(join(b, file))) { console.log(`missing: ${file}`); diffs++; continue; }
    const [x, y] = [a, b].map((d) => `data:image/png;base64,${readFileSync(join(d, file)).toString('base64')}`);
    const r = await page.evaluate(async ([x, y]) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return `size ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`;
      const px = (img) => { const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
      const [da, db] = [px(ia), px(ib)];
      let n = 0;
      const box = [Infinity, Infinity, -1, -1];
      for (let i = 0; i < da.length; i += 4) {
        if (da[i] === db[i] && da[i + 1] === db[i + 1] && da[i + 2] === db[i + 2]) continue;
        n++;
        const x = (i / 4) % ia.width;
        const y = Math.floor(i / 4 / ia.width);
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      }
      return n ? `${n} pixels in ${box[0]},${box[1]} to ${box[2]},${box[3]}` : 0;
    }, [x, y]);
    if (r !== 0) { console.log(`differs: ${file}: ${r}`); diffs++; }
  }
  await browser.close();
  console.log(diffs ? `${diffs} differ` : 'all identical');
  process.exit(diffs ? 1 : 0);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'shoot') await shoot(args[0]);
else if (cmd === 'compare') await compare(args[0], args[1]);
else console.error('usage: screens.mjs shoot <dir> | compare <dirA> <dirB>');
