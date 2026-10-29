// End-to-end: the Home page (F-33p, issue #33). It is the first tab and the landing page; cards for Needs you, This week,
// Due soon, Recent notes and Where the week went each hide when their feature is off or they have nothing to show; a task
// can be checked off on Home; the Home switch and the Time tracker preset decide the landing page; chart numbers
// are also a table; three, two, one column by width.
//
//   npm run e2e home
//
import { BASE, launch, check, watchPage, until, finish, newNote } from './lib.mjs';

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
watchPage(p, 'home', { consoleErrors: true });
const go = (h) => p.evaluate((x) => (location.hash = x), h);
const hash = () => p.evaluate(() => location.hash);
const cards = async () => p.evaluate(() => [...document.querySelectorAll('.hm-card')].map((c) => c.getAttribute('data-card')));
const tabs = async () => (await p.locator('.main-tabs > a').allInnerTexts()).map((t) => t.trim());
const hide = (l) => p.evaluate((x) => localStorage.setItem('hidden_modules', JSON.stringify(x)), l);

// ---- A fresh device: everything on lands on Home, which is empty
await p.goto(BASE + '?test&welcome');
await p.getByRole('button', { name: 'Time, notes and tasks' }).click();
await p.locator('.main-tabs').waitFor();
await until(async () => (await hash()) === '' || (await hash()) === '#/home' || (await p.locator('.hm-page').count()) > 0);
check((await tabs())[0] === 'Home', `Home is the first tab (${await tabs()})`);
check((await p.locator('.main-tabs a.active').innerText()).trim() === 'Home', 'a fresh device opens on Home');
check(await p.locator('.hm-empty').isVisible(), 'Home with nothing yet says so');

// ---- Data: time this week, two tasks (one late), a note
await go('#/time/reports');
await p.waitForFunction(() => window.__reports);
await p.evaluate(() => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  return window.__reports.seed('personal', {
    projects: [{ ref: 'web', name: 'Website', color: '#2f6fde' }],
    entries: [
      { start: iso(now - 3 * 3600_000), stop: iso(now - 2 * 3600_000), description: 'Design', project: 'web' },
      { start: iso(now - 90 * 60_000), stop: iso(now - 30 * 60_000), description: 'Admin' },
    ],
  });
});
await go('#/tasks');
for (const t of ['Late job due:2020-01-01', 'Soon job due:' + new Date(Date.now() + 2 * 86400_000).toLocaleDateString('sv'), 'Someday job']) {
  await p.locator('input[aria-label="New task"]').fill(t);
  await p.getByRole('button', { name: 'Add task' }).click();
}
await go('#/notes');
await newNote(p);
await p.locator('input[aria-label="Note title"]').waitFor();
await p.keyboard.type('Zebra plan');
await p.keyboard.press('Enter');
await until(async () => (await p.evaluate(() => Object.values(window.__app.json('space/personal', 'notes')).some((n) => n.path === 'Zebra plan.md'))));

// ---- Cards
await go('#/home');
await p.locator('.hm-card[data-card="week"]').waitFor();
await p.locator('.hm-card[data-card="due"]').waitFor();
await p.locator('.hm-card[data-card="notes"]').waitFor();
await p.locator('.hm-card[data-card="projects"]').waitFor();
const all = await cards();
check(['week', 'due', 'notes', 'projects'].every((c) => all.includes(c)), `cards: ${all}`);
check(all.indexOf('week') < all.indexOf('due') && all.indexOf('due') < all.indexOf('notes') && all.indexOf('notes') < all.indexOf('projects'), 'cards keep their order');
check((await p.locator('.hm-card[data-card="week"] .hm-big').innerText()).includes('2.00'), 'This week shows the total');
check((await p.locator('.hm-card[data-card="week"] .hm-day-bar').count()) >= 1, 'This week draws a bar for a day with time');
check(/Hours per day this week/.test((await p.locator('.hm-card[data-card="week"] [role=img]').getAttribute('aria-label')) ?? ''), 'the chart has an accessible name');
await p.locator('.hm-card[data-card="week"] summary').click();
check((await p.locator('.hm-card[data-card="week"] table tbody tr').count()) === 7, 'the same numbers are a table of seven days');
check((await p.locator('.hm-card[data-card="projects"] tbody tr').allInnerTexts()).join('|').includes('Website'), 'Where the week went lists the project');
check((await p.locator('.hm-card[data-card="due"] .hm-late').count()) === 1, 'the late task is marked');
check((await p.locator('.hm-card[data-card="due"] li').count()) === 2, 'Due soon lists the late and the soon task, not the one without a date');
check((await p.locator('.hm-card[data-card="notes"] li').allInnerTexts()).join().includes('Zebra plan'), 'Recent notes lists the note, not the tasks');

