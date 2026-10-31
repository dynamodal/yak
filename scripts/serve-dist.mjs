// Serve dist/ the way Cloudflare static assets does, including the headers in dist/_headers
// (so the real Content-Security-Policy is enforced) and extensionless .html paths (/probe).
//
//   node scripts/serve-dist.mjs 4190    # port 0 picks a free one; the "serving dist on" line names it
//
// DIST_DIR serves another copy of the build (the offline suite rewrites its sw.js).
//
// EXTRA_CONNECT="http://127.0.0.1:8795" adds origins to connect-src, for local test servers
// such as scripts/mock-ntfy.mjs. Everything else in the policy stays as deployed.
//
// SITE_RELAY=1 answers WebSocket upgrades on /signal/* with scripts/mock-relay.mjs, as the Worker
// does on the real site, so the default signaling server (this site's relay) works locally.
//
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { extname, join, normalize } from 'node:path';

const root = process.env.DIST_DIR || join(process.cwd(), 'dist');
const port = Number(process.argv[2] ?? 4190);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

async function headerRules() {
  try {
    const text = await readFile(join(root, '_headers'), 'utf8');
    const rules = [];
    let current;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (!/^\s/.test(line)) {
        current = { pattern: line.trim(), headers: [] };
        rules.push(current);
      } else if (current && line.trim().startsWith('!')) {
        current.headers.push([line.trim().slice(1).trim(), undefined]);
      } else if (current) {
        const i = line.indexOf(':');
        current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
      }
    }
    return rules;
  } catch {
    return [];
  }
}

function matches(pattern, path) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(path);
}

async function resolve(path) {
  const candidates = path.endsWith('/') ? [path + 'index.html'] : [path, path + '.html'];
  for (const c of candidates) {
    const file = normalize(join(root, c));
    if (!file.startsWith(root)) return undefined;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

const rules = await headerRules();
const relay = process.env.SITE_RELAY ? await (await import('./mock-relay.mjs')).startMockRelay() : undefined;
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (relay && path.startsWith('/signal/')) {
    // Plain requests (the stats) go to the mock relay too.
    // Only the parsed path and query are forwarded, so an absolute or `//host` request URL cannot pick the host.
    const { pathname, search } = new URL(req.url ?? '/', 'http://x');
    const target = new URL(relay.httpUrl);
    target.pathname = pathname;
    target.search = search;
    // The admin key of the operator pages (#109) is the one header passed on.
    const upstream = await fetch(target, { headers: req.headers.authorization ? { authorization: req.headers.authorization } : {} }).catch(() => undefined);
    res.writeHead(upstream?.status ?? 502, { 'content-type': upstream?.headers.get('content-type') ?? 'text/plain' });
    res.end(upstream ? await upstream.text() : 'bad gateway');
    return;
  }
  const file = await resolve(path);
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    for (const [k, v] of r.headers) {
      if (v === undefined) {
        res.removeHeader(k);
        continue;
      }
      const extra = process.env.EXTRA_CONNECT;
      res.setHeader(k, extra && k.toLowerCase() === 'content-security-policy' ? v.replace('connect-src', `connect-src ${extra}`) : v);
    }
  }
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(await readFile(file));
});
server.on('upgrade', (req, socket, head) => {
  if (!relay || !(req.url ?? '').startsWith('/signal/')) return socket.destroy();
  // Pass the upgrade through to the mock relay byte for byte.
  const upstream = connect(Number(new URL(relay.httpUrl).port), '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(port, '127.0.0.1', () => console.log(`serving dist on http://127.0.0.1:${server.address().port}${relay ? ' with a relay at /signal' : ''}`));
