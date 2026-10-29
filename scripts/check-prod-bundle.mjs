// The production bundle holds none of the test-build hooks. Builds the app the normal way (no YAK_TEST_BUILD)
// into a temporary directory and fails when a marker that only a test build may contain is in any of its files.
// Markers: the timer-scale flag (src/core/test-build.ts scaledMs) and test hooks that are named properties.
// Needs no dist/ and leaves dist/ alone. `npm run check:prod-bundle`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARKERS = ['__yakTimerScale', 'fakeStatus', 'startKeyless'];
const out = mkdtempSync(join(tmpdir(), 'yak-prod-'));
try {
  const env = { ...process.env };
  delete env.YAK_TEST_BUILD;
  const r = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('production build failed');
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  const code = files(out).filter((f) => /\.(js|html|css)$/.test(f));
  const found = code.flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    return MARKERS.filter((m) => text.includes(m)).map((m) => `${m} in ${f.slice(out.length + 1)}`);
  });
  if (!code.length) throw new Error('no files in the production build');
  if (found.length) throw new Error(`test hooks in the production bundle: ${found.join(', ')}`);
  console.log(`ok   production bundle (${code.length} files) has none of: ${MARKERS.join(', ')}`);
} catch (e) {
  console.error(`FAIL ${e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