// Needs you: the same rows as Settings, only while something waits
check(!(await cards()).includes('needs'), 'no Needs you card while nothing waits');
await p.evaluate(() => window.__app.fakePendingJoins([{ deviceId: 'dev-1', name: 'Phone', expiresAt: Date.now() + 600_000 }]));
await p.locator('.hm-card[data-card="needs"]').waitFor();
check((await p.locator('.hm-card[data-card="needs"]').innerText()).includes('Phone asks to join'), 'a waiting join shows under Needs you');
check((await cards())[0] === 'needs', 'Needs you comes first');
const homeNeeds = await p.locator('.hm-card[data-card="needs"] [data-need]').evaluateAll((l) => l.map((e) => e.getAttribute('data-need')));
await go('#/settings');
await p.locator('.st-needs-card').waitFor();
const settingsNeeds = await p.locator('.st-needs-card [data-need]').evaluateAll((l) => l.map((e) => e.getAttribute('data-need')));
check(JSON.stringify(homeNeeds) === JSON.stringify(settingsNeeds) && homeNeeds.length > 0, `Needs you matches Settings (${homeNeeds})`);
await p.evaluate(() => window.__app.fakePendingJoins([]));
await go('#/home');
await p.locator('.hm-card[data-card="due"]').waitFor();
check(!(await cards()).includes('needs'), 'Needs you goes away when nothing waits');

// ---- Checking a task
await p.getByRole('checkbox', { name: /Late job/ }).check();
await until(async () => p.evaluate(() => Object.values(window.__app.json('space/personal', 'notes')).some((n) => n.path.endsWith('Late job.md') && /status: done/.test(n.text))));
check(true, 'checking a task on Home marks it done in its note');
check((await p.locator('.hm-card[data-card="due"] li.hm-done').count()) === 1, 'the checked row stays, struck through');
await p.getByRole('checkbox', { name: /Late job/ }).uncheck();
await until(async () => p.evaluate(() => Object.values(window.__app.json('space/personal', 'notes')).some((n) => n.path.endsWith('Late job.md') && /status: open/.test(n.text))));
check(true, 'unchecking reopens it');

// ---- Opening items
await p.locator('.hm-card[data-card="notes"] a.hm-main').click();
await p.waitForFunction(() => location.hash.startsWith('#/notes/'));
check(true, 'a recent note opens in Notes');
await go('#/home');
await p.locator('.hm-card[data-card="due"]').waitFor();
await p.locator('.hm-card[data-card="due"] a.hm-main').first().click();
await p.waitForFunction(() => location.hash.startsWith('#/notes/'));
check(true, 'a task opens');

// ---- Reflow: three, two, one across
await go('#/home');
await p.locator('.hm-card[data-card="week"]').waitFor();
const cols = () => p.evaluate(() => getComputedStyle(document.querySelector('.hm-grid')).gridTemplateColumns.split(' ').length);
check((await cols()) === 3, 'three columns at 1280 px');
await p.setViewportSize({ width: 700, height: 900 });
check((await cols()) === 2, 'two columns at 700 px');
await p.setViewportSize({ width: 375, height: 800 });
check((await cols()) === 1, 'one column at 375 px');
check(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no sideways scroll at 375 px');
await p.setViewportSize({ width: 1280, height: 900 });

// ---- Features: a card follows its feature; Home off lands on the next tab
await hide(['tasks']);
await p.reload();
await p.locator('.hm-card[data-card="week"]').waitFor();
check(!(await cards()).includes('due'), 'Tasks off hides Due soon');
await hide(['notes']);
await p.reload();
await p.locator('.hm-card[data-card="week"]').waitFor();
check(!(await cards()).includes('notes'), 'Notes off hides Recent notes');
await hide(['time']);
await p.reload();
await p.locator('.hm-card[data-card="due"]').waitFor();
check(!(await cards()).includes('week') && !(await cards()).includes('projects'), 'Time off hides the two time cards');
await hide(['home']);
await p.goto(BASE + '?test#/');
await p.locator('.main-tabs').waitFor();
check(!(await tabs()).includes('Home'), 'Home off removes the tab');
await go('#/home');
await until(async () => (await hash()) === '#/time');
check(true, 'Home off: #/home goes to the first tab shown (Time)');
await hide(['home', 'time', 'notes', 'tasks']);
await go('#/home');
await until(async () => (await hash()) === '#/settings');
check(true, 'everything off: the app opens on Settings');
await hide([]);

// ---- The Time tracker preset turns Home off
const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
watchPage(fresh, 'preset', { consoleErrors: true });
await fresh.goto(BASE + '?test&welcome');
await fresh.getByRole('button', { name: 'Time tracker' }).click();
await fresh.locator('.main-tabs').waitFor();
check(!(await fresh.locator('.main-tabs > a').allInnerTexts()).join().includes('Home'), 'Time tracker preset: no Home tab');
check((await fresh.locator('.main-tabs a.active').innerText()).trim() === 'Time', 'Time tracker preset lands on Time');

await finish(browser);
