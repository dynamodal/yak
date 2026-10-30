// End-to-end for the device and space rows on Settings (F-33): a local-only device has one device row, "+ Add a device", "+ Share with an account"
// and the Backup, Passphrase and Sync lines (always shown); it opens the share sheet and the Add a device page. On two paired profiles one device unticks
// a space for the other from the device row, the other sees it in the space row, and both write the same record. At 375 px nothing is wider than the screen.
//
//   npm run e2e settings-rows
//
import { BASE, launch, ok, check, watchPage, until, finish, startSyncing, joinByInvite, openRow, openAdvanced } from './lib.mjs';

const browser = await launch();
const mk = async (name, size = { width: 1100, height: 900 }) => {
  const page = await (await browser.newContext({ viewport: size })).newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}?test#/settings`);
  await page.locator('.st-row').first().waitFor();
  return page;
};

// ---- A device that never paired
{
  const p = await mk('local');
  check((await p.locator('[data-device-row]').count()) === 1, 'local-only: one device row');
  check((await p.getByRole('link', { name: /Add a device/ }).count()) >= 1 && (await p.getByRole('button', { name: '+ New space' }).count()) === 1, 'local-only: "+ Add a device" beside "+ New space"');
  check((await p.getByRole('button', { name: '+ Share with an account' }).count()) === 1, 'local-only: one "+ Share with an account" button');
  check((await p.locator('[data-line="passphrase"], [data-line="sync"]').count()) === 2 && (await p.locator('[data-backups] .backup-health').count()) === 1, 'local-only: the backup summary, passphrase and sync lines are all there');
  const text = await p.locator('.st-home').innerText();
  check(!/fingerprint|device id|\bid [0-9a-f]{8}\b/i.test(text), 'local-only: no fingerprint or device id on the page until Advanced is opened');
  const row = await openRow(p, 'This device');
  check((await row.getByLabel('This device keeps Personal').isChecked()) && (await row.getByLabel('This device keeps Work').isChecked()), 'local-only: this device keeps its spaces (toggle chips)');

  await p.getByRole('button', { name: '+ Share with an account' }).click();
  const dialog = p.locator('dialog[open]');
  await dialog.waitFor();
  check((await dialog.getByLabel('Space to share').count()) === 1 && (await dialog.getByRole('button', { name: 'Make a link' }).count()) === 1, '"+ Share with an account" opens the share sheet with a space list and "Make a link"');
  await p.keyboard.press('Escape');
  check((await p.locator('dialog[open]').count()) === 0, 'the sheet closes with Escape');

  await p.locator('.st-actions').getByRole('link', { name: '+ Add a device' }).first().click();
  await p.getByRole('heading', { name: 'Add a device', level: 1 }).waitFor();
  check((await p.evaluate(() => location.hash)) === '#/settings/devices/add', '"+ Add a device" opens the Add a device page');
  await p.goBack();
  await p.locator('.st-row').first().waitFor();
  check((await p.evaluate(() => location.hash)) === '#/settings', 'Back returns to Settings');

  await p.setViewportSize({ width: 375, height: 800 });
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '375 px: no horizontal scroll on the page');
  const small = await p.evaluate(() => [...document.querySelectorAll('.st-home .st-row-head, .st-home .st-toc-chip, .st-home .btn')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 32).length);
  check(small === 0, `375 px: rows, chips and buttons are at least 32 px tall (${small} smaller)`);
  await p.context().close();
}

