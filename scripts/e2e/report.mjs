// End-to-end: Manage > Help & About > Report a problem. The form shows exactly what will be sent,
// the details can be left out, Copy report puts it on the clipboard, Download saves a .txt, and
// Email builds a mailto: link with subject and a short body while the full report is copied.
//
//   npm run e2e report
//
import { BASE, launch, check, watchPage, finish } from './lib.mjs';

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
watchPage(page, 'report', { consoleErrors: true });
await page.goto(BASE + '?test#/time');
await page.waitForFunction(() => window.__app);
await page.evaluate(() => { location.hash = '#/help/report'; });
await page.getByRole('heading', { name: 'Report a problem' }).waitFor();

const preview = () => page.locator('pre[aria-label="Report preview"]').innerText();
await page.getByLabel('What happened').fill('The timer would not stop');
await page.getByLabel('What you expected').fill('It stops');
let text = await preview();
check(text.includes('The timer would not stop') && text.includes('It stops'), 'the preview shows what was typed');
check(text.includes('App version:') && text.includes('Page: #/time') && text.includes('Debug log'), 'it shows version, the page they were on and the log by default');
await page.getByRole('checkbox').uncheck();
text = await preview();
check(!text.includes('App version:') && !text.includes('Debug log'), 'unticking the details removes them');
await page.getByRole('checkbox').check();

await page.getByRole('button', { name: 'Copy report' }).click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
check(clip === (await preview()), 'Copy report puts exactly the previewed text on the clipboard');

const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report' }).click()]);
check(/^yak-report-\d{4}-\d{2}-\d{2}\.txt$/.test(download.suggestedFilename()), `Download report saves a .txt (${download.suggestedFilename()})`);

// Email: a mailto: link with the subject and a short body; pressing it also copies the full report.
const link = page.getByRole('link', { name: 'Email the report' });
const href = await link.getAttribute('href');
const url = new URL(href);
check(url.protocol === 'mailto:' && url.pathname === 'yak@dynamodal.com', 'the mail link goes to the feedback address');
check(url.searchParams.get('subject') === 'Yak problem: The timer would not stop', `the subject has the first words (${url.searchParams.get('subject')})`);
const body = url.searchParams.get('body') ?? '';
check(body.includes('The timer would not stop') && body.includes('Full report copied; paste or attach it.') && href.length < 2000, 'the body is short and says the full report is copied');
await page.evaluate(() => navigator.clipboard.writeText('x'));
await link.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
await link.click();
await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('Yak problem report'));
check(true, 'pressing it copies the full report');
await finish(browser);
