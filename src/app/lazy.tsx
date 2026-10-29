import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ViewProps } from './registry';

/**
 * A view whose code loads when it is first opened (keeps big pages out of the first download).
 * The module is fetched once; later opens render at once. A failed load (offline before the page was
 * cached) says so instead of staying blank.
 */
export function lazyView(load: () => Promise<{ default: ComponentType<ViewProps> }>): ComponentType<ViewProps> {
  return lazyComponent(load);
}

/** The same for any component (a Home card): nothing shows until the code has loaded. */
export function lazyComponent<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<void> | undefined;
  return function LazyComponent(props: P) {
    const [, rerender] = useState(0);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      // The load may have finished between this render and now (another instance started it).
      if (loaded) return rerender((n) => n + 1);
      pending ??= load().then(
        (m) => void (loaded = m.default),
        (e) => {
          pending = undefined;
          throw e;
        },
      );
      pending.then(
        () => rerender((n) => n + 1),
        () => setFailed(true),
      );
    }, []);
    if (loaded) {
      const View = loaded;
      return <View {...props} />;
    }
    return failed ? <p role="alert">This page could not be loaded. Check your connection and reload.</p> : null;
  };
}
