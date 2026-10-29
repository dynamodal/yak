import { base64url } from '../core/bytes';
import { isPublicKeyJwk, type PublicKeyJwk } from '../core/keys';
import { INVITE_COMPARE_LABEL, INVITE_ENVELOPE, INVITE_KEY_INFO, INVITE_TOPIC_INFO } from '../core/protocol-ids';
import { open as openSignal } from './envelope';
import { deriveKeys, type DerivedKeys } from './pairing-secret';
import { compareDigest, freshness, isStr, MAILBOX_TTL_MS, openMessage, sealMessage } from './sealed-mailbox';
import type { SignalingTransport } from './signaling';

/**
 * One-time invites (docs/sync.md, "Key model", "Pairing a new device", #257). In a keys-required
 * account the code an owner shows opens a mailbox for a join request and nothing else:
 *
 *   new device ── join (its id, name, public keys) ──▶ approving device
 *              ◀── seen (account key, a fresh nonce) ──   both screens show `compareCode`
 *   the person confirms on the new device that the codes match; the owner approves on the other
 *              ◀── approved (signed records, wrapped secret) ──
 *
 * Messages are sealed with a key from the code, so the relay sees nothing; whoever else has the code
 * can read and send them, which is why both screens show a code over the account key, the new
 * device's id and keys, and a nonce the approving device picks only after the request arrived: a
 * swapped request or a fake `seen` changes one screen, and a matching request cannot be ground in
 * advance. The new device follows an approval only after its person confirmed the match, so a fake
 * `seen` cannot pull it into someone else's account. The code admits one device: after the first
 * approval every other request is declined. The account's sync secret goes to the new device
 * wrapped to its own key, never readable with the code.
 */

/** How long an invite stays open. */
export const INVITE_TTL_MS = MAILBOX_TTL_MS;
/** A join request is sent again this often until it is seen (the other side may subscribe late). */
const RESEND_MS = 4000;
/** After `seen`, the request is repeated this often, so a lost approval is sent again. */
const SEEN_RESEND_MS = 10_000;
/** With no `seen` this long the code is not an invite (an account's own code, compatible mode): stop asking. */
export const NO_ANSWER_MS = 60_000;
/** A device that says hello with the code but sends no join request this long runs an older Yak. */
const OLD_BUILD_MS = 6000;

/** A device id is a UUID: a short or chosen id would let a joiner vary it freely to match a code. */
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JoinRequest {
  deviceId: string;
  name?: string;
  sign: PublicKeyJwk;
  agree: PublicKeyJwk;
  /** What the new device's build understands (`KEYS_REQUIRED_LEVEL`). */
  v?: number;
}

export interface Approval {
  accountId: string;
  /** The account key fingerprint the approving device showed in `seen`. */
  account: string;
  /** Signed records from the account document: the account key, the switch, both certificates and device keys. */
  records: [string, unknown][];
  /** The account's sync secret, wrapped to the new device's agree key (`wrapFor`). */
  secret: string;
  signalingUrl: string;
}

/** Why a request was declined: by the owner, or because the code already admitted a device. */
export type DeclineReason = 'declined' | 'used';

type Message =
  | ({ t: 'join' } & JoinRequest)
  | { t: 'seen'; to: string; account: string; publicKey: PublicKeyJwk; nonce: string }
  | ({ t: 'approved'; to: string } & Approval)
  /** `account` as in `seen`: the new device heeds a decline only from the account it compared (#291). */
  | { t: 'declined'; to: string; account: string; why?: DeclineReason };

export async function deriveInvite(code: string): Promise<DerivedKeys> {
  return deriveKeys(code, { topic: INVITE_TOPIC_INFO, key: INVITE_KEY_INFO });
}

const seal = (keys: DerivedKeys, m: Message): Promise<string> => sealMessage(keys, INVITE_ENVELOPE, m);

/** Open and check the shape of a message; undefined for anything else (wrong key, garbage, an unknown kind, a device id that is no UUID). */
async function unseal(keys: DerivedKeys, text: string): Promise<{ m: Message; nonce: string } | undefined> {
  const got = await openMessage(keys, INVITE_ENVELOPE, text, 16_000);
  if (!got) return undefined;
  const { m, nonce } = got;
  if (m.t === 'join' && typeof m.deviceId === 'string' && DEVICE_ID.test(m.deviceId) && isPublicKeyJwk(m.sign) && isPublicKeyJwk(m.agree) && (m.name === undefined || (typeof m.name === 'string' && m.name.length <= 80)) && (m.v === undefined || typeof m.v === 'number'))
    return { m: m as unknown as Message, nonce };
  if (m.t === 'seen' && isStr(m.to) && isStr(m.account) && isPublicKeyJwk(m.publicKey) && isStr(m.nonce)) return { m: m as unknown as Message, nonce };
  if (m.t === 'approved' && isStr(m.to) && isStr(m.accountId) && isStr(m.account) && typeof m.secret === 'string' && typeof m.signalingUrl === 'string' && Array.isArray(m.records) && m.records.length <= 16) return { m: m as unknown as Message, nonce };
  if (m.t === 'declined' && isStr(m.to) && isStr(m.account)) return { m: m as unknown as Message, nonce };
  return undefined;
}

