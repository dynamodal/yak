import { APP_NAME, FEEDBACK_EMAIL } from '../constants';

export type BootProblem = 'no-storage' | 'slow' | 'error';

/** The part of a start-up failure that is safe to show and to put in an email: no ids, no data. */
export const describeProblem = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e).slice(0, 200));

/** Whether IndexedDB works here: opens, writes and reads a throwaway database. Resolves (never throws, never hangs) within `ms`. */
export async function checkStorage(ms = 8000, idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!idb) return { ok: false, detail: 'IndexedDB is not available' };
  const name = `app-boot-check-${Date.now()}`;
  const test = new Promise<{ ok: true } | { ok: false; detail: string }>((resolve) => {
    try {
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve({ ok: false, detail: describeProblem(req.error) });
      req.onblocked = () => resolve({ ok: false, detail: 'open blocked' });
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put('hello', 'k');
          tx.oncomplete = () => {
            db.close();
            try {
              idb.deleteDatabase(name);
            } catch {
              /* a leftover empty database is harmless */
            }
            resolve({ ok: true });
          };
          tx.onerror = () => (db.close(), resolve({ ok: false, detail: describeProblem(tx.error) }));
          tx.onabort = () => (db.close(), resolve({ ok: false, detail: describeProblem(tx.error) }));
        } catch (e) {
          db.close();
          resolve({ ok: false, detail: describeProblem(e) });
        }
      };
    } catch (e) {
      resolve({ ok: false, detail: describeProblem(e) });
    }
  });
  const timeout = new Promise<{ ok: false; detail: string }>((resolve) => setTimeout(() => resolve({ ok: false, detail: `IndexedDB did not answer within ${Math.round(ms / 1000)} s` }), ms));
  return Promise.race([test, timeout]);
}

const HEADINGS: Record<BootProblem, string> = {
  'no-storage': `${APP_NAME} can't store data in this browser`,
  slow: `${APP_NAME} is taking too long to start`,
  error: `${APP_NAME} could not start`,
};

const WHY: Record<BootProblem, string> = {
  'no-storage': `${APP_NAME} keeps everything on this device, in the browser's site storage, and the browser is not letting it. This usually means a private or incognito window, a browser set to keep no history, a privacy or lockdown mode, or a rule set by your organization.`,
  slow: `The browser's site storage did not answer in time. Another ${APP_NAME} tab or window may be stuck, or the browser is busy or blocking storage.`,
  error: `Something went wrong while starting. Your data on this device has not been changed by this screen.`,
};

/** A plain screen that needs nothing from the app (no framework, no stylesheet): says what is wrong, what to try, how to report. */
export function renderBootFailure(root: HTMLElement, problem: BootProblem, detail: string): void {
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (text) e.textContent = text;
    parent?.appendChild(e);
    return e;
  };
  root.replaceChildren();
  const box = el('main', undefined, root);
  box.setAttribute('role', 'alert');
  box.setAttribute('data-boot-failure', problem);
  box.style.cssText = 'max-width:34rem;margin:0 auto;padding:2rem 1rem;font:16px/1.5 system-ui,sans-serif;';
  el('h1', HEADINGS[problem], box).style.cssText = 'font-size:1.4rem;margin:0 0 1rem;';
  el('p', WHY[problem], box);
  el('p', 'What to try:', box).style.fontWeight = '600';
  const list = el('ul', undefined, box);
  const tips =
    problem === 'no-storage'
      ? [
          'Open this page in a normal (not private) window.',
          'In Firefox, set History to "Remember history" (Settings › Privacy & Security), or allow this site to store data.',
          'Try another browser, such as Chrome, Edge, Firefox or Safari.',
          'If your organization manages this browser, ask them to allow site storage for this address.',
        ]
      : ['Reload the page.', 'Close other tabs and windows of this site, then reload.', 'Try another browser, or restart this one.'];
  for (const t of tips) el('li', t, list);
  const retry = el('button', 'Reload', box);
  retry.style.cssText = 'font:inherit;padding:.5rem 1rem;margin:.5rem 0 1rem;cursor:pointer;';
  retry.addEventListener('click', () => location.reload());
  el('p', 'If it keeps happening, tell us:', box).style.fontWeight = '600';
  const p = el('p', undefined, box);
  const subject = encodeURIComponent(`${APP_NAME} would not start`);
  const body = encodeURIComponent(`${APP_NAME} would not start (${problem}).\n\nDetail: ${detail}\nBrowser: ${navigator.userAgent}\n`);
  const a = el('a', FEEDBACK_EMAIL, p);
  a.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
  p.append(' with the browser you use and the line below (no personal data).');
  el('pre', detail, box).style.cssText = 'white-space:pre-wrap;font-size:.85rem;opacity:.8;';
}
