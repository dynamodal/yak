# Sync: accounts, devices, spaces, signaling

How sync works today. Decisions and reasons: `decisions/sync.md`.

## Three jobs, kept apart

| Job | Carried by | Human involved |
| --- | --- | --- |
| Data: Yjs updates between devices | WebRTC data channel, device to device; the relay's data link when none opens | Never |
| Signaling: set up that channel (offer, answer, hello) | Encrypted messages through a mailbox: the site's relay (`wss://…/signal`, default) or ntfy.sh | Never, after pairing |
| Pairing: give a device a one-time code, approved on an enrolled device | Typed, scanned (QR) or pasted, once per device | Once |

- Document data never touches the signaling mailbox. A direct link keeps syncing if the server is down.
- Only when no direct path opens does data pass through the relay, sealed end to end (next section).

## Sync code

- 128 random bits as 28 base32 characters (two are checks); case, spaces and dashes ignored.
- HKDF-SHA256 derives the mailbox topic and a non-extractable AES-256-GCM key that encrypts and authenticates every signaling message.
- Stored in `localStorage` until the device leaves.
- Session descriptions (with DTLS fingerprints) travel inside authenticated messages, so the server cannot sit in the middle.

## Account, devices, spaces

- **Account:** the devices that hold one sync code. Its document `account/<id>` (spaces and names, devices, removals, which spaces each device keeps, personal settings) syncs to every device.
- **Space:** a sync boundary, not a display boundary. Shared part `space/<id>` (projects, clients, tags, notes, tasks); private part `space/<id>/private` (time entries, rates), only for the account's devices.
- **Keeps:** each device keeps some spaces (`keeps` map, `<deviceId>:<spaceId>`). A space syncs between two devices only if both keep it. A new device keeps nothing until chosen; a space created elsewhere is undecided until chosen.
- **Create, archive, remove:** Settings (the Your data table, then the space's page). Archived spaces (`<id>:archived`) are hidden but still kept and synced; removed ones (`<id>:deleted`) stop syncing everywhere. Decisions S26–S30.
- **Mesh:** every device links to every other (cap 8); edits relay through devices in between.
- `DocMux` runs one Yjs sync per document over one data channel; a second frame type carries JSON control messages (today only "switch to this new sync code").
- `PeerLink` splits messages larger than the peer's max-message-size into pieces and joins them again (`link-chunks.ts`), and holds back pieces while the send buffer is full.
- Filter: `allowsDoc` in `src/app/sync-filter.ts`.

## Relay fallback

- No direct link 5 s after an offer or answer → each device opens a data link to the other through the site's relay: `wss://…/signal/<topic>/link/<pair>`. `<pair>` = first 16 bytes of SHA-256 over the topic and both device ids (sorted), so the relay learns no device id. Not offered with ntfy.sh.
- The Worker forwards each binary frame to the other socket of the pair (at most two) and keeps nothing; it tells the survivor with `{"event":"left"}` when one ends. Signaling broadcasts never reach link sockets.
- Every message is sealed whole with the account key (AES-GCM, bound to topic and pair), then cut into 32 KiB pieces with a plain header (message id, index, count). The relay sees ciphertext, sizes and timing. `hello`/`ack` frames, also sealed, tell each device the other is there.
- Sending is paced under the Worker's caps (about 320 kB/s and 30 frames/s); the Worker closes a socket above 4 MiB or 400 frames per 10 s, or a frame over 64 KiB. A catch-up of several MB takes tens of seconds.
- Direct is still tried: the usual offer retries run, and while on the relay the initiator makes a fresh offer every 60 s. When a direct link opens the sessions keep running unchanged and the relay link is closed 3 s later.
- A relay socket whose other device is not there is closed after 10 min.
- Status: the device's row says "Syncing through the relay". The header chip is unchanged.
- Cost: the Durable Object bills incoming WebSocket messages at 20 to 1 as requests, and ping/pong is answered without waking it. A 10 MB catch-up is about 320 frames, so about 16 billed requests; an idle room costs nothing.

## Relay limits

- Scarce unit on the Cloudflare Free plan: **requests** (about 100 000 a day; confirm in the dashboard). Static assets are not counted; only `/signal/*` runs Worker code. Bytes are not billed, so they are not the budget.
- **Account budget:** the Worker and the rooms add up their estimated requests in one `RelayBudget` object: 1 per call (refused ones too), 1 more per accepted socket, 1 per 20 relayed messages. Default 50 000 a day (`RELAY_DAY_REQUESTS`), reset at UTC midnight. At 80% new data links are refused (503); at 100% every `/signal` connection is, and relayed messages are dropped. Open links get `{"event":"limit","reason":"service"}`.
- **The estimate errs low:** each Worker instance reports every 50 requests or 30 s, rooms every 200 messages, so a burst can overshoot a little. That is why the budget is half the quota.
- **Kill switch:** `RELAY=off` (a variable in the dashboard or `wrangler.jsonc`) refuses everything at once.
- `Origin` must be the site, Obsidian or `ALLOWED_ORIGINS`; otherwise 403.
- New connections a minute: 60 per address and topic (`CONNECT_LIMIT`), 120 per address in all, status checks included (`ADDRESS_LIMIT`); otherwise 429. Accounts behind one VPN or office address do not crowd each other out.
- Per address and UTC day, kept by `RelayBudget` (as hashes and counts only): accepted sockets may spend 10% of the day's requests (`ADDRESS_DAY_SHARE`, 2 per socket, so 2 500 at the default) and open 150 different topics (`ADDRESS_DAY_TOPICS`); past either, 429 with `reason: address` and `scope: share` or `topics`. Messages on open sockets are not attributed to an address; the per-socket caps bound them.
- A device the relay refuses this way (the status check says so) opens no sockets for 90 s, then starts over; open links stay.
- Per socket: signaling 20 messages and links 400 frames or 4 MiB per 10 s; a frame is at most 8 KiB (signaling) or 64 KiB (links). Above that the Worker closes the socket.
- Per room: 100 MiB of link data per UTC day (`RELAY_DAY_BYTES`), a fairness limit, not a cost limit. Past it the room's two devices get `reason":"day"`.
- Devices wait longer after repeated failed connects (every attempt is a request): up to 5 minutes after six in a row.

### Operator stats (off until set up)

- With the `RELAY_STATS` Analytics Engine binding, each relayed message writes one data point: a room hash (first 8 hex of SHA-256 of the topic), the kind (`signal` or `link`, the relay fallback) and the size. No content, addresses or device ids.
- `GET /signal/admin/stats?hours=24` with `Authorization: Bearer <ADMIN_KEY>` queries it through the Cloudflare SQL API and returns rows per hour and kind. It needs the secrets `ADMIN_KEY`, `CF_ACCOUNT_ID` and `CF_API_TOKEN` (a token with Account Analytics read); without them it answers 404. Never put them in the repo.
- To turn on: enable Workers Analytics Engine for the account, uncomment `analytics_engine_datasets` in `wrangler.jsonc`, `npx wrangler secret put` the three secrets, deploy.
- App: `#/settings/network` (not in the Settings list) asks for the admin key once per device (`localStorage`, never synced) and shows active rooms, messages, bytes and the share carried by relay data links.
### Relay stats

- `GET /signal/<topic>/stats` (the topic is the only secret): devices and data links connected now, messages and bytes in the last hour and 24 hours, last activity. The room keeps 10-minute buckets in its storage and sees no content or device ids, so there is no per-device activity.
- The Devices page shows "Relay: 3 devices connected · 420 messages today" when opened, then once a minute while visible; each ask is a counted request.

### Telling whose limit it is

- Every refusal is JSON with `"service":"yak-relay"` and an `X-Relay-Limit` header (`service`, `origin`, `address`). A browser hides the status of a failed WebSocket, so when the relay fails the app asks `GET /signal/status` (at most every 2 minutes) and the Devices page says:

| Answer | The page says |
| --- | --- |
| Our JSON, `state: limited` | Yak's relay has used its daily allowance for all users, paused until about `<time>` |
| Our JSON, `state: ok` | The relay turned this connection away (too many connections, or this page is not allowed) |
| Not our JSON (an error page, 5xx, 429) | Cloudflare is refusing requests (its quota or an outage) |
| No answer, online | The relay cannot be reached from this network |
| A link event `day` / `rate` | Your account's daily data allowance / sending too fast |

- Every line adds that direct sync is not affected.

### Not covered by the Worker

- A call that reaches the Worker is already counted by Cloudflare, so abuse by refused calls still spends quota. Add a Cloudflare **rate-limiting rule** (Security › WAF) for `/signal*` per address, and **usage notifications** (Notifications) for Workers requests, so you hear before the quota is gone. Both are dashboard settings.
- When the Free quota is spent Cloudflare itself stops running the Worker; whether the static site keeps loading then should be verified once on the deployed site.
- Tested against `wrangler dev` with `node scripts/check-worker.mjs`.

## Running your own relay

- Deploy this repo's Worker to your Cloudflare account: `npm run build`, then `npx wrangler deploy` (change `name` and drop the `routes` entry in `wrangler.jsonc`, or set your own custom domain).
- Allow your own pages: add `"vars": { "ALLOWED_ORIGINS": "https://your.site" }` (comma-separated; the relay's own host is always allowed). Change `RELAY_DAY_BYTES` and the `ratelimits` numbers to taste.
- Point devices at it: Devices › Advanced › Connection server, `wss://your-relay/signal`. All devices of an account must use the same one; a QR code or pairing carries the address.
- The relay holds no data and no keys: a Durable Object per account forwards sealed frames. Self-hosting changes who sees ciphertext sizes and timing, nothing else.

## Tabs

- One tab per browser profile runs the mesh, chosen by a Web Lock named after the pairing's storage key (`src/sync/tabs.ts`).
- Other tabs sync their documents with that tab over a `BroadcastChannel`, with the same `DocMux`; their status shows the syncing tab's links.
- A tab takes over when the syncing tab closes, when it gets no answer from it within 2 s (a frozen background tab), or when the person pairs, joins, changes the code or presses Reconnect there.
- Without Web Locks or `BroadcastChannel`, every tab runs its own mesh.

## Reconnecting

- Event-driven: after sleep, a network change or a reload, the device announces itself (`hello`); the initiator answers with an offer.
- Automatic triggers (visible, focus, edits, a 3-minute safety timer while disconnected) only announce, backing off from 20 s to 15 min while nobody answers.
- Forced triggers (`online`, resume, back-forward restore, Reconnect now) make fresh offers.
- No answer to an offer: retry after 15 s and 60 s, then wait for the peer's hello.
- An HTTP 429 from ntfy pauses publishing for 60 s.
- State exchange repeats 1 s after a link opens and every 30 s, so a lost message heals.

## Status

- Header chip and top of the Devices page: this device (Not syncing, Offline, No other devices, Waiting, Connecting…, Syncing · n of m, Can't reach the connection server).
- Each row: one other device (Syncing, Waiting, Connecting). "Check again" on Waiting rows.

## Removing, leaving, changing the code

- **Remove:** marks the device removed in the account document; every device ignores it until allowed again. Cooperative, not security: it still knows the code.
- **Remove, keys required (#258, S-295):** needs the passphrase. The account key signs the removal of the device's keys (`src/core/key-removals.ts`); every device stops counting its approval, so none verifies its handshake or seals anything to it. Nothing rotates: a device that was off syncs on return as before. No "Allow again".
  - A device that sees the signed removal of its own keys (a stolen one running the normal app) stops syncing and drops its keys; Devices says to join again with a one-time code.
  - Threat model (S-258g): not defended against a removed device running modified code. It still knows the sync secret, so it can see hellos on the mailbox topic and send junk there, but gets no link, document or relay frame.
- **Join again, keys required (S-295):** Devices › Join again or remove this device. Stops syncing and makes new device keys, keeps the data and the account; a one-time code and an approval bring it back. For a removed device, or one that stopped finding the others.
- **Leave this account:** marks this device `left`, forgets the code, and can erase chosen spaces' local copies at the next start.
- **Reset this device's data:** Devices page. One space, or everything (also the account document and the sync code). A safety backup file comes first; the page says about how many changes exist only here (`SyncService.onlyHere`). Erased at the next start (`src/app/reset.ts`), then the space refills from a linked device that keeps it, or the device rejoins with the code. The history log is kept unless chosen.
- **Change the code (accounts not yet switched to device keys, S-311b):** sent over the encrypted link to devices linked at that moment; the others need the new code typed once. The way to lock out a lost device: remove it, then change the code. With keys required the others ignore it (S-258b), so Devices does not offer it.

## Rolling back

- The account-id move (#255) can no longer be rolled back (S-295b): a device folds the old account document into the new one on start and forgets the old id.
- Rolling back device keys slice 2 (#256) to the slice 1 build needs no step: slice 1 ignores certificates, grants, handovers and `required`, and sends no signatures or `vp`, so updated devices seal with the shared key for it. Going forward again, a device whose account id changed meanwhile treats its pin as another account's and pins afresh.
- Rolling back #295 to the #258 build needs no step: it reads the same removal records; it would rotate keys again at the next removal.
- Before shipping a release that moves data, set `backupFirst` in `src/offline/update-meta.json`: the running build then tells people to make a backup before they reload.

## Trust limit

- Every device with the code is equally trusted and can claim to be any device, so a hostile device can ask for any space. The Devices page says so.
- Compatible mode (#255, S-76a–c): each device and the account have key pairs and publish their public keys in the account document; the Devices page shows which devices have keys. The account document moves to the account key's fingerprint id (S-76r).
- Slice 2 (#256): the device holding the account key certifies the others; certified devices sign offers and answers and seal relay frames with pair keys (S-256, S-76f). In compatible mode nothing is refused and the code still admits everyone; a pair whose key fails falls back to the shared key (S-256c). A device pins the account key it follows and ignores unsigned changes (S-256d). Once the account requires keys (slice 3), a device without a certificate gets no document.
- Keys required (#257, S-257–S-257h): the owner reviews the devices and flips a one-way switch; only approved devices sync, new ones join by one-time invite with a code compared on both screens, and the sync code alone gets no link or document. Until an account switches, the first bullet still holds.
- Removal (#258, S-295): signed with the passphrase; no device links to a removed one any more.
- Always on (#311, S-311): a new account is key-required from its first device (the passphrase is asked at "Start syncing") and a joining device always makes keys; an older keyless account switches from a banner on Devices, and a device left out joins again (S-311b).
- Still to come: sharing with other accounts (slice 5).

## Security review (alpha, #203)

What was checked and found sound, so it is not re-derived:

- **Sync code:** 128 bits from `crypto.getRandomValues`; the 10-bit check catches typos only.
- **Keys:** HKDF-SHA256, fixed salt, separate `info` for topic and key. AES-GCM 256-bit, random 96-bit nonce per message; the AAD binds the topic (signaling) or topic, pair and kind (relay).
- **Relay:** topic pattern enforced; room size and per-socket message, frame and byte caps; signaling and link sockets kept apart; stores only byte and request counts.
- **No HTML sink:** no `innerHTML` or `dangerouslySetInnerHTML`; notes are CodeMirror text and links open notes only, so no `javascript:` link runs. The CSP (`public/_headers`) allows first-party scripts only.
- **QR:** drawn as SVG; the payload is parsed and its secret validated.
- **CSV:** `csvField` prefixes cells starting with `=`, `+`, `-`, `@`, tab or CR with `'`.
- **Backup restore:** format and ids validated, each update probed in a scratch document, checksums verified before the merge.
- **Service worker:** same-origin GET only; `/signal/*` untouched.
- **Dependencies:** `npm audit` clean, lockfile committed, CI uses `npm ci`; no secrets in the repo.

Accepted limits (S-203):

- **Replay:** signaling nonces are kept in memory for 5 minutes on the relay's clock, so after a reload an old `hello` is accepted again; relay frames carry no counter. A stale handshake fails at DTLS, Yjs updates are idempotent, and a replayed "switch code" is sealed with a key no longer in use. With device keys (#76) add a per-link counter.
- **Sync code in `localStorage`:** any script on the origin reads it; the risk is XSS, which the missing HTML sink and the CSP close. The derived AES key is already non-extractable. With device keys the code can be dropped after pairing.

## Known limits

- Devices on other networks connect directly only when both routers allow it (STUN is set, device setting in Devices › STUN servers); behind carrier NAT or strict firewalls there is no path until the relay fallback (#169). TURN is not set.
- ntfy.sh rate limits are not guaranteed; it also forwards ciphertext to Firebase for Android push.
- Chrome may hide LAN addresses behind mDNS `.local`; asking for camera permission first makes it use real addresses.
- Cloudflare Workers Free plan: about 100 000 requests a day for the whole account.
- The relay's own budget is 50 000 estimated requests a day (`RELAY_DAY_REQUESTS`, UTC reset): at 80% new data links are refused, at 100% every `/signal` connection is refused and relayed messages are dropped. `RELAY=off` is the manual kill switch.
- The owner gets Cloudflare's usage notification at 85% of the plan limit.
