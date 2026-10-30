import { describe, expect, it } from 'vitest';
import { authorFromText, authorName, isAllowed, type LicenseEntry, licenseOf, packageOf, problems, renderText } from './collect';
import { collectBundled } from './build-plugin';

const entry = (over: Partial<LicenseEntry> = {}): LicenseEntry => ({ name: 'a', version: '1.0.0', license: 'MIT', author: 'A', homepage: '', text: 'Permission is hereby granted', notice: '', ...over });

describe('licences', () => {
  it('finds the package of a bundled module, scoped or nested', () => {
    expect(packageOf('/p/node_modules/yjs/dist/yjs.mjs')).toEqual({ name: 'yjs', dir: '/p/node_modules/yjs' });
    expect(packageOf('/p/node_modules/@codemirror/view/dist/index.js?x')).toEqual({ name: '@codemirror/view', dir: '/p/node_modules/@codemirror/view' });
    expect(packageOf('/p/node_modules/a/node_modules/b/index.js')).toEqual({ name: 'b', dir: '/p/node_modules/a/node_modules/b' });
    expect(packageOf('/p/src/app/main.tsx')).toBeNull();
    expect(packageOf('\0vite/preload-helper')).toBeNull();
  });
  it('reads authors and licences', () => {
    expect(authorName('Kevin Jahns <k@x.org> (https://x.org)')).toBe('Kevin Jahns');
    expect(authorName({ name: 'Eemeli Aro' })).toBe('Eemeli Aro');
    expect(authorName(undefined)).toBe('');
    expect(authorName('a<<b>c>')).toBe('a');
    expect(authorName('a(b(c)d) e')).toBe('a e');
    expect(licenseOf({ license: 'ISC' })).toBe('ISC');
    expect(licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
    expect(licenseOf({})).toBe('');
  });
  it('reads an author from a copyright line', () => {
    expect(authorFromText('MIT License\n\nCopyright (c) 2015-present Jason Miller\n\nPermission')).toBe('Jason Miller');
    expect(authorFromText('Copyright (c) 2020 Ann <<b>c>')).toBe('Ann');
    expect(authorFromText('Apache boilerplate, the copyright owner or entity')).toBe('');
  });
  it('allows only licences on the list, with SPDX AND / OR', () => {
    expect(isAllowed('MIT')).toBe(true);
    expect(isAllowed('(MIT OR GPL-3.0-only)')).toBe(true);
    expect(isAllowed('MIT AND GPL-3.0-only')).toBe(false);
    expect(isAllowed('GPL-3.0-only')).toBe(false);
    expect(isAllowed('')).toBe(false);
    expect(isAllowed('SEE LICENSE IN LICENSE.txt')).toBe(false);
  });
  it('reports a missing licence, an unknown one and a missing text', () => {
    expect(problems([entry()])).toEqual([]);
    expect(problems([entry({ license: '' })])[0]).toMatch(/no licence/);
    expect(problems([entry({ name: 'weird', license: 'WTFPL' })])[0]).toMatch(/weird@1.0.0 is WTFPL/);
    expect(problems([entry({ text: ' ' })])[0]).toMatch(/no licence text/);
  });
  it('renders the text file with notices', () => {
    const text = renderText([entry({ name: 'jsqr', license: 'Apache-2.0', notice: 'Notice body' })], 'Yak');
    expect(text).toContain('jsqr 1.0.0');
    expect(text).toContain('NOTICE\nNotice body');
  });
  it('collects the shipped packages from real modules, each with a licence text', () => {
    const entries = collectBundled([`${process.cwd()}/node_modules/yjs/dist/yjs.mjs`, `${process.cwd()}/node_modules/yaml/dist/index.js`, `${process.cwd()}/src/x.ts`]);
    expect(entries.map((e) => e.name)).toEqual(['yaml', 'yjs']);
    expect(problems(entries)).toEqual([]);
    expect(entries[0]?.author).toBe('Eemeli Aro');
  });
});

import { bundledAssets } from './assets';
describe('bundled assets', () => {
  it('credits the EFF wordlist only when its module is bundled', () => {
    expect(bundledAssets(['/x/src/core/a.ts'])).toEqual([]);
    const [e] = bundledAssets(['/x/src/core/passphrase-words.ts']);
    expect(e?.license).toBe('CC-BY-3.0');
    expect(e?.homepage).toBe('https://www.eff.org/dice');
  });
});
