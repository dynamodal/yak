// Runs the real-Obsidian suites (wdio.conf.mjs) from the repo root:
//
//   npm run e2e:obsidian-app                 # build dist/ (test build) when stale and the plugin, then test
//   npm run e2e:obsidian-app -- --no-build   # use dist/ and obsidian/dist/ as they are (CI builds them first)
//   OBSIDIAN_VERSIONS=latest npm run e2e:obsidian-app   # one version instead of the minimum and latest
//
// Installs this folder's own dependencies on first use (npm ci). On Linux without a display it runs under
// xvfb-run when that is installed.
import { spawnSync } from 'node:child_process';
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
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const xvfb = headless && spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error === undefined;
if (headless && !xvfb) console.warn('No display and no xvfb-run: Obsidian may not start.');
const [cmd, ...argv] = xvfb ? ['xvfb-run', '--auto-servernum', '--server-args=-screen 0 1280x1024x24', ...wdio] : wdio;
run(cmd, argv, here);
