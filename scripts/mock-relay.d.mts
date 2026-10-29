export interface MockRelay {
  /** Base URL for `WebSocketTransport`, for example `ws://127.0.0.1:1234/signal`. */
  url: string;
  httpUrl: string;
  state: { links: number; linkFrames: number; linkBytes: number; connections: number; rejected: number; messages: number; pings: number; refused: number; silent: boolean };
  /** Called with every binary link frame forwarded (tests). */
  onFrame?: (frame: Buffer) => void;
  limitLinks(reason: 'day' | 'rate'): void;
  dropAll(): void;
  /** Refuse the next `count` upgrades (all when omitted) with the Worker's close codes; `null` stops. */
  refuse(kind: 'rate' | 'day' | null, options?: { count?: number; retry?: number; scope?: 'share' | 'topics'; reset?: number }): void;
  openSockets(): number;
  close(): Promise<void>;
}

export function startMockRelay(options?: { port?: number; now?: () => number }): Promise<MockRelay>;
