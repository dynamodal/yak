// End-to-end: sharing a space between two accounts (#259, S-259). Account A has two devices, account B
// one; both require device keys. A shares its Personal space with B through a one-time link and a
// compared code. They edit it both ways; A's private part, the logs and the account documents never
// cross. A removes A2 (B stops counting it), the owner ends the share (no change crosses, both keep
// their data), a deleted `end:` record re-admits nobody, a new link brings B back, and B leaves.
//
//   npm run e2e sharing
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, sleep, startSyncing, joinByInvite } from './lib.mjs';

const PASS_A = 'e2e passphrase for sharing A';
const PASS_B = 'e2e passphrase for sharing B';
const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const hook = (p, f, arg) => p.evaluate(f, arg);
const keys = (p) => hook(p, () => window.__app.keys());
const accountId = (p) => hook(p, () => window.__app.accountId());
const idOf = (p) => hook(p, () => window.__app.deviceId());
const append = (p, id, s) => hook(p, ([i, x]) => window.__app.append(i, 't', x), [id, s]);
const text = (p, id) => hook(p, (i) => window.__app.text(i, 't'), id);
const view = (p, space) => hook(p, (s) => window.__app.shareView(s), space);
/** On a failed wait, print what each device's share mesh and log say (the hang in #30 shows only on a loaded CI runner). */
const dump = async (why) => {
  for (const [name, p] of [['A1', a1], ['B1', b1]]) {
    console.log(`--- ${why}: ${name} view ${JSON.stringify(await view(p, spaceS))}`);
    console.log(await hook(p, (s) => window.__app.shareDebug(s), spaceS).catch((e) => `no log: ${e.message}`));
  }
};
const unlock = (p, pass) => until(async () => (await hook(p, (x) => window.__app.unlock(x), pass)) === 'ok', 30000);

// Account A: two devices. Account B: one device.
const a1 = await mk('A1');
// Starting with a passphrase requires device keys from the first device on.
await startSyncing(a1, PASS_A);
const accountA = await accountId(a1);
const a2 = await mk('A2');
await joinByInvite(a1, a2, { pass: PASS_A });
const [idA1, idA2] = [await idOf(a1), await idOf(a2)];
(await until(async () => (await accountId(a2)) === accountA, 30000)) >= 0 ? ok('A2 joined account A') : fail('A2 did not join');
(await until(async () => (await keys(a2)).required && (await keys(a2)).certified, 40000)) >= 0 ? ok('A2 is approved') : fail('A2 not approved');

const b1 = await mk('B1');
await startSyncing(b1, PASS_B);
const accountB = await accountId(b1);
const idB1 = await idOf(b1);
(await until(async () => (await keys(b1)).required && (await keys(b1)).certified, 40000)) >= 0 ? ok('B1 requires keys') : fail('B1 keys not required');
check(accountA !== accountB, 'two separate accounts');

const spaceS = await hook(a1, () => window.__app.spaces().personal);
const docS = `space/${spaceS}`;
const fpA = await hook(a1, () => window.__app.accountFp());
const fpB = await hook(b1, () => window.__app.accountFp());

// Private data and a note of each side before sharing.
await hook(a1, (id) => window.__app.append(id, 't', 'A-private'), `${docS}/private`);
await hook(b1, () => window.__app.append('space/personal/time', 't', 'B-private'));
await append(a1, docS, 'A-before ');

