// End-to-end: the QR code shown with "Make a one-time code" decodes back to that code, and a second
// browser whose fake camera films that QR code joins by scanning it (then compares codes and the first approves). Runs against dist/
// served with the real CSP, so a CSP violation or page error fails the run.
//
//   npm run e2e qr
//
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { BASE, launch, startMock, ok, fail, check, watchPage, until, finish, keepAllSpaces, openJoin, startSyncing, unlockIfAsked } from './lib.mjs';

const mock = await startMock();
const dir = await mkdtemp(join(tmpdir(), 'qr-e2e-'));

async function open(browser, name, permissions, viewport = { width: 900, height: 900 }) {
  const page = await (await browser.newContext({ permissions, viewport })).newPage();
  watchPage(page, name);
  await page.goto(BASE + '?test#/devices');
  await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
  await page.locator('input[aria-label="Connection server"]').fill(mock.url);
  return page;
}

// Rasterise the QR svg to RGBA in the page (img-src allows data:), return pixels.
async function qrPixels(page, side) {
  return page.evaluate(async (side) => {
    const svg = new XMLSerializer().serializeToString(document.querySelector('svg.qr-code'));
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = side;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, 0, 0, side, side);
    return Array.from(ctx.getImageData(0, 0, side, side).data);
  }, side);
}

function writeY4m(path, rgba, side, frames) {
  const W = 640, H = 480;
  const y = Buffer.alloc(W * H, 255), u = Buffer.alloc((W / 2) * (H / 2), 128), v = Buffer.alloc((W / 2) * (H / 2), 128);
  const x0 = (W - side) / 2, y0 = (H - side) / 2;
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) y[(y0 + j) * W + x0 + i] = rgba[(j * side + i) * 4] < 128 ? 16 : 235;
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  const parts = [header];
  for (let f = 0; f < frames; f++) parts.push(Buffer.from('FRAME\n'), y, u, v);
  return writeFile(path, Buffer.concat(parts));
}

// Part 1: A shows the QR code; decode it in Node.
const browserA = await launch();
const a = await open(browserA, 'A', []);
check((await a.locator('svg.qr-code').count()) === 0, 'no QR code before a pairing is started');
await startSyncing(a);
check((await a.locator('svg.qr-code').count()) === 0, 'and none until a one-time code is made');
await a.getByRole('button', { name: 'Make a one-time code' }).click();
await a.locator('svg.qr-code').waitFor();
const secret = (await a.locator('[data-invite-code]').innerText()).trim();
const side = 400;
const px = await qrPixels(a, side);
const decoded = jsQR(Uint8ClampedArray.from(px), side, side);
check(!!decoded, 'QR code decodes in Node');
const norm = secret.replace(/-/g, '');
check(decoded?.data.startsWith('yak:pair?v=1&s=' + norm) ?? false, 'QR payload carries the displayed one-time code');
check((decoded?.data ?? '').includes('sig='), 'QR payload names the non-default signaling server');
check((await a.locator('[style]').count()) === 0, 'no inline style attributes in the page');
// One-time code option A+ (#22): QR and link first, the code in groups of four below with a copy button; Send link only where the browser can share.
check(/^([A-Z2-7]{4}-){6}[A-Z2-7]{4}$/.test(secret), 'the one-time code is shown in groups of four');
check((await a.getByRole('button', { name: 'Copy link' }).count()) === 1 && (await a.getByRole('button', { name: 'Copy code' }).count()) === 1, 'it offers Copy link and Copy code');
const canShare = await a.evaluate(() => typeof navigator.share === 'function');
check((await a.getByRole('button', { name: 'Send link' }).count()) === (canShare ? 1 : 0), `Send link is offered only where the browser has a share sheet (${canShare ? 'it has' : 'it has none'})`);
const [qrBox, codeBox] = await Promise.all([a.locator('svg.qr-code').boundingBox(), a.locator('[data-invite-code]').boundingBox()]);
check(qrBox && codeBox && qrBox.y < codeBox.y, 'the QR code comes before the typed code');

// Part 2: B scans it with a fake camera.
const file = join(dir, 'qr.y4m');
await writeY4m(file, px, side, 20);
const browserB = await launch({ fakeCamera: true, args: [`--use-file-for-fake-video-capture=${file}`] });
const b = await open(browserB, 'B', ['camera'], { width: 375, height: 700 });
// Scanning should set the signaling server too: blank it first to prove that.
await b.locator('input[aria-label="Connection server"]').fill('https://wrong.invalid');
await b.getByRole('button', { name: 'Scan a QR code' }).click();
const t = await until(async () => (await b.locator('input[aria-label="One-time code"]').inputValue()).replace(/-/g, '') === norm, 15000);
t >= 0 ? ok(`scanned the QR code in ${t} ms`) : fail('scan did not fill in the code');
check((await b.locator('video.qr-video').count()) === 0, 'camera preview closed after the scan');
check((await b.locator('input[aria-label="Connection server"]').inputValue()) === mock.url, 'scan filled in the signaling server');
// After a scan the primary join button is on screen and focused without scrolling.
const joinBtn = b.getByRole('button', { name: 'Join this account' });
await joinBtn.waitFor({ timeout: 5000 });
check((await b.getByText('Code found').count()) === 1, 'scan shows "Code found"');
check(await joinBtn.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'Join this account is visible at 375 px');
check(await joinBtn.evaluate((el) => el === document.activeElement), 'Join this account has focus');
// A pasted join link (or the QR text) fills the code field; a plain code is left as typed.
const field = b.locator('input[aria-label="One-time code"]');
await field.fill(`https://yak.example.com/#/join/${norm}`);
check((await field.inputValue()) === secret, 'a pasted join link fills the code field in groups');
await field.fill(`yak:pair?v=1&s=${norm}`);
check((await field.inputValue()) === secret, 'so does the text of the QR code');

// Joining compares codes, A approves, B confirms and reloads once.
const loaded = b.waitForEvent('load', { timeout: 60000 });
await joinBtn.click();
await b.locator('[data-join="compare"] code.compare-code').waitFor({ timeout: 30000 });
await a.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await unlockIfAsked(a);
await b.getByRole('button', { name: 'The codes match' }).click();
await loaded;
await keepAllSpaces(b);
await b.waitForFunction(() => window.__app);
const st = (p) => p.evaluate(() => window.__app.state());
const c = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
c >= 0 ? ok(`paired through the scanned code, connected in ${c} ms`) : fail('did not connect after scanning');

// Part 3: cancel and refusal paths.
const browserC = await launch({ args: ['--use-fake-device-for-media-stream'] });
const d = await open(browserC, 'D', []);
await d.getByRole('button', { name: 'Scan a QR code' }).click();
const msg = await d.getByRole('status').innerText().catch(() => '');
await d.getByText(/refused|No camera|Could not start/).first().waitFor({ timeout: 5000 }).catch(() => {});
check(/refused|No camera|Could not start/.test(await d.locator('.qr-scan').innerText()), `a camera failure is explained, not hung (headless without a granted permission) (${(await d.locator('.qr-scan').innerText()).replace(/\s+/g, ' ').slice(0, 80)})`);
void msg;
await b.close().catch(() => {});
const e = await open(browserB, 'E', ['camera']);
await e.getByRole('button', { name: 'Scan a QR code' }).click();
await e.locator('video.qr-video').waitFor();
await e.getByRole('button', { name: 'Cancel scanning' }).click();
check((await e.locator('video.qr-video').count()) === 0, 'cancel closes the camera preview');

await finish(browserA, browserB, browserC, mock);