/**
 * What both screens show for one join request: 64 bits over the invite, the account key, the
 * approving device's nonce for this request, and the device's id and keys, as four groups of four.
 * The nonce is chosen after the request arrived, so nobody can search for a matching request in advance.
 */
export function compareCode(topic: string, accountFp: string, nonce: string, r: Pick<JoinRequest, 'deviceId' | 'sign' | 'agree'>): Promise<string> {
  return compareDigest(INVITE_COMPARE_LABEL, [topic, accountFp, nonce, r.deviceId, r.sign.x, r.sign.y, r.agree.x, r.agree.y]);
}

export interface InviteHostEvents {
  /** A device asks to join, with the code both screens show (reported once per device and keys). */
  onRequest(r: JoinRequest, compare: string): void;
  /** The code admitted a device: these other requests were declined. */
  onUsed?(declined: string[]): void;
  /** A device said hello with the code but sent no join request: an older Yak. */
  onOldBuild?(deviceId: string): void;
}

interface HostRequest {
  r: JoinRequest;
  nonce: string;
  seen: Message;
}

/** The approving device's side: listens for join requests while the invite is open. */
export class InviteHost {
  private stops: (() => void)[] = [];
  private readonly requests = new Map<string, HostRequest>();
  private readonly answers = new Map<string, Message>();
  private keys: DerivedKeys | undefined;
  /** The code admitted a device; any other request is declined. */
  used = false;
  readonly expiresAt = Date.now() + INVITE_TTL_MS;

  constructor(
    readonly code: string,
    private readonly transport: SignalingTransport,
    private readonly account: { fingerprint: string; publicKey: PublicKeyJwk },
    private readonly events: InviteHostEvents,
  ) {}

  async start(): Promise<void> {
    const keys = await deriveInvite(this.code);
    this.keys = keys;
    const fresh = freshness();
    this.stops.push(
      this.transport.subscribe(keys.topic, {
        onMessage: (msg) =>
          void unseal(keys, msg.message).then(async (got) => {
            if (!got || got.m.t !== 'join' || !fresh(msg, got.nonce)) return;
            const { t: _t, ...r } = got.m;
            const answer = this.answers.get(r.deviceId);
            // A request sent again after the answer left (the new device subscribed late): the same answer again.
            if (answer) return void this.send(answer);
            // A spent code: `seen` first, so the new device knows which account the decline comes from.
            if (this.used) {
              await this.send(this.seenFor(r.deviceId, base64url(crypto.getRandomValues(new Uint8Array(16)))));
              return void this.send(this.declined(r.deviceId, 'used'));
            }
            const known = this.requests.get(r.deviceId);
            if (known && known.r.sign.x === r.sign.x && known.r.agree.x === r.agree.x) return void this.send(known.seen);
            // A fresh nonce for every request, picked now: the code cannot be matched before it is shown.
            const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
            const seen = this.seenFor(r.deviceId, nonce);
            this.requests.set(r.deviceId, { r, nonce, seen });
            this.events.onRequest(r, await compareCode(keys.topic, this.account.fingerprint, nonce, r));
            await this.send(seen);
          }),
      }),
    );
    // An older Yak joining with this code only says hello on the code's mesh mailbox.
    const mesh = await deriveKeys(this.code);
    const hellos = new Map<string, ReturnType<typeof setTimeout>>();
    this.stops.push(
      this.transport.subscribe(mesh.topic, {
        onMessage: (msg) =>
          void openSignal(mesh.key, mesh.topic, msg.message)
            .then(({ payload }) => {
              const from = payload.from;
              if (payload.type !== 'hello' || hellos.has(from) || this.requests.has(from)) return;
              hellos.set(
                from,
                setTimeout(() => {
                  if (!this.requests.has(from)) this.events.onOldBuild?.(from);
                }, OLD_BUILD_MS),
              );
            })
            .catch(() => undefined),
      }),
    );
    this.stops.push(() => hellos.forEach((t) => clearTimeout(t)));
    const expire = setTimeout(() => this.stop(), INVITE_TTL_MS);
    this.stops.push(() => clearTimeout(expire));
  }

