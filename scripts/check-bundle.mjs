// Bundle budget (#210): fails when the first-load JavaScript or CSS of dist/ grows past the limit.
// The budget has headroom of about 5%; raise it in this file, with a reason in the PR, when a feature needs it.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = { 'main-*.js': { raw: 870, gzip: 285 }, 'main-*.css': { raw: 76, gzip: 15 } };
const files = readdirSync('dist/assets');
let failed = false;
for (const [pattern, limit] of Object.entries(BUDGET)) {
  const re = new RegExp(`^${pattern.replace('.', '\\.').replace('*', '.+')}$`);
  const name = files.find((f) => re.test(f));
  if (!name) throw new Error(`no ${pattern} in dist/assets: run npm run build first`);
  const data = readFileSync(`dist/assets/${name}`);
  const raw = data.length / 1000;
  const gz = gzipSync(data).length / 1000;
  const ok = raw <= limit.raw && gz <= limit.gzip;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name}: ${raw.toFixed(1)} kB (budget ${limit.raw}), gzip ${gz.toFixed(1)} kB (budget ${limit.gzip})`);
}
if (failed) process.exit(1);
