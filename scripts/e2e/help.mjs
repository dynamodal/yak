// End-to-end: Help & About is one long page (#/help) with a table of contents; each entry jumps to its
// section (#/help/<section>), the section ids work after a reload and offline, the old
// #/manage/help address redirects, the header "?" opens it, Report a problem is a page of its own
// reachable from Help, the palette and the status popover, the shortcut list matches the bindings,
// and the header fits at 375 and 180 px.
//
//   npm run e2e help
//
import { BASE, launch, check, watchPage, poll, finish } from './lib.mjs';

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
watchPage(page, 'help', { consoleErrors: true });
await page.goto(BASE + '?test#/time');
await page.waitForFunction(() => window.__app);

// Help is in Settings (About & help); the header has no "?" any more.
check((await page.locator('.topbar').getByRole('link', { name: /^Help/ }).count()) === 0, 'the header has no Help button');
await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Settings' }).click();
await page.getByRole('link', { name: 'Guide and About' }).click();
await page.getByRole('heading', { name: 'Help & About', level: 1 }).waitFor();
check(page.url().endsWith('#/help'), 'Settings, About & help opens #/help');
const main = await page.locator('main').innerText();
check(main.includes('Your Activity Keeper'), 'it says what Yak stands for');
check(main.includes('Version'), 'About shows a version');

const sections = ['About', 'What Yak stands for', 'Getting started', 'Timer and entries', 'Reports', 'Notes and tasks', 'Spaces', 'Devices and sync', 'Backup and restore', 'Browsers and phones', 'Obsidian plugin and folder mirror', 'Import from Toggl', 'Offline', 'Keyboard shortcuts', 'Privacy and data', 'Open source'];
const toc = page.getByRole('navigation', { name: 'Contents' });
for (const t of sections) {
  check((await toc.getByRole('link', { name: t, exact: true }).count()) === 1, `contents lists: ${t}`);
  check((await page.locator('main h2', { hasText: new RegExp(`^${t}$`) }).count()) === 1, `and the page has the section: ${t}`);
}

// A contents link jumps to its section on the same page.
await toc.getByRole('link', { name: 'Backup and restore', exact: true }).click();
check(page.url().endsWith('#/help/backups'), 'a contents link has a stable address');
check(await poll(() => page.evaluate(() => { const r = document.getElementById('help-backups')?.getBoundingClientRect(); return !!r && r.top >= -2 && r.top < 300; })) >= 0, 'it scrolls to the section');
check((await page.locator('main h2').count()) >= sections.length, 'all sections stay on one page');

// A section address opens at the section after a reload.
await page.goto(BASE + '?test#/help/privacy');
await page.waitForFunction(() => window.__app);
check(await poll(() => page.evaluate(() => { const r = document.getElementById('help-privacy')?.getBoundingClientRect(); return !!r && r.top >= -2 && r.top < 300; })) >= 0, 'a section address opens at the section');
const priv = await page.locator('#help-privacy').innerText();
for (const h of ['On your device', 'Between your own devices', 'What Cloudflare logs', 'Debug logs', 'Metrics', 'Reports by email']) check(priv.includes(h), `privacy covers: ${h}`);
check(priv.includes('7 days') && priv.includes('no warranty'), 'privacy states the log retention and the alpha warranty');

// Open source: the list matches the bundle (licenses.json), each package opens its licence text.
await page.goto(BASE + '?test#/help/open-source');
await page.waitForFunction(() => window.__app);
await page.locator('.oss-list li').first().waitFor();
const names = await page.locator('.oss-list summary strong').allInnerTexts();
const built = await (await page.request.get(BASE + 'licenses.json')).json();
check(names.length === built.length && built.every((e) => names.includes(e.name)), 'the list matches licenses.json');
for (const n of ['yjs', 'preact', 'jsqr', 'yaml', 'qrcode-generator', '@codemirror/view']) check(names.includes(n), `credits: ${n}`);
check((await page.request.get(BASE + 'THIRD-PARTY-LICENSES.txt')).ok(), 'THIRD-PARTY-LICENSES.txt is served');
await page.locator('.oss-list li').filter({ has: page.getByText('jsqr', { exact: true }) }).locator('summary').click();
check((await page.locator('.oss-list li').filter({ has: page.getByText('jsqr', { exact: true }) }).locator('pre').first().innerText()).includes('Apache License'), 'a package opens its licence text');
check((await page.locator('.oss-list li').filter({ has: page.getByText('yjs', { exact: true }) }).locator('summary').innerText()).includes('Kevin Jahns'), 'with its author');

// Shortcuts match the bindings.
const keys = await page.locator('#help-shortcuts tbody tr').evaluateAll((rows) => rows.map((r) => r.innerText));
check(keys.some((r) => r.includes('Show all commands') && r.includes('Alt P')), 'shortcuts: the palette');
check(keys.some((r) => r.includes('Go to Time') && r.includes('Alt T')), 'shortcuts: Go to Time');

