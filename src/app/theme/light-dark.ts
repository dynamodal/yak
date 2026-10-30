/**
 * Fallback for CSS `light-dark()` (Safari before 17.5, iOS before 17.5, Chrome before 123, Firefox before 120).
 *
 * Every colour token in tokens.css is written as `light-dark(light, dark)`. A browser without the function still keeps
 * a custom property's text as written, but every use of it is invalid, so the app would show no theme colours at all.
 * Where the function is missing, this picks the half for the current colour scheme and sets the result on `<html>`,
 * again whenever the theme (data-theme) or the system preference changes. Browsers with the function do nothing.
 */

/** Replaces each `light-dark(a, b)` in a value with `a` or `b`; nested parentheses (rgb(), color-mix()) are kept whole. */
export function resolveLightDark(value: string, dark: boolean): string {
  const NAME = 'light-dark(';
  let out = '';
  let i = 0;
  for (let at = value.indexOf(NAME, i); at >= 0; at = value.indexOf(NAME, i)) {
    out += value.slice(i, at);
    let depth = 0;
    let comma = -1;
    let end = -1;
    for (let j = at + NAME.length; j < value.length; j++) {
      const c = value[j];
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) {
          end = j;
          break;
        }
        depth--;
      } else if (c === ',' && depth === 0 && comma < 0) comma = j;
    }
    // Not a well-formed call: keep the rest as written.
    if (end < 0 || comma < 0) return out + value.slice(at);
    const half = dark ? value.slice(comma + 1, end) : value.slice(at + NAME.length, comma);
    out += resolveLightDark(half.trim(), dark);
    i = end + 1;
  }
  return out + value.slice(i);
}

/** The custom properties set on `:root` whose value uses `light-dark()`, read from the page's own style sheets. */
function lightDarkTokens(doc: Document): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if ('cssRules' in rule && !(rule instanceof CSSStyleRule)) {
        visit((rule as CSSGroupingRule).cssRules);
        continue;
      }
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ':root') continue;
      for (const name of Array.from(rule.style)) {
        const value = rule.style.getPropertyValue(name);
        if (name.startsWith('--') && value.includes('light-dark(')) found.set(name, value);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A sheet from another origin cannot be read; the app's own are same-origin.
    }
  }
  return found;
}

export function supportsLightDark(css: { supports?: (p: string, v: string) => boolean } | undefined = typeof CSS === 'undefined' ? undefined : CSS): boolean {
  try {
    return css?.supports?.('color', 'light-dark(#000, #fff)') === true;
  } catch {
    return false;
  }
}

/** Installs the fallback when the browser lacks `light-dark()`; a no-op otherwise. */
export function installLightDarkFallback(doc: Document = document): void {
  if (supportsLightDark() || typeof matchMedia !== 'function') return;
  const root = doc.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let tokens: Map<string, string> | undefined;
  const apply = (): void => {
    // Style sheets may still be loading on the first call; read them again until some are found.
    if (!tokens?.size) tokens = lightDarkTokens(doc);
    const theme = root.getAttribute('data-theme');
    const dark = theme === 'dark' || (theme !== 'light' && system.matches);
    for (const [name, value] of tokens) root.style.setProperty(name, resolveLightDark(value, dark));
  };
  apply();
  if (!tokens?.size) addEventListener('load', apply, { once: true });
  system.addEventListener?.('change', apply);
  if (typeof MutationObserver === 'function') new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}
