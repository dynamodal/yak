# Why the relay, and how much of it: connection diagnostics and relay usage

Issues #110 (why the relay instead of a direct connection) and #109 (relay usage for the operator and for users).
Status: **proposal, waiting for the owner's decisions** (questions at the end).
Threat model: S-258g. Privacy rules: `docs/user/privacy.md`, #5's cautions.

## What the code does today (#110)

- `PeerLink` makes one `RTCPeerConnection` per attempt, STUN from `ice-servers.ts` (Cloudflare, Google), no TURN.
- No trickle: the offer or answer waits for ICE gathering (at most 4 s), then goes out once through the signaling mailbox.
- Every description passes `encodeSignal` → `trimSdp` (`signal-codec.ts`), which **keeps only UDP host candidates** and drops srflx (STUN), relay, TCP, link-local, `fe80:` and 100.64/10.
  - Written when codes were pasted or scanned and had to fit a QR code. Today the only caller is the mesh, through the sealed mailbox (8 KiB a message), so the reason is gone.
- Chrome and Firefox replace host addresses with mDNS `.local` names unless the origin holds camera permission; `begin()` asks for it once (`real-addresses.ts`), shares never ask (`realAddresses: false`).
- No direct link 5 s after an offer or answer → relay data link. While on the relay the initiator offers again every 60 s, forever, with the same settings.
- The debug log already has `ice candidate <type>`, ICE state changes and, on success, the selected pair's types and RTT (`logSelectedPath`). Nothing records why an attempt failed.

## Why two devices on one home network may stay on the relay

| # | Cause | Why it fails | Intermittent? |
| --- | --- | --- | --- |
| 1 | STUN results thrown away (`trimSdp`) | Only LAN addresses are offered; any pair that is not on one flat LAN, or whose LAN path is blocked, has no candidate left that could work | No: structural |
| 2 | `.local` names not resolved | Without camera permission both sides send only mDNS names; resolving them needs multicast, which mesh Wi-Fi, guest networks, band steering and managed laptops often block | Yes: camera grant "only this time" lapses, mDNS caches expire |
| 3 | Not on the same network at that moment | Phone on mobile data (weak Wi-Fi), laptop on a VPN; with cause 1 there is then no path at all | Yes |
| 4 | VPN or browser policy hides addresses | Full-tunnel VPN, "block local network", or managed Chrome `WebRtcIPHandlingPolicy` leave only a VPN or no host candidate; 100.64/10 is dropped on purpose | Yes: VPN up or down |
| 5 | AP or client isolation | Router forbids device-to-device traffic on Wi-Fi | No |
| 6 | Host firewall | Inbound UDP blocked on a managed laptop; works only when the other side starts the checks | Depends on who answers |
| 7 | Upgrade never changes anything | The 60 s re-offer repeats the same candidates, so causes 1, 2, 5 fail every time and each try costs signaling requests | No |

Cause 1 is the likeliest single reason; it also means the Known limits line "devices on other networks connect directly when both routers allow it" is not true today.

## What Tailscale's NAT traversal teaches, and what a browser can use

| Technique | In a browser? | Use here |
| --- | --- | --- |
| Offer every candidate kind (LAN, public via STUN, IPv6) and let checks find the best | Yes | Stop trimming (fix A) |
| Two STUN servers to tell an easy NAT from a hard one (same mapped port or not) | Partly: two srflx candidates with different ports mean a port that varies per destination | Record as `nat: same-port / varies / unknown`, never the port |
| Keep a relay (DERP) working while probing for a direct path, upgrade in place | Built (relay fallback, handover) | Keep |
| Probe again on network change, not only on a timer | Built for `online`/resume; add `navigator.connection` `change` where present | Fix C |
| Back off probes that keep failing the same way | No cost to add | Fix B |
| LAN discovery by exchanging local addresses through the control plane | Built (signaling) but the browser hides them as mDNS | Camera grant (built), hint on the device page |
| UPnP / NAT-PMP / PCP port mapping, birthday-paradox port spraying, raw UDP pings | No | Out of reach |
| TURN | Possible, costs money or a server | Not proposed; the relay link plays DERP |

## Quick fixes (one PR with the diagnostics)