// The old address redirects.
await page.evaluate(() => { location.hash = '#/manage/help/devices'; });
await page.waitForFunction(() => location.hash === '#/help/devices');
check(true, '#/manage/help/<x> redirects to #/help/<x>');

// Offline: the sections are in the bundle.
await context.setOffline(true);
await page.evaluate(() => { location.hash = '#/help/offline'; });
check(await poll(() => page.evaluate(() => !!document.getElementById('help-offline')?.innerText.includes('Needs a network'))) >= 0, 'sections open offline');
await context.setOffline(false);

// Report a problem: its own page, from Help and from the palette.
await page.evaluate(() => { location.hash = '#/help'; });
await page.getByRole('link', { name: 'Report a problem' }).first().click();
await page.getByRole('heading', { name: 'Report a problem', level: 1 }).waitFor();
check(page.url().endsWith('#/help/report'), 'Report a problem has its own page');
check((await page.locator('main h2', { hasText: 'Getting started' }).count()) === 0, 'and none of the guide');
await page.evaluate(() => { location.hash = '#/time'; });
await page.keyboard.press('Alt+P');
await page.keyboard.type('report');
await page.getByText('Report a problem', { exact: true }).first().click();
await page.getByRole('heading', { name: 'Report a problem', level: 1 }).waitFor();
check(true, 'the palette opens it');

// The status popover offers it once an error was captured.
await page.evaluate(() => { location.hash = '#/time'; });
await page.getByRole('button', { name: /^(Sync off|Synced|Via relay|Not connected)/ }).click();
check((await page.getByRole('link', { name: 'Report a problem' }).count()) === 0, 'no error: the popover does not offer it');
await page.keyboard.press('Escape');
await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('e2e boom'), message: 'e2e boom' })));
await page.getByRole('button', { name: /^(Sync off|Synced|Via relay|Not connected)/ }).click();
check((await poll(async () => (await page.getByRole('link', { name: 'Report a problem' }).count()) === 1)) >= 0, 'after an error the popover offers it');
await page.keyboard.press('Escape');

// Devices links to its section.
await page.evaluate(() => { location.hash = '#/settings/devices'; });
await page.getByRole('link', { name: 'How this works' }).click();
check(page.url().endsWith('#/help/devices'), 'Devices links to its section');