// ---- Two paired profiles: keeps for another device
{
  const a = await mk('A');
  const b = await mk('B');
  for (const p of [a, b]) await p.evaluate(() => { location.hash = '#/devices'; });
  await startSyncing(a);
  await joinByInvite(a, b);
  const name = async (p, n) => {
    await p.evaluate(() => { location.hash = '#/settings/devices-sync/this'; });
    const input = p.locator('input[aria-label="This device\'s name"]');
    await input.fill(n);
    await input.press('Enter');
    await input.blur();
  };
  await name(a, 'Laptop');
  await name(b, 'Bee');
  for (const p of [a, b]) await p.evaluate(() => { location.hash = '#/settings'; });
  const heads = (p) => p.locator('[aria-label="Devices"] .st-row-title').allInnerTexts().then((t) => t.map((x) => x.trim()).join('|'));
  check((await until(async () => (await heads(a)) === 'Laptop|Bee', 20000)) >= 0, 'A lists itself first, then Bee');
  check((await until(async () => (await heads(b)) === 'Bee|Laptop', 20000)) >= 0, 'B lists itself first, then Laptop');
  const beeA = await openRow(a, 'Bee');
  check((await beeA.getByLabel('Bee keeps Work').isChecked()) && (await beeA.getByLabel('Bee keeps Personal').isChecked()), 'A sees that Bee keeps both spaces');
  await beeA.getByLabel('Bee keeps Work').uncheck();
  const thisB = await openRow(b, 'Bee');
  check((await until(async () => !(await thisB.getByLabel('This device keeps Work').isChecked()), 10000)) >= 0, "unticking Bee's chip on A unticks it on Bee");
  check(await thisB.getByLabel('This device keeps Personal').isChecked(), 'and leaves the other space alone');
  // The space row shows the same record.
  const workB = await openRow(b, 'Work');
  check(!(await workB.getByLabel('This device keeps Work').isChecked()), 'the Work space row on Bee agrees: not kept here');
  await workB.getByLabel('This device keeps Work').check();
  check((await until(async () => await beeA.getByLabel('Bee keeps Work').isChecked(), 10000)) >= 0, 'ticking it in the space row on Bee shows in the device row on A');
  await b.getByLabel('Laptop keeps Personal').first().uncheck().catch(() => undefined);

  check((await a.locator('[data-line="sync"]').count()) === 1 && (await a.locator('[data-line="passphrase"]').count()) === 1, 'a paired device shows the passphrase and sync lines');
  check(/Unlocked/.test(await a.locator('[data-line="passphrase"]').innerText()), 'the passphrase line says unlocked with the minutes left (just created)');
  check(/Syncing with|waiting/.test(await a.locator('[data-line="sync"]').innerText()), 'the sync line says who it syncs with');
  await a.setViewportSize({ width: 375, height: 800 });
  await a.waitForTimeout(300);
  const wide = await a.evaluate(() => [...document.querySelectorAll('.st-home *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().right)}`).slice(0, 5));
  check(wide.length === 0 && (await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), `375 px with two devices: nothing wider than the screen (${wide.join(', ')})`);
  const lines = await a.evaluate(() => [...document.querySelectorAll('.data-line')].map((e) => Math.round(e.getBoundingClientRect().height)));
  check(lines.length >= 3 && lines.every((h) => h <= 48), `375 px: each status line is one row (${lines.join(', ')} px)`);
  await a.setViewportSize({ width: 1100, height: 900 });
  await a.getByRole('button', { name: '+ Share with an account' }).click();
  await a.locator('dialog[open]').getByRole('button', { name: 'Make a link' }).waitFor();
  ok('"+ Share with an account" opens the share sheet on a paired device');
  await a.keyboard.press('Escape');
  await a.context().close();
  await b.context().close();
}

// ---- 360 px, a syncing device: no section is wider than the screen, Advanced with every fold open included (#81)
{
  const p = await mk('phone', { width: 360, height: 740 });
  await p.evaluate(() => { location.hash = '#/devices'; });
  await startSyncing(p);
  const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  for (const slug of ['needs-you', 'backups', 'version-history', 'recently-deleted', 'passphrase', 'devices-sync', 'spaces', 'sharing', 'organize', 'notes', 'display', 'features', 'help']) {
    await p.evaluate((h) => { location.hash = h; }, `#/settings/${slug}`);
    await p.waitForTimeout(150);
    check(await fits(), `360 px: Settings › ${slug} fits the screen`);
  }
  await p.evaluate(() => { location.hash = '#/settings/advanced'; });
  const fold = await openAdvanced(p);
  await fold.locator('.st-adv[data-adv="connection"]').waitFor();
  for (const d of await fold.locator('details').all()) if (!(await d.evaluate((e) => e.open))) await d.locator('summary').first().click();
  await p.waitForTimeout(500);
  const wide = await p.evaluate(() => [...document.querySelectorAll('details.advanced *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName}.${e.className}`).slice(0, 5));
  check((await fits()) && wide.length === 0, `360 px: Settings › Advanced with every fold open fits the screen (${wide.join(', ')})`);
  await p.context().close();
}

await finish(browser);
