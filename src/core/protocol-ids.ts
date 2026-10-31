/**
 * Wire formats. Changing one breaks every paired device and every backup, so each value is pinned by
 * `protocol-ids.test.ts`. `worker/index.ts` repeats TOPIC_PREFIX and RELAY_SERVICE, and `scripts/mock-relay.mjs` TOPIC_PREFIX (the test checks them).
 */
export const ACCOUNT_ID_INFO = 'yak/v1/account';
export const PAIRING_SALT = 'yak-pairing-v1';
export const PAIRING_TOPIC_INFO = 'yak/v1/topic';
export const PAIRING_KEY_INFO = 'yak/v1/key';
/** Relay topic: this prefix and 32 hex characters derived from the pairing secret. */
export const TOPIC_PREFIX = 'yk-';
/** Associated data of a sealed signal: `ENVELOPE_PREFIX` + version + `:` + topic. */
export const ENVELOPE_PREFIX = 'yak/';
/** Domain separation of the relay link's pairing digest and its per-message keys. */
export const RELAY_PAIR_DIGEST = 'yak/v1:pair:';
export const RELAY_CONTEXT_PREFIX = 'yak/v1:';
/** What a device signs in an offer or answer (#256), and the HKDF info of a pair key (S-76f); both followed by the pair's ids. */
export const SIGNAL_SIGNATURE_LABEL = 'yak/v1/signal';
export const PAIR_KEY_INFO = 'yak/v1/pair-key:';
/** A one-time invite (#257): HKDF infos of its mailbox and its message key (same salt as pairing), the associated data of its messages, and what both screens compare. */
export const INVITE_TOPIC_INFO = 'yak/v1/invite-topic';
export const INVITE_KEY_INFO = 'yak/v1/invite-key';
export const INVITE_ENVELOPE = 'yak/v1/invite:';
export const INVITE_COMPARE_LABEL = 'yak/v1/invite-compare';
/** A share link (#259): the same shapes as an invite, with their own infos, associated data and comparison label. */
export const SHARE_TOPIC_INFO = 'yak/v1/share-topic';
export const SHARE_KEY_INFO = 'yak/v1/share-key';
export const SHARE_ENVELOPE = 'yak/v1/share:';
export const SHARE_COMPARE_LABEL = 'yak/v1/share-compare';
/** The `service` field of the relay's JSON answers; the app tells our refusals from Cloudflare's by it. */
export const RELAY_SERVICE = 'yak-relay';
export const DATA_CHANNEL_LABEL = 'yak-sync';
export const BACKUP_CHECK_LABEL = 'yak-backup-check';
export const QR_PREFIX = 'yak:pair?';
export const SYNC_CODE_PREFIX = 'yk1.';
export const SETTINGS_KIND = 'yak-settings';
/** The Obsidian plugin keeps its pairing under this key plus `-<vault name>` (O4). */
export const PLUGIN_STORAGE_PREFIX = 'yak-sync';

/** The forms from the earlier test version (Punchdeck). Recognised only to give a clear error, never accepted. */
export const LEGACY = {
  qrPrefix: 'punchdeck:pair?',
  syncCodePrefix: 'pd1.',
  settingsKind: 'punchdeck-settings',
} as const;
export const FROM_EARLIER_VERSION = 'from Punchdeck, an earlier test version of this app';

/**
 * What a relay room is for, sent as `?k=` on its sockets so the operator can count accounts, shares
 * and one-time codes apart (#109): `a` account, `s` shared space, `i` one-time code or share link.
 */
export type RoomKind = 'a' | 's' | 'i';
