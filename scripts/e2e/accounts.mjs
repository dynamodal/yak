// End-to-end: the Other accounts list, a space's Kept on / Shared with, and an account's page (#334).
// Account A (owner) shares Personal with account B through the space page (an open link shows its time left and
// can be cancelled), then both see each other in Other accounts. Kept on toggles. A renames B on B's page.
// From B's page A shares a second space (Work): a third account C asking through that link is called out
// plainly (different fingerprint) and declined; B then joins. A ends Work; B leaves Personal.
//
//   npm run e2e accounts
//
import { BASE, launch, ok, check, watchPage, until, finish, fillSheet } from './lib.mjs';

const PASS_A = 'e2e passphrase for accounts A';
const PASS_B = 'e2e passphrase for accounts B';
const PASS_C = 'e2e passphrase for accounts C';
const browser = await launch({ fakeCamera: true });
const mk = async (n, hash) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test' + hash);
  await page.waitForFunction(() => window.__app);
  return page;
};
const hook = (p, f, arg) => p.evaluate(f, arg);
const goto = (p, hash) => p.evaluate((h) => { location.hash = h; }, hash);
const dlg = (p) => p.locator('dialog[open], dialog.sheet[open]').first();

/** B (or C) opens a share link, asks, compares the code and confirms; resolves with the code B sees. */
async function ask(p, code, name, pass) {
  await p.goto(BASE + '?test#/share/' + code);
  await p.reload(); // a hash change alone keeps the earlier join state
  await p.waitForFunction(() => window.__app);
  await p.getByLabel('Your name').fill(name);
  await p.getByRole('button', { name: 'Ask to join' }).click();
  await fillSheet(p, pass);
  return (await p.locator('[data-compare]').innerText({ timeout: 40000 })).trim();
}

const a = await mk('A', '#/settings');
const spaceP = await hook(a, () => window.__app.spaces().personal);
const spaceW = await hook(a, () => window.__app.spaces().work);

// Nothing shared yet: the list says so and offers the button.
check((await a.locator('.st-accounts li[data-account]').count()) === 0 && (await a.getByText('Nothing is shared with another account.').count()) === 1, 'no accounts yet: the list says so');
check((await a.locator('.st-accounts [data-edit-warning], .st-accounts .hint').first().innerText()).includes('cannot be taken back'), 'the warning about edit and delete rights is above the list');

// The space page: Kept on, and Shared with with no share yet.
await goto(a, `#/settings/space/${spaceP}`);
await a.locator('legend', { hasText: 'Kept on' }).waitFor();
const keepBox = a.getByLabel('This device keeps Personal');
check(await keepBox.isChecked(), 'Kept on lists this device, ticked');
await keepBox.uncheck();
check(!(await keepBox.isChecked()), 'Kept on: unticking works');
await keepBox.check();
check(await keepBox.isChecked(), 'Kept on: ticking again works');
check((await a.getByText('Time entries and rates are never shared.').count()) === 1, 'the space page says time entries and rates are never shared');

// An open link shows its time left and can be cancelled.
await a.getByRole('button', { name: '+ Share Personal with an account' }).click();
await a.getByLabel('Your name').fill('Alice');
await a.getByRole('button', { name: 'Make a link' }).click();
await fillSheet(a, PASS_A);
await a.locator('[data-share-url]').waitFor({ timeout: 30000 });
check(/\d+ min left/.test(await a.locator('[data-share-time-left]').innerText()), 'the open link shows its time left');
await a.getByRole('button', { name: 'Cancel link' }).click();
check((await a.locator('[data-share-link]').count()) === 0, 'Cancel closes the link');
await a.getByRole('button', { name: '+ Share Personal with an account' }).click();
await a.getByRole('button', { name: 'Make a link' }).click();
const link = (await a.locator('[data-share-url]').innerText({ timeout: 30000 })).trim();
const code = link.split('#/share/')[1];

