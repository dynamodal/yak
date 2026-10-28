// End-to-end for the app header (#33, slice 3a): logo and name, icon tabs with hidden labels on narrow screens, the
// command button with its shortcut chip, the sync status control in its four shapes and its popover (Esc closes and
// returns focus), the Settings tab dot, tab order, and no sideways scroll at 320, 375, 768 and 1280 px.
// The sync states are shown with the test hook `window.__app.fakeStatus`, as no real second device is needed.
//
//   npm run e2e header
//
import { BASE, launch, check, watchPage, poll, finish } from './lib.mjs';

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p = await context.newPage();
watchPage(p, 'header', { consoleErrors: true });
await p.goto(`${BASE}?test#/time`);
await p.waitForFunction(() => window.__app?.fakeStatus);
await p.locator('.sync-btn').waitFor();

const peer = (id, state, via) => ({ id, state, ...(via ? { via } : {}), lastConnectedAt: Date.parse('2026-03-24T10:14:00Z') });
const STATES = {
  off: { s: { paired: false, peers: [] }, name: /^Sync off/, label: 'Sync off', shape: 'rect', filled: true },
  direct: { s: { paired: true, state: 'connected', peers: [peer('aaaaaaaa-1', 'connected', 'direct'), peer('bbbbbbbb-2', 'waiting-for-peer')] }, name: /^Synced/, label: 'Synced', shape: 'circle', filled: true },
  relay: { s: { paired: true, state: 'connected', peers: [peer('aaaaaaaa-1', 'connected', 'relay')] }, name: /^Via relay/, label: 'Via relay', shape: 'circle', filled: false },
  offline: { s: { paired: true, state: 'waiting-for-peer', peers: [peer('aaaaaaaa-1', 'waiting-for-peer')] }, name: /^Not connected/, label: 'Not connected', shape: 'path', filled: true },
};
const show = async (state) => {
  await p.evaluate((s) => window.__app.fakeStatus(s), STATES[state].s);
  await poll(async () => (await p.locator('.sync-btn').getAttribute('aria-label'))?.startsWith(STATES[state].label));
};
const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---- Wide: logo and name, tabs with icons, command button with chip, sync control
check((await p.locator('.brand-name').innerText()) === 'Yak' && (await p.locator('.brand-icon').isVisible()), '1280 px: the logo and the app name show');
const tabs = p.getByRole('navigation', { name: 'Pages' }).getByRole('link');
check((await tabs.allInnerTexts()).map((t) => t.trim()).join() === 'Time,Notes,Tasks,Settings', 'the tabs are Time, Notes, Tasks, Settings');
check((await p.locator('.tabs a .ui-icon').count()) === 4, 'each tab has an icon');
check((await p.locator('.topbar').getByRole('link', { name: /^Help/ }).count()) === 0 && (await p.locator('.status-dot-btn').count()) === 0, 'no Help "?" and no status dot in the header');
const cmd = p.getByRole('button', { name: 'Command palette' });
check((await cmd.getAttribute('title')) === 'Search, go to, run a command' && (await cmd.locator('.palette-chip').innerText()) === 'Alt P', 'the command button has its tooltip and the Alt P chip');
await cmd.click();
await p.locator('dialog.palette').waitFor();
check(true, 'the command button opens the palette');
await p.keyboard.press('Escape');

// ---- The four shapes: a distinct drawing and name each, never colour alone
const drawings = new Set();
for (const state of Object.keys(STATES)) {
  await show(state);
  const btn = p.locator('.sync-btn');
  const label = (await btn.locator('.sync-label').innerText()).trim();
  const svg = await btn.locator('.sync-shape svg').innerHTML();
  drawings.add(svg);
  check(label === STATES[state].label && (await btn.getAttribute('aria-label')).startsWith(label), `${state}: label "${label}", and the name starts with it`);
  const filled = (await btn.locator('.sync-shape svg').getAttribute('fill')) === 'currentColor';
  check(svg.includes(`<${STATES[state].shape}`) && filled === STATES[state].filled, `${state}: drawn as a ${STATES[state].filled ? 'filled' : 'outlined'} ${STATES[state].shape}`);
}
check(drawings.size === 4, 'the four states are four different shapes');