// The owner makes a link; B opens it; both compare a code; B confirms; A approves.
await unlock(a1, PASS_A);
const link = await hook(a1, () => window.__app.shareOpen('personal', 'Alice'));
check(!!link, 'A makes a share link');
await hook(b1, ([c, n]) => window.__app.shareAsk(c, n), [link, 'Bob']);
(await until(async () => (await hook(b1, () => window.__app.shareJoin()))?.phase === 'compare' && ((await hook(a1, () => window.__app.shareHost()))?.requests.length ?? 0) > 0, 40000)) >= 0 ? ok('both screens show a code') : fail('no code shown');
await a1.evaluate(() => { location.hash = '#/settings'; });
check((await until(async () => /Bob asks to join/.test(await a1.locator('[data-share-request]').innerText().catch(() => '')), 10000)) >= 0, 'Settings shows "Bob asks to join · Review" on the space row');
const codeB = (await hook(b1, () => window.__app.shareJoin())).compare;
const reqA = (await hook(a1, () => window.__app.shareHost())).requests[0];
check(codeB === reqA.compare, `the codes match (${codeB})`);
await hook(b1, () => window.__app.shareConfirm());
await hook(a1, (id) => window.__app.shareApprove(id), reqA.id);
(await until(async () => (await hook(b1, () => window.__app.shareJoin()))?.phase === 'done', 40000)) >= 0 ? ok('B joined the shared space') : fail(`B join ${JSON.stringify(await hook(b1, () => window.__app.shareJoin()))}`);
(await until(async () => (await view(b1, spaceS))?.active && (await view(a1, spaceS))?.members.includes(fpB), 30000)) >= 0 ? ok('B and A both list B as a member') : fail(`views ${JSON.stringify([await view(a1, spaceS), await view(b1, spaceS)])}`);

// Edit it both ways.
(await until(async () => ((await text(b1, docS)) ?? '').includes('A-before'), 60000)) >= 0 ? ok('B receives what A wrote before sharing') : (fail('B has nothing of A'), await dump('first sync'));
await append(b1, docS, 'B-edit ');
(await until(async () => ((await text(a1, docS)) ?? '').includes('B-edit') && ((await text(a2, docS)) ?? '').includes('B-edit'), 60000)) >= 0 ? ok("B's edit reaches both of A's devices") : fail('B edit did not arrive');
await append(a2, docS, 'A2-edit ');
(await until(async () => ((await text(b1, docS)) ?? '').includes('A2-edit'), 60000)) >= 0 ? ok("A's edit reaches B") : fail('A edit did not arrive');

// Nothing else crosses.
check(!((await text(b1, `${docS}/private`)) ?? '').includes('A-private'), "A's private part is not on B");
check((await hook(b1, (i) => window.__app.json(i, 'spaces'), `account/${accountA}`)) === undefined, "A's account document is not on B");
check((await hook(a1, (i) => window.__app.json(i, 'spaces'), `account/${accountB}`)) === undefined, "B's account document is not on A");
check((await hook(a1, () => window.__app.text('space/personal/time', 't'))) === 'A-private', "A's private part is intact");
check(!(await hook(a1, () => window.__app.docs())).some((d) => d === `account/${accountB}` || d === `account/${accountB}/log`), 'A holds no document of B\'s account');

// A folder removed on one side is removed on the other (folders hold plain true/false values).
await hook(a1, ([i]) => window.__app.mapSet(i, 'folders', 'Shared', true), [docS]);
(await until(async () => (await hook(b1, (i) => window.__app.json(i, 'folders'), docS))?.Shared === true, 40000)) >= 0 ? ok('a folder reaches B') : fail('folder missing on B');
await hook(b1, ([i]) => window.__app.mapSet(i, 'folders', 'Shared', false), [docS]);
(await until(async () => (await hook(a2, (i) => window.__app.json(i, 'folders'), docS))?.Shared === false, 40000)) >= 0 ? ok("B's delete reaches A's devices") : fail('delete did not cross');

// A removes A2 in its own account: B stops counting it.
(await until(async () => (await view(b1, spaceS)).devices.includes(idA2), 40000)) >= 0 ? ok('B counts A2 as a device of the share') : fail(`B devices ${JSON.stringify((await view(b1, spaceS)).devices)}`);
await hook(a1, (id) => window.__app.removeDevice(id), idA2);
(await until(async () => !(await view(b1, spaceS)).devices.includes(idA2), 60000)) >= 0 ? ok('B no longer counts the removed A2') : fail('B still counts A2');
check((await view(b1, spaceS)).devices.includes(idA1), 'B still counts A1');