const b = await mk('B', '#/settings');
const codeB = await ask(b, code, 'Bob', PASS_B);
const fpB = await hook(b, () => window.__app.accountFp());
const fpA = await hook(a, () => window.__app.accountFp());
const codeA = (await a.locator('.invite-requests [data-compare]').innerText({ timeout: 40000 })).trim();
check(codeA === codeB, `the codes match (${codeB})`);
await b.getByRole('button', { name: 'The codes match' }).click();
await a.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await b.locator('[data-share-done]').waitFor({ timeout: 40000 });
ok('B joined Personal');
await until(async () => (await hook(a, (s) => window.__app.shareView(s), spaceP))?.members.includes(fpB), 30000);

// Once B is in the roster the link is spent: no request, no link, no chip.
await a.locator(`.share-members li[data-member="${fpB}"]`).waitFor();
check((await a.locator('[data-share-link]').count()) === 0, 'the finished link and its request are gone from the space page');
check((await a.getByRole('button', { name: '+ Share Personal with an account' }).count()) === 1, 'the share button is back');
const order = await a.locator('[data-space] .st-row-body > legend, [data-space] .st-row-body legend, [data-space] .st-row-body > h3').allInnerTexts();
check(order.join('|').startsWith('Kept on|Shared with') && order[order.length - 1] === 'Space', `space row order (${order.join(' | ')})`);
await goto(a, '#/settings');
const rowA = a.locator(`.st-accounts li[data-account="${fpB}"]`);
await rowA.waitFor();
const textA = await rowA.innerText();
check(/Bob/.test(textA) && /you share 1 space/.test(textA), `A's list: Bob, you share 1 space (${textA.replace(/\s+/g, ' ')})`);
check((await a.locator('[data-space] [data-chip]').filter({ hasText: 'Bob' }).count()) === 1, 'A: the Personal row carries a "Bob" chip');
check((await a.getByRole('button', { name: /^Share .* with another account$/ }).count()) === 0, 'A: no per-row Share… any more');
check((await a.locator('[data-space] [data-chip]').filter({ hasText: 'link open' }).count()) === 0, 'A: no "link open" chip after the link was used');
await goto(a, `#/settings/space/${spaceP}`);
const memberRow = a.locator(`.share-members li[data-member="${fpB}"]`);
await memberRow.waitFor();
const memberText = await memberRow.innerText();
check(/Bob/.test(memberText) && /Since/.test(memberText) && memberText.includes(fpB.slice(0, 4)), `A's space page: Bob with fingerprint and since (${memberText.replace(/\s+/g, ' ')})`);
check((await memberRow.getByRole('button', { name: 'End share with Bob' }).count()) === 1, 'A can End the share');

// Member view.
await goto(b, '#/settings');
const rowB = b.locator(`.st-accounts li[data-account="${fpA}"]`);
await rowB.waitFor();
const textB = await rowB.innerText();
check(/Alice/.test(textB) && /shares 1 with you/.test(textB), `B's list: Alice shares 1 with you (${textB.replace(/\s+/g, ' ')})`);
check((await b.locator('[data-space] [data-chip]').filter({ hasText: 'from Alice' }).count()) === 1, 'B: the row carries a "from Alice" chip');
await goto(b, `#/settings/space/${spaceP}`);
const ownerRow = b.locator(`.share-members li[data-member="${fpA}"]`);
await ownerRow.waitFor();
check(/owner/.test(await ownerRow.innerText()) && (await b.getByRole('button', { name: 'Leave…' }).count()) === 1 && (await b.getByRole('button', { name: /^\+ Share Personal/ }).count()) === 0, "B's space page: Alice (owner), Leave…, no way to add");