// ---- The popover: devices and how each is linked; Esc closes and returns focus
await show('direct');
const btn = p.locator('.sync-btn');
await btn.click();
const panel = p.getByRole('dialog', { name: 'Sync status' });
// The popover listens for Esc from the next frame on: press until it closes.
const closePopover = () => poll(async () => { await p.keyboard.press('Escape'); return (await panel.count()) === 0; });
await panel.waitFor();
const text = await panel.innerText();
check(/Synced directly · 1 of 2/.test(text) && /aaaaaaaa/.test(text) && /Direct/.test(text) && /Not connected/.test(text) && /last connected/.test(text), 'direct: the popover lists each device with its link and when it was last connected');
check(/relay only carries sealed data/.test(text) && (await panel.getByRole('link', { name: 'Devices' }).count()) === 1, 'and notes the relay and links to the devices in Settings');
await closePopover();
check(await poll(async () => (await panel.count()) === 0 && (await p.evaluate(() => document.activeElement?.classList.contains('sync-btn')))), 'Esc closes the popover and focus returns to the sync button');
await show('relay');
await btn.click();
check(/Via relay/.test(await panel.innerText()), 'relay: the popover says Via relay');
await closePopover();
await show('off');
await btn.click();
await panel.getByRole('link', { name: 'Set up sync' }).click();
check(await poll(async () => p.url().endsWith('#/settings/devices/add')), 'off: "Set up sync" goes to where sync is started in Settings');
await p.evaluate(() => { location.hash = '#/time'; });
await p.locator('.sync-btn').waitFor();

// ---- Tab order: logo, tabs, timer, commands, sync
await p.locator('.brand').focus();
const order = [];
for (let i = 0; i < 9; i++) {
  order.push(await p.evaluate(() => {
    const a = document.activeElement;
    return a?.closest('.brand') ? 'logo' : a?.closest('.tabs') ? 'tab' : a?.closest('.header-timer') ? 'timer' : a?.closest('.palette-btn') || a?.classList.contains('palette-btn') ? 'commands' : a?.classList.contains('sync-btn') ? 'sync' : 'other';
  }));
  await p.keyboard.press('Tab');
}
const squashed = order.filter((v, i) => i === 0 || v !== order[i - 1]);
check(squashed.join() === 'logo,tab,timer,commands,sync', `keyboard order is logo, tabs, timer, commands, sync (${squashed.join()})`);

// ---- The Settings tab dot: neutral for What's new, amber for a health warning
await p.evaluate(() => localStorage.setItem('app-changes-seen', '2000-01-01'));
await p.reload();
await p.waitForFunction(() => window.__app?.fakeStatus);
const settingsTab = p.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /^Settings/ });
check((await settingsTab.locator('.tab-dot:not(.warn)').count()) === 1 && (await p.getByRole('link', { name: 'Settings something is new' }).count()) === 1, 'Settings has a neutral dot (named for screen readers) while What\'s new is unseen');

// ---- Narrow: labels go, names stay; no sideways scroll at 320, 375, 768 and 1280
for (const width of [320, 375, 768, 1280]) {
  await p.setViewportSize({ width, height: 800 });
  for (const state of Object.keys(STATES)) {
    await show(state);
    check((await overflow()) <= 0, `${width} px, sync ${state}: no sideways scroll (${await overflow()})`);
  }
  const labelsShown = await p.locator('.tabs a .tab-label').first().evaluate((el) => el.getBoundingClientRect().width > 2);
  check(labelsShown === (width >= 576), `${width} px: tab labels ${width >= 576 ? 'show' : 'are hidden'}`);
  check((await p.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /^Time/ }).count()) === 1, `${width} px: the Time tab keeps its name`);
  const nameShown = await p.locator('.brand-name').evaluate((el) => el.getBoundingClientRect().width > 2);
  check(nameShown === (width >= 448) && (await p.locator('.brand-icon').isVisible()), `${width} px: the logo shows, the name ${width >= 448 ? 'too' : 'is hidden'}`);
  const cmdBox = await p.locator('.palette-btn').boundingBox();
  const syncBox = await p.locator('.sync-btn').boundingBox();
  check(cmdBox && syncBox && syncBox.x + syncBox.width <= width && cmdBox.x + cmdBox.width <= syncBox.x, `${width} px: command and sync buttons are in view, sync last`);
  check(width >= 576 || (await p.locator('.sync-label').first().isHidden() && (await p.locator('.palette-chip').isHidden())), `${width} px: the sync label and the chip are hidden when narrow`);
}

await finish(browser);
