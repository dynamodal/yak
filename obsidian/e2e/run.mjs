// Runs the real-Obsidian suites (wdio.conf.mjs) from the repo root:
//
//   npm run e2e:obsidian-app                 # build dist/ (test build) when stale and the plugin, then test
//   npm run e2e:obsidian-app -- --no-build   # use dist/ and obsidian/dist/ as they are (CI builds them first)
//   OBSIDIAN_VERSIONS="1.14.5 latest" npm run e2e:obsidian-app   # other versions (space separated, app[/installer])
//   npm run e2e:obsidian-app -- --show       # open Obsidian's windows on the desktop, to watch or debug
//   YAK_XVFB=/path/to/xvfb npm run e2e:obsidian-app   # an Xvfb not on PATH (any command taking Xvfb's arguments)
//
// Installs this folder's own dependencies on first use (npm ci). Obsidian runs on a virtual display (Xvfb, started
// here, WAYLAND_DISPLAY unset), so no window opens on the desktop or takes its focus; without Xvfb it refuses to run.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const args = process.argv.slice(2);

const run = (cmd, argv, cwd, env = process.env) => {
  const r = spawnSync(cmd, argv, { cwd, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!args.includes('--no-build')) {
  run(process.execPath, [join(root, 'scripts', 'e2e', 'run.mjs'), '--build-only'], root);
  run('npm', ['run', 'build:obsidian'], root);
}
if (!existsSync(join(root, 'dist', 'index.html')) || !existsSync(join(root, 'obsidian', 'dist', 'main.js'))) {
  console.error('dist/ or obsidian/dist/ is missing: drop --no-build');
  process.exit(2);
}
if (!existsSync(join(here, 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund'], here);

const wdio = [join(here, 'node_modules', '.bin', 'wdio'), 'run', join(here, 'wdio.conf.mjs')];
if (args.includes('--show')) {
  run(wdio[0], wdio.slice(1), here);
} else {
  const { display, stop } = await virtualDisplay();
  // Only the virtual display: without WAYLAND_DISPLAY, Electron cannot reach the desktop either.
  const env = { ...process.env, DISPLAY: display };
  delete env.WAYLAND_DISPLAY;
  const r = spawnSync(wdio[0], wdio.slice(1), { cwd: here, stdio: 'inherit', env });
  stop();
  process.exit(r.status ?? 1);
}

/** Start Xvfb on a free display number (it reports the number on fd 3). */
async function virtualDisplay() {
  const xvfb = process.env.YAK_XVFB || (spawnSync('sh', ['-c', 'command -v Xvfb'], { encoding: 'utf8' }).stdout.trim());
  if (!xvfb) {
    console.error('No Xvfb: install it (apt install xvfb, dnf install xorg-x11-server-Xvfb) or set YAK_XVFB to a command that runs it.\nThe suite never opens windows on the desktop unless you pass --show.');
    process.exit(2);
  }
  const server = spawn(xvfb, ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let err = '';
  server.stderr.on('data', (d) => (err += d));
  const number = await new Promise((resolve, reject) => {
    let out = '';
    server.stdio[3].on('data', (d) => {
      out += d;
      if (out.includes('\n')) resolve(out.trim());
    });
    server.once('exit', (code) => reject(new Error(`Xvfb exited (${code}):\n${err.slice(-2000)}`)));
    setTimeout(() => reject(new Error(`Xvfb did not start:\n${err.slice(-2000)}`)), 15000);
  });
  return { display: `:${number}`, stop: () => server.kill() };
}