// What's new: a device that never looked sees a dot on the Settings tab; opening What's new clears it.
const fresh = await context.newPage();
await fresh.goto(BASE + '?test#/time');
await fresh.waitForFunction(() => window.__app);
check((await fresh.locator('.tab-dot').count()) === 0, 'a new device has nothing new');
await fresh.evaluate(() => localStorage.setItem('app-changes-seen', '2000-01-01'));
await fresh.reload();
await fresh.waitForFunction(() => window.__app);
check((await fresh.locator('.tab-dot:not(.warn)').count()) === 1 && (await fresh.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /^Settings/ }).locator('.tab-dot').count()) === 1, 'something new since this device last looked: a dot on the Settings tab');
await fresh.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /^Settings/ }).click();
await fresh.getByRole('link', { name: "What's new", exact: true }).click();
check(await poll(() => fresh.locator('.tab-dot').count().then((n) => n === 0)) >= 0, 'opening What\'s new clears the dot');
check((await fresh.evaluate(() => localStorage.getItem('app-changes-seen'))) > '2020', 'and remembers it');
const changes = await fresh.locator('#help-whats-new .change').count();
check(changes >= 1 && changes <= 10, `What's new lists the latest entries (${changes})`);
const newest = (await import('node:fs')).readFileSync(new URL('../../docs/user/changes.md', import.meta.url), 'utf8').match(/^## (\d{4}-\d\d-\d\d):/m)?.[1] ?? '';
check(newest !== '' && (await fresh.locator('#help-whats-new .change').first().innerText()).includes(newest), 'newest first');
const dates = await fresh.locator('#help-whats-new .change .change-date').allInnerTexts();
check(dates.length > 1 && dates.every((d, i) => i === 0 || dates[i - 1] >= d), `What's new is in date order (${dates.join(', ')})`);
await fresh.close();

// With data and no backup the bar shows at once and stays until the first backup works (it cannot be snoozed).
const nudge = await context.newPage();
await nudge.goto(BASE + '?test&backupbar#/time');
await nudge.waitForFunction(() => window.__backup !== undefined);
await nudge.evaluate(async () => { await window.__backup.ready(); window.__backup.seed('personal', 'Personal'); });
check(await poll(async () => /No backup yet/.test(await nudge.locator('.backup-banner').innerText().catch(() => ''))), 'with data and no backup: the bar says No backup yet');
check((await nudge.getByRole('button', { name: 'Remind me tomorrow' }).count()) === 0, 'and there is no snooze');
// Needs you (F-33): Settings lists it first, and its chip carries a dot.
await nudge.evaluate(() => { location.hash = '#/settings'; });
await nudge.locator('[data-need="backup-never"]').waitFor();
check((await nudge.locator('section.st-section > h2').first().innerText()).trim() === 'Needs you' && /No backup yet/.test(await nudge.locator('[data-need="backup-never"]').innerText()), 'Settings lists "No backup yet" first, under Needs you');
check((await nudge.locator('[data-toc="needs-you"] [data-dot="warn"]').count()) === 1 && (await nudge.locator('.main-tabs a', { hasText: /^Settings/ }).locator('.tab-dot.warn').count()) === 1, 'its chip and the Settings tab carry an amber dot');
await nudge.locator('[data-need="backup-never"] a').click();
check(await poll(async () => nudge.url().endsWith('#/settings/backup')), 'its Set up link opens Backup & restore');
await nudge.goBack();
await nudge.locator('[data-backup-never]').getByRole('button', { name: 'Set up' }).click();
check(await poll(async () => nudge.url().endsWith('#/settings/backup')), 'Set up opens Backup & restore');
await nudge.locator('[data-storage]').waitFor();
check(/Storage:/.test(await nudge.locator('[data-storage]').innerText()), 'Backup & restore says what the browser keeps (Storage)');
check(/deletes Yak's data/.test(await nudge.locator('.backups').innerText()), 'and that clearing site data deletes Yak\'s data');
await nudge.close();

// The alpha notice shows once per device.
const alpha = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const ap = await alpha.newPage();
await ap.goto(BASE + '?test&alpha#/time');
await ap.waitForFunction(() => window.__app);
await ap.getByRole('status', { name: 'Yak is in alpha' }).waitFor();
check((await ap.getByRole('status', { name: 'Yak is in alpha' }).innerText()).includes('backups'), 'the alpha notice mentions backups');
await ap.getByRole('button', { name: 'Got it' }).click();
check((await ap.getByRole('status', { name: 'Yak is in alpha' }).count()) === 0, 'it can be dismissed');
await ap.reload();
await ap.waitForFunction(() => window.__app);
check((await ap.getByRole('status', { name: 'Yak is in alpha' }).count()) === 0, 'and does not come back');
await alpha.close();

// With the "No backup yet" bar up, the alpha notice leaves out its own backup button (one call to action).
const both = await browser.newContext({ viewport: { width: 375, height: 700 } });
const bp = await both.newPage();
await bp.goto(BASE + '?test&alpha&backupbar#/time');
await bp.waitForFunction(() => window.__backup !== undefined);
await bp.evaluate(async () => { await window.__backup.ready(); window.__backup.seed('personal', 'Personal'); });
await bp.locator('[data-backup-never]').waitFor();
const notice = bp.getByRole('status', { name: 'Yak is in alpha' });
await notice.waitFor();
check((await notice.getByRole('button', { name: 'Turn on backups' }).count()) === 0 && (await bp.locator('[data-backup-never]').getByRole('button', { name: 'Set up' }).count()) === 1, 'bar and notice together: only the bar has the backup button');
check(/Settings › Help/.test(await notice.innerText()), 'the notice names Settings › Help');
await both.close();

// A browser that blocks IndexedDB gets a plain explanation, not a blank page.
const blocked = await browser.newContext({ viewport: { width: 600, height: 800 } });
await blocked.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
const blp = await blocked.newPage();
await blp.goto(BASE + '?test#/time');
await blp.locator('[data-boot-failure="no-storage"]').waitFor();
const failText = await blp.locator('[data-boot-failure]').innerText();
check(/can't store data in this browser/.test(failText) && /private/.test(failText) && /yak@/.test(failText), 'no IndexedDB: the page says why, what to try and how to report');
await blocked.close();

// The header fits.
for (const [w, hidden] of [[375, false], [180, true]]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.evaluate(() => { location.hash = '#/time'; });
  await page.locator('.topbar').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at ${w} px`);
  check((await page.locator('.palette-btn').isVisible()) === !hidden && (await page.locator('.sync-btn').isVisible()), `the command button is ${hidden ? 'hidden' : 'shown'} at ${w} px and the sync button shows`);
}

// Help and About open before any space exists, from the Welcome screen's Help link.
const wp = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
watchPage(wp, 'welcome', { consoleErrors: true });
await wp.goto(BASE + '?test&welcome#/');
await wp.getByRole('heading', { name: /^Welcome to/ }).waitFor();
check((await wp.getByText('Track your time, and keep notes and tasks in Markdown.').count()) === 1, 'welcome says what Yak is');
check((await wp.getByRole('link', { name: 'Help' }).count()) === 1, 'welcome has a Help link');
await wp.getByRole('link', { name: 'Help' }).click();
await wp.getByRole('heading', { name: 'Help & About' }).waitFor();
check((await wp.getByRole('heading', { name: 'About', exact: true }).count()) === 1, 'Help opens on the welcome screen');
await wp.getByRole('button', { name: /Back to the welcome/ }).click();
await wp.getByRole('heading', { name: /^Welcome to/ }).waitFor();
check((await wp.locator('input[aria-label="One-time code"]').isVisible()) === false, 'joining and restoring wait behind one small line');

await finish(browser);
