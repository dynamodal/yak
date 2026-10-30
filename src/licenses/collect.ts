/**
 * Open-source credits: which packages a bundle ships, their licence text, and whether we may ship them.
 * Pure helpers; the Vite plugin (`build-plugin.ts`) feeds them the modules Rollup actually bundled,
 * so the list matches the shipped code, not the dependency tree on disk.
 */

export interface LicenseEntry {
  name: string;
  version: string;
  /** SPDX expression from package.json, for example `MIT`. */
  license: string;
  author: string;
  homepage: string;
  /** The package's LICENSE file, verbatim. */
  text: string;
  /** Its NOTICE file, when it has one (Apache-2.0 asks us to pass it on). */
  notice: string;
}

/** Licences we ship without asking. A new one needs an owner decision row (docs/decisions/app.md). */
export const ALLOWED_LICENSES: readonly string[] = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];

/** The package a bundled module belongs to: its name and directory, or null for our own and virtual modules. */
export function packageOf(moduleId: string): { name: string; dir: string } | null {
  const id = moduleId.split('?')[0] ?? '';
  if (id.startsWith('\0')) return null;
  const marker = '/node_modules/';
  const at = id.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = id.slice(at + marker.length).split('/');
  const name = rest[0]?.startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
  if (!name) return null;
  return { name, dir: id.slice(0, at + marker.length) + name };
}

/** `Name <mail> (url)` becomes `Name`; an object author uses its name. */
export function authorName(author: unknown): string {
  const raw = typeof author === 'string' ? author : author && typeof author === 'object' ? String((author as { name?: unknown }).name ?? '') : '';
  return stripUntilStable(raw, /<[^<>]*>|\([^()]*\)/g)
    .replace(/[<>]/g, '')
    .trim();
}

/** Strips `re` repeatedly, so nested input like `a<<b>c>` leaves no partial tag behind. */
function stripUntilStable(text: string, re: RegExp): string {
  let prev: string;
  let out = text;
  do {
    prev = out;
    out = out.replace(re, '');
  } while (out !== prev);
  return out;
}

/** The licence of a package.json: the `license` field, or the legacy `licenses` array. */
export function licenseOf(pkg: { license?: unknown; licenses?: unknown }): string {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object') return String((pkg.license as { type?: unknown }).type ?? '');
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => String((l as { type?: unknown }).type ?? '')).filter(Boolean).join(' OR ');
  return '';
}

/**
 * Whether an SPDX expression is covered by the allow list. `A OR B` needs one allowed side, `A AND B`
 * both; parentheses are honoured. An empty or unknown licence is never allowed.
 */
export function isAllowed(expression: string, allowed: readonly string[] = ALLOWED_LICENSES): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const parseOr = (): boolean => {
    let ok = parseAnd();
    while (tokens[i]?.toUpperCase() === 'OR') {
      i++;
      const rhs = parseAnd();
      ok = ok || rhs;
    }
    return ok;
  };
  const parseAnd = (): boolean => {
    let ok = parseTerm();
    while (tokens[i]?.toUpperCase() === 'AND') {
      i++;
      const rhs = parseTerm();
      ok = ok && rhs;
    }
    return ok;
  };
  const parseTerm = (): boolean => {
    const t = tokens[i++];
    if (t === '(') {
      const ok = parseOr();
      if (tokens[i] === ')') i++;
      return ok;
    }
    return t !== undefined && allowed.includes(t);
  };
  if (tokens.length === 0) return false;
  const ok = parseOr();
  return ok && i === tokens.length;
}

/** What is wrong with the entries: no licence, no licence text, or a licence outside the allow list. */
export function problems(entries: readonly LicenseEntry[], allowed: readonly string[] = ALLOWED_LICENSES): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const label = `${e.name}@${e.version}`;
    if (!e.license) out.push(`${label} declares no licence`);
    else if (!isAllowed(e.license, allowed)) out.push(`${label} is ${e.license}, which is not in the allow list (${allowed.join(', ')})`);
    if (!e.text.trim()) out.push(`${label} ships no licence text`);
  }
  return out;
}

/** The plain-text file shipped beside the app and the plugin. */
export function renderText(entries: readonly LicenseEntry[], appName: string): string {
  const head = `Third-party software in ${appName}\n\n${appName} includes the following open-source packages. Each is used under its own licence, reproduced below.\n`;
  const body = entries.map((e) => {
    const lines = [`${'='.repeat(72)}`, `${e.name} ${e.version}`, `Licence: ${e.license}`, ...(e.author ? [`Author: ${e.author}`] : []), ...(e.homepage ? [`Home: ${e.homepage}`] : []), '', e.text.trim()];
    if (e.notice.trim()) lines.push('', 'NOTICE', e.notice.trim());
    return lines.join('\n');
  });
  return [head, ...body, ''].join('\n');
}

/** The name in a `Copyright (c) 2015-present Jason Miller` line of a licence text, or ''. */
export function authorFromText(text: string): string {
  const name = /^\s*copyright\s*(?:\(c\)|©)?\s*[\d\s,\-–]*(?:present)?\s+(.+?)\s*$/im.exec(text)?.[1] ?? '';
  return stripUntilStable(name, /<[^<>]*>/g).replace(/[<>]/g, '').trim();
}
