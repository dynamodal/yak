declare const __TEST_BUILD__: boolean;

/**
 * True only in a build made for the browser tests (`YAK_TEST_BUILD=1`, set by `npm run e2e`).
 * The production bundle then contains none of the `?test` hooks and ignores the `?test` URL flag.
 */
export const TEST_BUILD: boolean = typeof __TEST_BUILD__ !== 'undefined' && __TEST_BUILD__;

/** `?test` in the URL, honoured only in a test build. */
export function testMode(): boolean {
  return TEST_BUILD && typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
}

/**
 * A long product timer, shortened in a test build when the page set `window.__yakTimerScale = n` (n > 1; the browser
 * suites do it with an init script): the timer runs n times faster, so a suite waits seconds instead of a minute.
 * Product builds, and test builds without the flag, get `ms` unchanged. Used only for the timers a suite waits out
 * (direct-path retry, link retry delays, relay stats refresh); see "Test-build timers" in docs/testing.md.
 */
export function scaledMs(ms: number): number {
  if (!TEST_BUILD || typeof window === 'undefined') return ms;
  const n = Number((window as unknown as { __yakTimerScale?: number }).__yakTimerScale);
  return n > 1 ? Math.max(1, Math.round(ms / n)) : ms;
}
