// Joining by one-time code in real Obsidian (#140): the vault shows the compare code, the open settings tab offers
// "The codes match" without being reopened, the app approves, and the vault joins and syncs; a note edit goes both
// ways; a vault removed on the Devices page says so and offers to join again.
//
// The app runs in Playwright's Chromium (scripts/e2e/lib.mjs) against the test build served by wdio.conf.mjs; the
// plugin talks to the same mock relay. Obsidian is driven through its real settings tab; executeObsidian only reads
// state, sets up the relay address and edits a vault file the way an editor would.
import { browser, $, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { failureCount, launch, openRow, startSyncing, unlockIfAsked, until, watchPage } from '../../../scripts/e2e/lib.mjs';

const BASE = process.env.TARGET;
const RELAY = BASE.replace(/^http/, 'ws').replace(/\/?$/, '/signal');

/** A row of the open settings tab by its name. */
const settingRow = (name) => $(`//div[contains(concat(" ",normalize-space(@class)," ")," setting-item ")][.//div[contains(@class,"setting-item-name")][normalize-space()="${name}"]]`);
const rowDesc = async (name) => (await settingRow(name).$('.setting-item-description').getText()).trim();
const statusLine = () => rowDesc('Sync status');

// Obsidian 1.14 shows Settings in a window of its own; notices and executeObsidian belong to the main window.
let mainWindow;
/** Run `fn` with the main window current, then go back to the settings window. */
async function inMain(fn) {
  const was = await browser.getWindowHandle();
  await browser.switchToWindow(mainWindow);
  try {
    return await fn();
  } finally {
    if (was !== mainWindow) await browser.switchToWindow(was);
  }
}
/** True once some Obsidian window shows a notice containing `text` (Obsidian draws it in the active window). */
async function noticeShown(text) {
  const was = await browser.getWindowHandle();
  try {
    for (const h of await browser.getWindowHandles()) {
      await browser.switchToWindow(h);
      if (await $(`.notice*=${text}`).isExisting()) return true;
    }
    return false;
  } finally {
    await browser.switchToWindow(was);
  }
}
const obsidian = (fn, ...args) => inMain(() => browser.executeObsidian(fn, ...args));
/** A vault file's text, or undefined. */
const vaultText = (path) => obsidian(async ({ app }, p) => ((await app.vault.adapter.exists(p)) ? app.vault.adapter.read(p) : undefined), path);

describe('Yak Sync in real Obsidian', function () {
  let chromium;
  let app;
  let code;
  let vaultName;
  const A = (fn, arg) => app.evaluate(fn, arg);

  before(async function () {
    chromium = await launch();
    app = await (await chromium.newContext()).newPage();
    watchPage(app, 'app');
    await app.goto(`${BASE}?test#/settings/notes`);
    await app.waitForFunction(() => window.__app?.spaces().personal && window.__mirror !== undefined, null, { timeout: 30000 });
    await A(() => window.__mirror.addNote('personal', 'Ideas/Plan.md', 'first'));
    await A(() => (location.hash = '#/devices'));
    await startSyncing(app);
    await app.getByRole('button', { name: 'Make a one-time code' }).click();
    code = (await app.locator('[data-invite-code]').innerText()).trim();
  });

  // A failure shows what the plugin saw: its join state, relay and the end of its connection log.
  afterEach(async function () {
    if (this.currentTest?.state !== 'failed') return;
    const seen = await obsidian(({ plugins }) => ({ join: plugins.yakSync.keys.join, relay: plugins.yakSync.data.relay, status: plugins.yakSync.sync.status.state, paired: plugins.yakSync.sync.status.paired, log: plugins.yakSync.sync.log.toText().split('\n').slice(-40).join('\n') })).catch((e) => ({ error: String(e) }));
    console.log(`plugin state after the failure:\n${JSON.stringify({ ...seen, log: undefined }, null, 1)}\n${seen.log ?? ''}`);
  });

  after(async function () {
    await chromium?.close();
  });

  it('opens the plugin settings tab', async function () {
    mainWindow = await obsidianPage.getMainWindowHandle();
    await obsidian(({ app }) => {
      app.setting.open();
      app.setting.openTabById('yak-sync');
    });
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1, { timeoutMsg: 'no settings window opened' });
    await browser.switchWindow(/^Settings/);
    await expect(settingRow('Sync status')).toBeDisplayed();
    expect(await statusLine()).toMatch(/^Not joined/);
  });

  it('joins with the one-time code from the settings tab', async function () {
    const relay = await settingRow('Signaling server').$('input');
    await relay.clearValue();
    await relay.setValue(RELAY);
    await settingRow('Sync code').$('input').setValue(code);
    await settingRow('Sync code').$('button=Join').click();
    // The notice names the code; the tab that is still open offers to confirm it (#140).
    await browser.waitUntil(() => noticeShown('your other device must show'), { timeout: 30000, timeoutMsg: 'no notice with the code to compare' });
    await $('button=The codes match').waitForDisplayed({ timeout: 15000 });
    const vaultCompare = (await rowDesc('Compare the code')).match(/must show (\S+?)\.?$/)?.[1];
    const appCompare = (await app.locator('[data-compare]').first().innerText({ timeout: 30000 })).trim();
    expect(vaultCompare).toBe(appCompare);
    await $('button=The codes match').click();
    await expect(settingRow('Approve this vault')).toBeDisplayed();
    await app.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
    await unlockIfAsked(app);
    await browser.waitUntil(async () => /^Syncing with 1 other device/.test(await statusLine()), { timeout: 40000, timeoutMsg: 'the status line never said the vault is syncing' });
    await expect(settingRow('Leave')).toBeDisplayed();
  });

  it('keeps a space the owner ticks and syncs a note both ways', async function () {
    vaultName = await obsidian(({ plugins }) => plugins.yakSync.shownDeviceName());
    expect(vaultName).toMatch(/^Obsidian \(.+, desktop, [0-9a-f]{4}\)$/);
    await A(() => (location.hash = '#/settings'));
    await openRow(app, vaultName);
    await app.getByLabel(`${vaultName} keeps Personal`).check({ timeout: 30000 });
    await browser.waitUntil(async () => (await vaultText('Yak/Personal/Ideas/Plan.md')) === 'first', { timeout: 40000, timeoutMsg: 'the note never reached the vault' });

    await obsidian(async ({ app }) => {
      const f = app.vault.getAbstractFileByPath('Yak/Personal/Ideas/Plan.md');
      await app.vault.modify(f, 'edited in Obsidian');
    });
    const reached = await until(() => A(() => window.__mirror.notes('personal')['Ideas/Plan.md'] === 'edited in Obsidian'), 30000);
    expect(reached).toBeGreaterThanOrEqual(0);

    await A(() => window.__mirror.appendToNote('personal', 'Ideas/Plan.md', ' + app'));
    await browser.waitUntil(async () => (await vaultText('Yak/Personal/Ideas/Plan.md')) === 'edited in Obsidian + app', { timeout: 30000, timeoutMsg: 'the app edit never reached the vault' });
  });

  it('says so when the vault is removed on the Devices page, and offers to join again', async function () {
    const id = await obsidian(({ plugins }) => plugins.yakSync.data.deviceId);
    const row = app.locator(`[data-device-row="${id}"]`);
    if ((await row.locator('.st-row-head').getAttribute('aria-expanded')) !== 'true') await row.locator('.st-row-head').click();
    await row.getByRole('button', { name: /^Remove .* from account…$/ }).click();
    await row.locator('.confirm-panel').getByRole('button', { name: /^Remove .* from the account$/ }).click();
    await unlockIfAsked(app);
    await browser.waitUntil(async () => /^Removed/.test(await statusLine()), { timeout: 40000, timeoutMsg: 'the vault never learned it was removed' });
    expect(await statusLine()).toMatch(/join again/i);
    await expect(settingRow('Sync code')).toBeDisplayed();
    await expect(settingRow('Leave')).not.toBeDisplayed();
  });

  it('had no page errors in the app', function () {
    expect(failureCount()).toBe(0);
  });
});
