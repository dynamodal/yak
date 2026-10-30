// End-to-end tests of the Yak Sync plugin in real Obsidian desktop (decision O-140 in docs/decisions/obsidian.md).
//
//   npm run e2e:obsidian-app                  # from the repo root: builds what is stale, then runs this
//   npm run e2e:obsidian-app -- --no-build    # use dist/ (a test build) and obsidian/dist/ as they are
//
// wdio-obsidian-service downloads Obsidian into obsidian/e2e/.obsidian-cache/ and runs each spec once per version:
// the plugin's minAppVersion (pinned in obsidian/manifest.json) and the latest public release. Each run opens a fresh
// copy of vault/ with the built plugin (obsidian/dist/) installed and enabled.
//
// onPrepare serves dist/ (a test build) with scripts/serve-dist.mjs and its mock relay, as `npm run e2e` does; the
// specs reach it through TARGET, and the app runs beside Obsidian in Playwright's Chromium (scripts/e2e/lib.mjs).
// Obsidian needs an X display: run.mjs gives it a virtual one (Xvfb), never the desktop's.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseObsidianVersions } from 'wdio-obsidian-service';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { minAppVersion } = JSON.parse(readFileSync(join(root, 'obsidian', 'manifest.json'), 'utf8'));
const cacheDir = resolve(here, '.obsidian-cache');
// The minimum the plugin supports and the latest public release; no beta builds (they need an Insiders account).
// Resolved to version numbers, so the run is not doubled while the latest release is the minimum.
const wanted = process.env.OBSIDIAN_VERSIONS ?? `${minAppVersion} latest`;
const versions = [...new Map(await parseObsidianVersions(wanted, { cacheDir })).entries()];

let server;

export const config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./specs/**/*.e2e.mjs'],
  // One Obsidian at a time: two Electron apps and a Chromium on a small runner make timing flaky.
  maxInstances: 1,
  capabilities: versions.map(([app, installer]) => ({
    browserName: 'obsidian',
    browserVersion: app,
    'wdio:obsidianOptions': {
      installerVersion: installer,
      plugins: [join(root, 'obsidian', 'dist')],
      vault: join(here, 'vault'),
    },
  })),
  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir,
  mochaOpts: { ui: 'bdd', timeout: 120_000, bail: true },
  waitforTimeout: 30_000,
  logLevel: 'warn',

  async onPrepare() {
    server = spawn(process.execPath, [join(root, 'scripts', 'serve-dist.mjs'), '0'], {
      cwd: root,
      env: { ...process.env, SITE_RELAY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stdout.on('data', (d) => (output += d));
    server.stderr.on('data', (d) => (output += d));
    const t0 = Date.now();
    let match;
    while (!(match = /serving dist on http:\/\/127\.0\.0\.1:(\d+)/.exec(output))) {
      if (server.exitCode !== null || Date.now() - t0 > 15_000) throw new Error(`serve-dist.mjs did not start:\n${output}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    // Workers start after this and inherit the environment.
    process.env.TARGET = `http://127.0.0.1:${match[1]}/`;
  },

  onComplete() {
    server?.kill();
  },
};