// The owner ends the share.
await unlock(a1, PASS_A);
await hook(a1, ([s, f]) => window.__app.shareEnd(s, f), [spaceS, fpB]);
// B learns of the end only if its link was still open when A wrote it; otherwise it just finds no peers (S-259e).
(await until(async () => (await view(b1, spaceS))?.active === false, 20000)) >= 0 ? ok('B sees the share ended') : ok('B did not see the end (its link closed first); it only gets no more changes');
check(!(await view(a1, spaceS)).members.includes(fpB), 'A no longer lists B as a member');
await append(a1, docS, 'A-after-end ');
await append(b1, docS, 'B-after-end ');
await sleep(12000);
check(!((await text(b1, docS)) ?? '').includes('A-after-end'), 'B gets no change after the end');
check(!((await text(a1, docS)) ?? '').includes('B-after-end'), 'A gets no change from B after the end');
check(((await text(b1, docS)) ?? '').includes('A2-edit') && ((await text(a1, docS)) ?? '').includes('B-edit'), 'both keep what they had');

// Deleting the end record re-admits nobody (A1 pinned it).
await hook(a1, ([i, f]) => window.__app.mapDelete(i, 'share', `end:${f}:1`), [docS, fpB]);
await append(a1, docS, 'A-after-delete ');
await sleep(10000);
check(!(await view(a1, spaceS)).members.includes(fpB), 'a deleted end record re-admits nobody');
check(!((await text(b1, docS)) ?? '').includes('A-after-delete'), 'and nothing crosses');

// A new link brings B back.
await unlock(a1, PASS_A);
const link2 = await hook(a1, () => window.__app.shareOpen('personal', 'Alice'));
await hook(b1, ([c, n]) => window.__app.shareAsk(c, n), [link2, 'Bob']);
(await until(async () => (await hook(b1, () => window.__app.shareJoin()))?.phase === 'compare' && ((await hook(a1, () => window.__app.shareHost()))?.requests.length ?? 0) > 0, 40000)) >= 0 ? ok('a new link shows a code again') : fail('no code on the new link');
await hook(b1, () => window.__app.shareConfirm());
await hook(a1, async () => window.__app.shareApprove((await window.__app.shareHost()).requests[0].id));
(await until(async () => (await hook(b1, () => window.__app.shareJoin()))?.phase === 'done', 40000)) >= 0 ? ok('B is back in the share') : fail(`B rejoin ${JSON.stringify(await hook(b1, () => window.__app.shareJoin()))}`);
(await until(async () => ((await text(b1, docS)) ?? '').includes('A-after-delete'), 60000)) >= 0 ? ok('B catches up with what it missed') : (fail('B did not catch up'), await dump('catch up'));
await append(b1, docS, 'B-readded ');
(await until(async () => ((await text(a1, docS)) ?? '').includes('B-readded'), 60000)) >= 0 ? ok("and B's edits reach A again") : fail('B edit did not arrive');

// A file added to the shared space reaches the member over a direct link (#272).
await hook(a1, ([i]) => window.__app.addFile(i, 'shared.txt', 'hello member'), [docS]);
(await until(async () => (await hook(b1, (i) => window.__app.fileBytes(i), docS)) > 0, 60000)) >= 0 ? ok("A's file reaches B's store") : fail('B did not fetch the shared file');

// B leaves: no record, nothing more crosses.
await hook(b1, (s) => window.__app.shareLeave(s), spaceS);
check((await view(b1, spaceS)) === undefined, 'B no longer treats the space as a share');
await append(a1, docS, 'A-after-leave ');
await sleep(10000);
check(!((await text(b1, docS)) ?? '').includes('A-after-leave'), 'after B left nothing more reaches it');
check(((await text(b1, docS)) ?? '').includes('B-readded'), 'B keeps the space as its own');

await finish(browser);