  /** Approve one device. The code is spent: every other request is declined. */
  async approve(deviceId: string, approval: Approval): Promise<void> {
    const m: Message = { t: 'approved', to: deviceId, ...approval };
    this.answers.set(deviceId, m);
    this.used = true;
    const others = [...this.requests.keys()].filter((id) => id !== deviceId && !this.answers.has(id));
    await this.send(m);
    for (const id of others) {
      const d = this.declined(id, 'used');
      this.answers.set(id, d);
      await this.send(d);
    }
    if (others.length) this.events.onUsed?.(others);
  }

  private seenFor(to: string, nonce: string): Message {
    return { t: 'seen', to, account: this.account.fingerprint, publicKey: this.account.publicKey, nonce };
  }

  private declined(to: string, why: DeclineReason): Message {
    return { t: 'declined', to, account: this.account.fingerprint, why };
  }

  decline(deviceId: string): Promise<void> {
    const m = this.declined(deviceId, 'declined');
    this.answers.set(deviceId, m);
    return this.send(m);
  }

  private async send(m: Message): Promise<void> {
    if (!this.keys) return;
    await this.transport.publish(this.keys.topic, await seal(this.keys, m));
  }

  stop(): void {
    for (const s of this.stops.splice(0)) s();
  }
}

export interface InviteGuestEvents {
  /** The approving device saw the request: show the comparison code and ask whether it matches. */
  onSeen(account: string, publicKey: PublicKeyJwk, code: string): void;
  onApproved(a: Approval): void;
  onDeclined(why: DeclineReason): void;
  /** Nobody answered (the code is no invite, or the other device is gone): the guest stopped asking. */
  onNoAnswer?(): void;
}

/** The new device's side: sends its join request until answered. */
export class InviteGuest {
  private stops: (() => void)[] = [];
  private account: string | undefined;
  private confirmed = false;
  /** An approval that arrived before the person confirmed the codes match. */
  private held: Approval | undefined;
  private done = false;

  constructor(
    readonly code: string,
    private readonly transport: SignalingTransport,
    private readonly request: JoinRequest,
    private readonly events: InviteGuestEvents,
    /** Timings, shortened in tests. */
    private readonly timing: { resendMs?: number; noAnswerMs?: number } = {},
  ) {}

  /** The person saw the same code on both screens: follow the approval (now, or when it arrives). */
  confirm(): void {
    if (!this.account || this.done) return;
    this.confirmed = true;
    if (this.held) this.finish(this.held);
  }

  private finish(a: Approval): void {
    this.done = true;
    this.stop();
    this.events.onApproved(a);
  }

  async start(): Promise<void> {
    const keys = await deriveInvite(this.code);
    const fresh = freshness();
    const me = this.request.deviceId;
    const startedAt = Date.now();
    let lastSent = 0;
    this.stops.push(
      this.transport.subscribe(keys.topic, {
        onMessage: (msg) =>
          void unseal(keys, msg.message).then(async (got) => {
            if (!got || this.done || got.m.t === 'join' || got.m.to !== me || !fresh(msg, got.nonce)) return;
            const m = got.m;
            if (m.t === 'seen') {
              // The first account seen is the one compared; another `seen` (someone else with the code) is ignored. Start again to compare afresh.
              if (this.account) return;
              this.account = m.account;
              this.events.onSeen(m.account, m.publicKey, await compareCode(keys.topic, m.account, m.nonce, this.request));
            } else if (m.t === 'approved') {
              if (m.account !== this.account) return;
              const { t: _t, to: _to, ...a } = m;
              if (this.confirmed) this.finish(a);
              else this.held = a;
            } else {
              // Only the account compared may decline: anyone else with the code could send one (#291).
              if (!this.account || m.account !== this.account) return;
              this.done = true;
              this.stop();
              this.events.onDeclined(m.why === 'used' ? 'used' : 'declined');
            }
          }),
      }),
    );
    const send = async (): Promise<void> => {
      if (this.done) return;
      lastSent = Date.now();
      await this.transport.publish(keys.topic, await seal(keys, { t: 'join', ...this.request })).catch(() => undefined);
    };
    void send();
    // Before `seen`: every few seconds, for a minute at most (an account's own code gets no answer). After: now and then, so a lost approval comes again.
    const timer = setInterval(() => {
      if (this.done) return;
      const now = Date.now();
      if (!this.account) {
        if (now - startedAt > (this.timing.noAnswerMs ?? NO_ANSWER_MS)) {
          this.stop();
          this.events.onNoAnswer?.();
          return;
        }
        void send();
      } else if (now - lastSent >= SEEN_RESEND_MS) void send();
    }, this.timing.resendMs ?? RESEND_MS);
    const expire = setTimeout(() => this.stop(), INVITE_TTL_MS);
    this.stops.push(() => clearInterval(timer), () => clearTimeout(expire));
  }

  stop(): void {
    for (const s of this.stops.splice(0)) s();
  }
}
