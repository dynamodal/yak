// Runs the browser suites in scripts/e2e/ against the built app, several at a time.
//
//   npm run e2e                  # every suite
//   npm run e2e app-pair time    # chosen suites (the .mjs is optional)
//   npm run e2e -- --no-build    # skip the staleness check and use dist/ as it is
//   E2E_BROWSER=webkit npm run e2e   # the same suites in Playwright's WebKit (local only; install: npx playwright-core install webkit)
//   npm run e2e -- --jobs 1      # one suite at a time (default: E2E_JOBS, else min(CPUs, 3))
//
// Builds first when dist/ is older than the sources. For each suite it starts
// scripts/serve-dist.mjs (SITE_RELAY=1, so /signal is a mock relay) on a port the server picks
// itself (port 0), reserves a free port for the mock ntfy a suite starts, passes both on as TARGET,
// MOCKPORT and EXTRA_CONNECT, prints one line per suite and a summary, and stops every process it
// started by PID. The offline suite rewrites dist/sw.js, so it gets its own copy of dist/ (DIST_DIR).
//
// It lowers its own priority (nice 10) unless YAK_TEST_NICE=0.
//
// A suite that fails is run once more. If the second run passes it is reported as flaky (and listed
// in the GitHub job summary) so a flake is visible, not hidden. A start-up collision on the mock
// port (EADDRINUSE) is retried without counting as a flake. Each run's full output is written to
// e2e-logs/<suite>.log.
//
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, setPriority, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, WEBKIT } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const suiteDir = join(root, 'scripts', 'e2e');
const SUITE_TIMEOUT_MS = 10 * 60 * 1000;

// Low priority, so a test run does not take over the machine; children inherit it. YAK_TEST_NICE=0 turns it off.
if (process.env.YAK_TEST_NICE !== '0') {
  try { setPriority(10); } catch { /* not allowed or not supported: run as is */ }
}

const args = process.argv.slice(2);
const jobsAt = args.indexOf('--jobs');
const jobs = Math.max(1, Number(jobsAt >= 0 ? args[jobsAt + 1] : process.env.E2E_JOBS) || Math.min(availableParallelism(), 3));
if (jobsAt >= 0) args.splice(jobsAt, 2);
const logDir = process.env.E2E_LOG_DIR || join(root, 'e2e-logs');
const build = !args.includes('--no-build');
const wanted = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\.mjs$/, ''));

const available = readdirSync(suiteDir)
  .filter((f) => f.endsWith('.mjs') && !['lib.mjs', 'run.mjs'].includes(f))
  .map((f) => f.slice(0, -4))
  .sort();
// Dev tools: run only when named (`npm run e2e ux-shots`), never in the full run.
const DEV_TOOLS = ['ux-shots'];
const unknown = wanted.filter((w) => !available.includes(w));
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(', ')}\nAvailable: ${available.join(', ')}`);
  process.exit(2);
}

// app-mesh runs twice: over the mock ntfy, and over the site relay (the relay keeps no history,
// which once caught a real bug).
const runs = (wanted.length ? wanted : available.filter((n) => !DEV_TOOLS.includes(n))).flatMap((name) =>
  name === 'app-mesh'
    ? [{ name, label: 'app-mesh' }, { name, label: 'app-mesh (relay)', env: (site) => ({ SIGNAL_URL: `ws://127.0.0.1:${site}/signal` }) }]
    : [{ name, label: name }],
);

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((f) => newestMtime(join(path, f))));
}

function ensureBuilt() {
  const built = newestMtime(join(root, 'dist', 'index.html'));
  const sources = ['src', 'public', 'worker', 'docs/user', 'index.html', 'probe.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];
  // Only a build with the test hooks (marker file) counts; a plain `npm run build` has none.
  const isTestBuild = existsSync(join(root, 'dist', '.test-build'));
  if (built && isTestBuild && sources.every((s) => newestMtime(join(root, s)) <= built)) return;
  console.log(built ? 'dist/ is older than the sources: building' : 'no dist/: building');
  const r = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, YAK_TEST_BUILD: '1' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeFileSync(join(root, 'dist', '.test-build'), 'built with YAK_TEST_BUILD=1\n');
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const children = new Set();
const stop = (child) => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
};
const stopAll = () => children.forEach(stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(130); });
process.on('exit', stopAll);

const exited = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve(child.exitCode) : child.once('exit', resolve)));