- **A. Send public candidates:** keep srflx and global IPv6 UDP host candidates; still drop TCP, link-local, 100.64/10 and relay. Older builds take them as they are (`decodeSignal` does not trim), so no protocol change.
  - Privacy: the other device (and, for a share, the other account's devices) learns this device's public address, which it learns anyway once a direct link opens. `privacy.md` says so.
- **B. Back off upgrades:** while on the relay, re-offer after 1, 2, 5, then every 15 min when the last attempt failed at the same stage; a network change or Reconnect starts again at 1 min.
- **C. Re-offer on a network change:** `navigator.connection` `change` (feature-detected) counts as a forced trigger.

## Diagnostics (#110)

Computed on the device from its own peer connection; nothing new is sent anywhere.

- One record per attempt, per peer, last 20 kept in memory:
  - trigger (`hello`, `retry`, `direct path check`, `network change`), role (offer or answer)
  - local and remote candidate counts by kind: host IP, host `.local`, srflx, prflx; IPv4 / IPv6
  - STUN answered (any srflx), NAT `same-port / varies / unknown`
  - same public address as the other device: yes / no / unknown (compared on the device, the address is not stored)
  - camera permission state (real addresses or `.local`)
  - stage reached: `no answer` → `no candidates` → `checks failed` (pairs tried) → `secure channel failed` → `open`
  - on `open`: selected pair kinds and protocol, RTT bucket; time to open
- One debug-log line per attempt, e.g. `attempt offer retry: local host 1 mdns 1 srflx 2, remote mdns 1, same public yes, checks failed (4 pairs)`. No addresses, ports or names.
- Device row, when on the relay: "Syncing through the relay: last direct try failed at the connectivity check" and a plain hint from a small table:

| Pattern | Hint |
| --- | --- |
| Both sides only `.local`, same public address | Your browsers hide local addresses. Allowing the camera on both devices lets them find each other. |
| Remote sent no candidates | The other device's browser or VPN hides its addresses. |
| Different public addresses, NAT `varies` on either | The devices are on different networks and one router allows no direct path. |
| Same public address, checks failed with IP candidates | The network keeps devices apart (guest Wi-Fi or isolation), or a firewall blocks it. |
| No answer | The other device did not reply in time. |

- **Copy connection report** on the device page: the last attempts with both sides as "this device" and "other device", app version and browser family. No ids, names, addresses or ports; shown in full before copying, like Report a problem.

## Relay usage (#109)

### Operator (`#/settings/network`, admin key)

Works without Analytics Engine: the numbers come from `RelayBudget`, which already counts the day's estimated requests.

- **Today against the cap:** estimated requests used, `RELAY_DAY_REQUESTS`, the 80% data-link cutoff, and Cloudflare's plan limit (100 000) as a second mark.
- **Projection:** used + (rate over the last 3 hours × hours to UTC midnight); "on pace for about 31 000 (62%)". Says the estimate errs low.
- **24-hour graph:** per-hour estimated requests (24 counters kept in `RelayBudget` with the day), drawn as plain SVG bars on the page; split signaling / data links / sockets.
- **Counts for today (counts only):** account rooms, share rooms, one-time-code rooms; devices (sum of each account room's most devices connected at once); data-link pairs opened; share of messages on data links.
  - Rooms tell their kind from a `k=a|s|i` query on the socket URL, set by the app; the relay already sees every room, the label only sorts them. Unknown kind (older builds) counts as "other".
  - Rooms report their kind and peak with their existing batched budget report, so no new billed requests.
  - Stored as room hashes until UTC midnight, like the address tallies; daily totals (counts only) kept 30 days for a trend line.
- Spaces inside one account are invisible to the relay and stay so; only shared spaces have a room of their own.
- A separate endpoint, `GET /signal/admin/usage`, same bearer key; `admin/stats` (Analytics Engine) stays for per-hour bytes.

### Users (Devices page)

- Keep "Relay: 3 devices connected · 420 messages today".
- Add one line only when the relay is busy: "The relay has used over half of today's shared allowance; direct sync is not affected." Level only (under 50 / 50 / 80 / 100%), no counts of accounts or devices (#5's cautions; #5 stays an idea).

## Privacy page changes

- Debug log: per-attempt connection details (kinds and counts of addresses, stage reached); no addresses.
- Between your devices: each device now also sends its public address (from STUN) to the other devices it links with, and in shares to the other account's devices.
- What the relay keeps: per day, the kind of each room (account, share, one-time code) and its most devices connected at once, as hashes until UTC midnight; daily totals for 30 days. Only the operator sees them.
- Users see the relay's overall load as a level, never counts.

## Slices

1. `fix/` + `feat/` #110: fixes A–C, attempt records, log line, device-row reason, connection report; privacy page; changes entry. `Closes #110`.
2. `feat/` #109: `RelayBudget` hours and room counts, `k=` label, `admin/usage`, operator page graph and projection, user load line; privacy page; `docs/sync.md`. `Closes #109`.

## Open questions

1. Send public (STUN) addresses in offers, fix A? Recommended: yes.
2. Diagnostics on for everyone (kept on the device, nothing sent) or behind a switch? Recommended: always on; the report is the opt-in.
3. Label rooms by kind (`k=`) so the operator can tell accounts, shares and one-time codes apart? Recommended: yes.
4. What users see: a load level only when busy, no counts? Recommended: yes.
5. Operator numbers: the Worker's own estimate only, or also Cloudflare's exact count through the GraphQL API when `CF_API_TOKEN` is set? Recommended: estimate only; Cloudflare's dashboard and alerts (#8) are the truth.
6. Upgrade backoff 1, 2, 5, 15 min (fix B)? Recommended: yes.
