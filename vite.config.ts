import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';
import { APP_NAME } from './src/constants';
import { licensesPlugin } from './src/licenses/build-plugin';
import { offlinePlugin, type OfflineMode } from './src/offline/build-plugin';

// Offline support (docs/offline.md): 'on' builds the service worker into dist/sw.js; 'off' ships
// the kill switch instead and the app stops registering. Switch off with APP_OFFLINE=off at build
// time, or by changing this line.
const OFFLINE: OfflineMode = process.env.APP_OFFLINE === 'off' ? 'off' : 'on';

// Plain static output in dist/ for Cloudflare (build command: npm run build, output: dist).
// Pages: the app (index.html), the capability probe (probe.html).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// package.json keeps 0.0.0 (nothing is published as a package), so the version shown is the build: its date and git commit.
function buildVersion(): string {
  if (pkg.version !== '0.0.0') return pkg.version;
  let sha = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // no git (a source archive): the date alone
  }
  return `${new Date().toISOString().slice(0, 10)}${sha ? ` (${sha})` : ''}`;
}

export default defineConfig({
  define: { __TEST_BUILD__: JSON.stringify(process.env.YAK_TEST_BUILD === '1'), __APP_VERSION__: JSON.stringify(buildVersion()), __OFFLINE_MODE__: JSON.stringify(OFFLINE) },
  base: './',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  plugins: [licensesPlugin(APP_NAME), offlinePlugin(OFFLINE)],
  build: {
    outDir: 'dist',
    target: 'es2022',
    // SVGs stay files (never data: URIs), so favicons are same-origin and precached for offline use.
    assetsInlineLimit: (file) => (file.endsWith('.svg') ? false : undefined),
    rollupOptions: { input: { main: 'index.html', probe: 'probe.html' } },
  },
  // Other git worktrees live under .claude/worktrees; never run their tests from this checkout.
  // A busy machine (several sessions, a browser suite) starves isolated workers: cap them and allow slow runs.
  test: { exclude: [...configDefaults.exclude, '.claude/**', 'dist/**'], maxWorkers: 4, testTimeout: 30_000, hookTimeout: 30_000 },
});
