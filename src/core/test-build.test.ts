import { afterEach, describe, expect, it } from 'vitest';
import { scaledMs } from './test-build';

describe('scaledMs', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('leaves a timer alone outside a test build, even when a page sets the flag', () => {
    (globalThis as { window?: unknown }).window = { __yakTimerScale: 10 };
    expect(scaledMs(60_000)).toBe(60_000);
  });
});
