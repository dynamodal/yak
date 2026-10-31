# Relay usage for the operator and for users

Issues #110 (why the relay instead of a direct connection) and #109 (relay usage for the operator and for users).
Status: **agreed with the owner 2026-10-30** (decisions at the end); #110 built, #109 next.
Threat model: S-258g. Privacy rules: `docs/user/privacy.md`, #5's cautions.

## Diagnostics (#110): built

`docs/sync.md` › Why not directly; decisions S-110, S-110b.

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

### Users (Devices page, relay details)

- Keep "Relay: 3 devices connected · 420 messages today" for the account's own room.
- Add the relay's totals for everyone: accounts and devices connected now; accounts, devices and shared spaces active today; today's share of the allowance as a percentage; a 24-hour graph of messages per hour.
- Over 50% of the allowance: "The relay has used over half of today's shared allowance; direct sync is not affected."
- Served with the room's existing `GET /signal/<topic>/stats` answer, so no new billed request.
- No rounding while only testers use it; #5 (public to strangers) adds rounding.

## Privacy page changes

- What the relay keeps: per day, the kind of each room (account, share, one-time code) and its most devices connected at once, as hashes until UTC midnight; daily totals (counts only) for 30 days.
- Every user sees the relay's totals: accounts and devices connected now and today, shared spaces today, the share of the allowance used, messages per hour. No per-room figures.

## Slices

1. #110: built.
2. `feat/` #109: `RelayBudget` hours and room counts, `k=` label, `admin/usage`, operator page graph and projection, user load line; privacy page; `docs/sync.md`. `Closes #109`.

## Decisions (owner, 2026-10-30)

1. Offers carry public (STUN) addresses (fix A).
2. Diagnostics on for everyone, kept on the device; the connection report is the opt-in.
3. Rooms are labelled by kind (`k=a|s|i`).
4. Users see the totals above, including connected now; `privacy.md` says so.
5. Operator numbers: the relay's own estimate only.
6. Upgrade backoff 1, 2, then 5 min at most.
