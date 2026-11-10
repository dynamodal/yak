import { afterEach, describe, expect, it, vi } from 'vitest';
import { migratePairing } from './sync-service';

const RELAY = 'wss://yak.example/signal';

describe('migratePairing', () => {
  it('moves a pairing on the old ntfy.sh default to the relay', () => {
    const next = migratePairing({ secret: 'S', signalingUrl: 'https://ntfy.sh/', peers: ['p'] }, RELAY);
    expect(next).toEqual({ secret: 'S', signalingUrl: RELAY, signalingVersion: 2, peers: ['p'] });
  });

  it('keeps a self-hosted ntfy server or a relay URL', () => {
    expect(migratePairing({ secret: 'S', signalingUrl: 'https://ntfy.example.com' }, RELAY).signalingUrl).toBe('https://ntfy.example.com');
    expect(migratePairing({ secret: 'S', signalingUrl: 'ws://localhost:8787/signal' }, RELAY).signalingUrl).toBe('ws://localhost:8787/signal');
  });

  it('keeps ntfy.sh when it was chosen under the relay default', () => {
    const chosen = { secret: 'S', signalingUrl: 'https://ntfy.sh', signalingVersion: 2 };
    expect(migratePairing(chosen, RELAY)).toBe(chosen);
  });
});

describe('SyncService document filter', () => {
  it('syncs the account document and spaces the app allows, nothing else', async () => {
    const { SyncService } = await import('./sync-service');
    const { DocumentStore } = await import('../core/doc-store');
    const store = new DocumentStore(() => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() }));
    const allowed = new Set(['account/aaaaaaaaaaaaaaaaaaaaaaaa', 'space/s1', 'space/s1/private']);
    const svc = new SyncService(store, { deviceId: 'me', allowDoc: (id) => allowed.has(id) });
    const allows = (svc as unknown as { allows(peer: string, doc: string): boolean }).allows.bind(svc);
    expect(allows('peer', 'account/aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(allows('peer', 'space/s1/private')).toBe(true);
    expect(allows('peer', 'space/s2')).toBe(false);
    expect(allows('peer', 'account/bbbbbbbbbbbbbbbbbbbbbbbb')).toBe(false);
    expect(allows('peer', 'notes/x')).toBe(false);
    expect(svc.pairedAccountId).toBeUndefined();
    svc.setAccount('aaaaaaaaaaaaaaaaaaaaaaaa'); // no pairing yet: nothing to record
    expect(svc.pairedAccountId).toBeUndefined();
  });
});

describe('SyncService file frames', () => {
  it('honours file frames from a direct link only, never from the relay (#166)', async () => {
    const { SyncService } = await import('./sync-service');
    const { DocumentStore } = await import('../core/doc-store');
    const { encodeControl, encodeFilePiece } = await import('./doc-mux');
    const store = new DocumentStore(() => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() }));
    const svc = new SyncService(store, { deviceId: 'me' });
    const calls: string[] = [];
    (svc as unknown as { files: unknown }).files = { onPiece: () => calls.push('piece'), onControl: () => (calls.push('control'), true) };
    const feed = (svc as unknown as { onLinkData(p: string, d: Uint8Array, via: 'direct' | 'relay'): void }).onLinkData.bind(svc);
    const hash = 'a'.repeat(64);
    const piece = encodeFilePiece('s', hash, 0, new Uint8Array([1, 2, 3]));
    const want = encodeControl({ kind: 'file-get', unit: 's', hash, i: [0] });
    feed('peer', piece, 'relay');
    feed('peer', want, 'relay');
    expect(calls).toEqual([]);
    feed('peer', piece, 'direct');
    feed('peer', want, 'direct');
    expect(calls).toEqual(['piece', 'control']);
  });
});

describe('SyncService reconnect triggers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a log line written to the shared log is not a local edit; an edit to a space is (#164)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { addEventListener: () => undefined });
    vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' });
    const { SyncService } = await import('./sync-service');
    const { DocumentStore } = await import('../core/doc-store');
    const { SharedLogWriter } = await import('./shared-log');
    const store = new DocumentStore(() => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() }));
    const svc = new SyncService(store, { deviceId: 'me' });
    const reconnect = vi.fn();
    // A mesh with a peer that is not connected: the state in which edits trigger reconnects.
    (svc as unknown as { mesh: unknown }).mesh = { peers: [{ id: 'peer', state: 'reconnecting' }], reconnect };
    const accountLog = await store.open('account/aaaaaaaaaaaaaaaaaaaaaaaa/log'); // open before the triggers are installed
    (svc as unknown as { installTriggers(): void }).installTriggers();
    const writer = new SharedLogWriter({
      log: svc.log,
      device: 'me',
      openAccountLog: () => Promise.resolve(accountLog),
      openSpaceLog: () => store.open('space/s1/log'), // opened after
    });
    writer.start();
    for (let i = 0; i < 20; i++) {
      svc.log.log('link', `line ${i}`);
      svc.log.log('space', `space line ${i}`, 's1');
      await vi.advanceTimersByTimeAsync(300);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(accountLog.getMap('lines').size).toBeGreaterThan(0);
    expect((await store.open('space/s1/log')).getMap('lines').size).toBeGreaterThan(0);
    expect(reconnect).not.toHaveBeenCalled();

    const space = await store.open('space/s1');
    space.getMap('m').set('k', 1);
    await vi.advanceTimersByTimeAsync(600);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect.mock.calls[0]![0]).toBe('local edit');
    writer.close();
  });
});
