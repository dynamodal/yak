import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveLightDark, supportsLightDark } from './light-dark';

describe('resolveLightDark', () => {
  it('picks the light or the dark half', () => {
    expect(resolveLightDark('light-dark(#faf7f2, #1a1917)', false)).toBe('#faf7f2');
    expect(resolveLightDark('light-dark(#faf7f2, #1a1917)', true)).toBe('#1a1917');
  });
  it('keeps nested functions whole and the text around the call', () => {
    const shadow = '0 6px 24px light-dark(rgb(60 40 20 / 0.14), rgb(0 0 0 / 0.5))';
    expect(resolveLightDark(shadow, false)).toBe('0 6px 24px rgb(60 40 20 / 0.14)');
    expect(resolveLightDark(shadow, true)).toBe('0 6px 24px rgb(0 0 0 / 0.5)');
    const tint = 'light-dark(color-mix(in srgb, var(--accent) 14%, var(--bg)), color-mix(in srgb, var(--accent) 24%, var(--bg)))';
    expect(resolveLightDark(tint, true)).toBe('color-mix(in srgb, var(--accent) 24%, var(--bg))');
  });
  it('leaves a value without the function, or a broken call, as it is', () => {
    expect(resolveLightDark('var(--accent)', true)).toBe('var(--accent)');
    expect(resolveLightDark('light-dark(#fff', true)).toBe('light-dark(#fff');
  });
  it('resolves every colour token in tokens.css to a value without light-dark()', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const values = [...css.matchAll(/--[\w-]+:\s*([^;]*light-dark\([^;]*);/g)].map((m) => m[1]!);
    expect(values.length).toBeGreaterThan(10);
    for (const v of values) for (const dark of [false, true]) expect(resolveLightDark(v, dark)).not.toContain('light-dark(');
  });
});

describe('supportsLightDark', () => {
  it('asks CSS.supports, and says no when it is missing or throws', () => {
    expect(supportsLightDark({ supports: () => true })).toBe(true);
    expect(supportsLightDark({ supports: () => false })).toBe(false);
    expect(supportsLightDark(undefined)).toBe(false);
    expect(supportsLightDark({ supports: () => { throw new Error('old'); } })).toBe(false);
  });
});