async function startServer(mock, distDir) {
  const server = spawn(process.execPath, [join(root, 'scripts', 'serve-dist.mjs'), '0'], {
    cwd: root,
    env: { ...process.env, SITE_RELAY: '1', EXTRA_CONNECT: `http://127.0.0.1:${mock}`, ...(distDir ? { DIST_DIR: distDir } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(server);
  let output = '';
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  const t0 = Date.now();
  let match;
  while (!(match = /serving dist on http:\/\/127\.0\.0\.1:(\d+)/.exec(output))) {
    if (server.exitCode !== null || Date.now() - t0 > 15000) {
      stop(server);
      children.delete(server);
      throw new Error(`serve-dist.mjs did not start:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { server, site: Number(match[1]) };
}

async function runSuite(run) {
  const mock = await freePort();
  const distDir = run.name === 'offline' ? mkdtempSync(join(tmpdir(), 'yak-dist-')) : undefined;
  if (distDir) cpSync(join(root, 'dist'), distDir, { recursive: true });
  const { server, site } = await startServer(mock, distDir);
  const t0 = Date.now();
  let output = '';
  let timedOut = false;
  const child = spawn(process.execPath, [join(suiteDir, `${run.name}.mjs`)], {
    cwd: root,
    env: { ...process.env, TARGET: `http://127.0.0.1:${site}/`, MOCKPORT: String(mock), ...(distDir ? { DIST_DIR: distDir } : {}), ...run.env?.(site) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const timer = setTimeout(() => { timedOut = true; stop(child); }, SUITE_TIMEOUT_MS);
  const code = await exited(child);
  clearTimeout(timer);
  stop(server);
  await exited(server);
  children.delete(child);
  children.delete(server);
  if (distDir) rmSync(distDir, { recursive: true, force: true });
  const lines = output.split('\n');
  return {
    run,
    passed: code === 0,
    timedOut,
    checks: lines.filter((l) => l.startsWith('ok  :')).length,
    seconds: (Date.now() - t0) / 1000,
    output,
    portClash: /EADDRINUSE/.test(output),
    detail: lines.filter((l) => l.startsWith('FAIL:')).join('\n') || lines.slice(-15).join('\n'),
  };
}

try {
  findChrome();
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (build) ensureBuilt();
else if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('No dist/: run `npm run build` or drop --no-build');
  process.exit(2);
}

mkdirSync(logDir, { recursive: true });

async function runWithRetry(run) {
  const log = join(logDir, `${run.label.replace(/\W+/g, '-')}.log`);
  writeFileSync(log, '');
  const attempts = [];
  let r;
  for (let n = 1; n <= 3; n++) {
    try {
      r = await runSuite(run);
    } catch (e) {
      r = { run, passed: false, timedOut: false, checks: 0, seconds: 0, output: String(e), portClash: /EADDRINUSE/.test(String(e)), detail: String(e) };
    }
    appendFileSync(log, `--- attempt ${n}: ${r.passed ? 'pass' : 'FAIL'} (${r.seconds.toFixed(1)} s)\n${r.output}\n`);
    attempts.push(r);
    // A port clash is infrastructure: try again. Any other failure gets one retry, then stands.
    if (r.passed || attempts.filter((a) => !a.portClash).length > 1) break;
  }
  return { ...r, flaky: r.passed && attempts.some((a) => !a.passed && !a.portClash), tries: attempts.length };
}

const results = [];
const queue = [...runs];
const report = (r) => {
  const verdict = r.passed ? (r.flaky ? 'FLAK' : 'PASS') : r.timedOut ? 'TIME' : 'FAIL';
  console.log(`${verdict}  ${r.run.label.padEnd(20)} ${String(r.checks).padStart(3)} checks  ${r.seconds.toFixed(1).padStart(5)} s`);
  if (!r.passed || r.flaky) console.log((r.flaky ? 'passed on a retry; see e2e-logs for the failed attempt' : r.detail).replace(/^/gm, '      '));
};
// Longest suites first so the last one to start does not decide the wall time.
queue.sort((x, y) => (x.name === 'offline' ? -1 : y.name === 'offline' ? 1 : 0));
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let run; (run = queue.shift()); ) {
      const r = await runWithRetry(run);
      results.push(r);
      report(r);
    }
  }),
);

const failed = results.filter((r) => !r.passed);
const flaky = results.filter((r) => r.flaky);
const checks = results.reduce((n, r) => n + r.checks, 0);
console.log(`\n${results.length - failed.length}/${results.length} suites passed, ${checks} checks${failed.length ? `; failed: ${failed.map((r) => r.run.label).join(', ')}` : ''}${flaky.length ? `; flaky: ${flaky.map((r) => r.run.label).join(', ')}` : ''}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = [...results].sort((x, y) => y.seconds - x.seconds).map((r) => `| ${r.run.label} | ${r.passed ? (r.flaky ? 'flaky' : 'pass') : 'FAIL'} | ${r.checks} | ${r.seconds.toFixed(1)} |`);
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Browser suites\n\n${flaky.length ? `**Flaky (passed only on a retry): ${flaky.map((r) => r.run.label).join(', ')}**\n\n` : ''}| Suite | Result | Checks | Seconds |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`,
  );
}
for (const r of flaky) console.log(`::warning::browser suite ${r.run.label} was flaky (passed on a retry)`);
process.exit(failed.length ? 1 : 0);