// The account page: full fingerprint, rename.
await goto(a, '#/settings');
const openAcct = async (p, fp) => {
  const head = p.locator(`.st-accounts li[data-account="${fp}"] .st-row-head`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
};
await openAcct(a, fpB);
await a.locator('[data-account-fingerprint]').waitFor();
check((await a.locator(`.st-accounts li[data-account="${fpB}"] .st-row-head`).getAttribute('aria-expanded')) === 'true', 'the row opens the account in place');
const fullFp = (await a.locator('[data-account-fingerprint]').innerText()).replace(/\s+/g, '');
check(fullFp === fpB, 'the row shows the full fingerprint');
await a.getByLabel('Your name for this account').fill('Bobby');
await a.getByRole('button', { name: 'Rename', exact: true }).click();
await a.locator(`.st-accounts li[data-account="${fpB}"] .st-row-title`, { hasText: 'Bobby' }).waitFor();
await goto(a, '#/settings');
check((await a.locator(`.st-accounts li[data-account="${fpB}"]`).innerText()).includes('Bobby'), 'the list shows your name for the account');
await openAcct(a, fpB);
await a.getByRole('heading', { name: 'You share with Bobby' }).waitFor();
check((await a.getByRole('heading', { name: 'You share with Bobby' }).count()) === 1 && (await a.locator(`[data-shared-space="${spaceP}"]`).count()) === 1, 'the page lists Personal under "You share with Bobby"');
await b.locator('a[href="#/settings"]').first().click().catch(() => {});
await goto(b, `#/settings/account/${fpA}`);
await b.getByRole('heading', { name: 'Alice shares with you' }).waitFor();
check((await b.getByRole('button', { name: 'Leave Personal' }).count()) === 1, 'B: the account page offers Leave for Personal');

// Sharing another space from the account page; C asks instead of B.
await a.getByRole('button', { name: '+ Share another space' }).click();
const d = dlg(a);
await d.waitFor();
const options = await d.locator('select[aria-label="Space to share"] option').allInnerTexts().catch(() => []);
check(options.length === 0 && (await d.getByRole('heading', { name: 'Work' }).count()) === 1, `the sheet offers only Work, not the space already shared (${options.join(',')})`);
await d.getByRole('button', { name: 'Make a link' }).click();
const link2 = (await d.locator('[data-share-url]').innerText({ timeout: 30000 })).trim();
const c = await mk('C', '#/settings');
const codeC = await ask(c, link2.split('#/share/')[1], 'Carol', PASS_C);
const codeAC = (await d.locator('.invite-requests [data-compare]').innerText({ timeout: 40000 })).trim();
check(codeAC === codeC, 'C sees the same code');
await d.locator('[data-account-differs]').waitFor();
check(/not Bobby/.test(await d.locator('[data-account-differs]').innerText()), 'a different account asking is called out plainly');
await d.locator('.invite-requests').getByRole('button', { name: 'Decline' }).click();
await d.getByRole('button', { name: 'Cancel link' }).click();
await d.getByRole('button', { name: '+ Share Work with an account' }).click();
await d.getByRole('button', { name: 'Make a link' }).click();
const link3 = (await d.locator('[data-share-url]').innerText({ timeout: 30000 })).trim();
const codeB2 = await ask(b, link3.split('#/share/')[1], 'Bob', PASS_B);
const codeA2 = (await d.locator('.invite-requests [data-compare]').innerText({ timeout: 40000 })).trim();
check(codeA2 === codeB2, 'B asks again for Work and sees the same code');
check((await d.locator('[data-account-match]').count()) === 1, 'the fingerprint matches the account page');
await b.getByRole('button', { name: 'The codes match' }).click();
await d.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await b.locator('[data-share-done]').waitFor({ timeout: 40000 });
ok('B joined Work from the account page');
await a.keyboard.press('Escape');
await a.locator(`[data-shared-space="${spaceW}"]`).waitFor({ timeout: 30000 });
check((await a.locator('[data-shared-space]').count()) === 2, 'the account page now lists both spaces');
check((await a.getByRole('button', { name: '+ Share another space' }).count()) === 0, 'nothing is left to share with Bobby');

// End Work on A; B leaves Personal.
await a.getByRole('button', { name: 'End Work share with Bobby' }).click();
await a.getByRole('button', { name: 'End share', exact: true }).click();
await a.locator(`[data-shared-space="${spaceW}"]`).waitFor({ state: 'detached', timeout: 30000 });
check((await a.locator('[data-shared-space]').count()) === 1, 'ending Work removes it from the list');
await goto(b, `#/settings/account/${fpA}`);
await b.getByRole('button', { name: 'Leave Personal' }).click();
await b.getByRole('button', { name: 'Leave', exact: true }).click();
await until(async () => (await hook(b, (s) => window.__app.shareView(s), spaceP)) === undefined, 20000);
await goto(b, '#/settings');
check((await b.locator('.st-accounts li[data-account]').filter({ hasText: /you share|shares \d with you/ }).count()) <= 1, 'B still lists Alice only for what remains');
await finish(browser);
