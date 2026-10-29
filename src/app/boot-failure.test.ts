import { describe, expect, it } from 'vitest';
import { checkStorage } from './boot-failure';

const factory = (open: (req: Record<string, unknown>) => void): IDBFactory =>
  ({
    open: () => {
      const req: Record<string, unknown> = {};
      queueMicrotask(() => open(req));
      return req;
    },
    deleteDatabase: () => ({}),
  }) as unknown as IDBFactory;

describe('checkStorage', () => {
  it('fails at once when IndexedDB is missing', async () => {
    expect(await checkStorage(50, undefined)).toEqual({ ok: false, detail: 'IndexedDB is not available' });
  });
  it('reports an open error (private mode, policy)', async () => {
    const idb = factory((req) => {
      req.error = new DOMException('denied', 'SecurityError');
      (req.onerror as () => void)();
    });
    const r = await checkStorage(50, idb);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.detail).toContain('SecurityError');
  });
  it('reports a throwing open', async () => {
    const idb = { open: () => { throw new Error('nope'); } } as unknown as IDBFactory;
    expect(await checkStorage(50, idb)).toEqual({ ok: false, detail: 'Error: nope' });
  });
  it('gives up when the browser never answers', async () => {
    const r = await checkStorage(30, factory(() => {}));
    expect(r.ok === false && r.detail).toMatch(/did not answer/);
  });
});
