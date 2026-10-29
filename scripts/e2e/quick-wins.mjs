// End-to-end for the mobile and newcomer quick wins (#21): Organize in Settings, empty Notes page actions, Enter in a
// note's title, Reports CSV button, Import help link, touch-sized header buttons with an icon-only idle pill, and
// the palette without keyboard hints on a touch screen. No CSP violations or page errors.
//
//   npm run e2e quick-wins
//
import { BASE, launch, check, watchPage, poll, finish } from './lib.mjs';

const browser = await launch();

// ---- desktop ----
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await context.newPage();
  watchPage(p, 'desktop', { consoleErrors: true });
  await p.goto(`${BASE}?test#/settings/organize`);
  await p.locator('details.st-open[open] .projects-page').waitFor();
  check(await p.getByRole('link', { name: '← Settings' }).count() === 0, 'Organize is a section of Settings: no back link needed');

  await p.evaluate(() => { location.hash = '#/notes'; });
  await p.getByRole('button', { name: "Today's note" }).waitFor();
  check((await p.getByRole('button', { name: 'New note' }).count()) >= 1, 'empty Notes page offers New note and Today\'s note');
  await p.locator('.empty-state').getByRole('button', { name: 'New note' }).click();
  const title = p.getByLabel('Note title');
  await title.waitFor();
  await title.fill('Quick win');
  await title.press('Enter');
  check(await poll(async () => p.evaluate(() => !!document.activeElement?.closest('.note-editor'))), 'Enter in the title moves focus to the note body');
  check((await title.inputValue()) === 'Quick win', 'the typed title is kept');

  await p.evaluate(() => { location.hash = '#/time/reports'; });
  const section = p.locator('#rp-table');
  await section.getByRole('button', { name: 'Download CSV' }).waitFor();
  check((await section.getByRole('button', { name: 'Copy as Markdown' }).count()) === 1, 'Reports: Download CSV sits next to Copy as Markdown');

  await p.evaluate(() => { location.hash = '#/settings/import'; });
  await p.getByRole('link', { name: 'Step by step in Help' }).waitFor();
  check(true, 'Import links to the Toggl export steps');
  await context.close();
}

// ---- phone with touch ----
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await context.newPage();
  watchPage(p, 'phone', { consoleErrors: true });
  await p.goto(`${BASE}?test#/time`);
  await p.locator('.timer-pill').waitFor();
  await p.getByRole('button', { name: 'Start timer' }).click();
  await p.getByRole('button', { name: 'Stop timer' }).click();
  await p.getByRole('button', { name: 'Start timer' }).waitFor();
  const box = await p.getByRole('button', { name: 'Start timer' }).boundingBox();
  check(box && box.height >= 44 && box.width >= 44, `header start is at least 44 px (${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)})`);
  check((await p.locator('.timer-pill .tp-label').isVisible()) === false, 'the idle pill is only its round button on a phone');
  await p.keyboard.press('Control+k');
  const keys = await p.evaluate(() => [...document.querySelectorAll('.palette-keys, .palette-help')].every((e) => getComputedStyle(e).display === 'none'));
  check(keys, 'the palette hides keyboard hints on a touch screen');
  await context.close();
}

await browser.close();
finish();
