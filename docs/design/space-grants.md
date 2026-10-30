# Per-space grants: a device gets a space only when someone who may decide says so

Issue #1.
Status: **proposal, waiting for the owner's decisions** (questions at the end).
Threat model: S-258g (strangers on the relay; a lost or stolen device running the normal app; not a removed device running modified code).

## What is built

- Keys required (S-257, S-311): only approved devices sync; signed handshakes and pair keys (S-256, S-76f).
- Space keys, epoch 1 (S-256e, `src/core/key-grants.ts`): a random key per space, wrapped to devices as signed `grant:<space>:1:<device>` records in the account document.
- `allowsDoc` (`src/app/sync-filter.ts`): with keys required, a space and its private part go only to a peer that holds the space's grant.
- Removal (S-295): a signed `removal:` ends a device's certificate; nothing rotates.
- Shares with other accounts (S-259): the owner-signed roster decides which accounts; inside each account its own grants apply.

## The gap

`maintainGrants` wraps the key to **every approved device whose `keeps` cell is ticked**, automatically.
`keeps` is an unsigned map that any approved device writes.

- A lost or stolen phone, not yet removed, running the normal app: open Settings, tick Keep on any space, and a holder hands it the key within seconds.
- In scope under S-258g, so the grant guards nothing a person with the phone cannot undo.

## Proposal

A grant is written only on a decision by someone who may decide; `keeps` stays the device's wish, not its right.

| Who decides | How | Signs with |
| --- | --- | --- |
| A device that holds the space | Its person ticks the cell for another device in the Your data table, or presses **Allow** on a request | Its device key (as grants are signed today) |
| Whoever has the passphrase | On any device, also the asking one: ticking a space it lacks offers "Enter the passphrase to allow it here" | The account key (S-257e: passphrase = owner) |

- **Asking.** On a device that lacks a space, ticking Keep writes the wish (`keeps`) and shows "Waiting for another device to allow it" in the cell. Every device that holds the space lists the request under **Needs you** ("Phone asks to keep Work": Allow, Decline), like a join request (F-33s).
- **Decline** writes `declined:<space>:<device>` (unsigned, cosmetic: it only hides the request; asking again shows it again).
- **Stopping.** Unticking on the device itself stops it asking; its grant stays (harmless while unticked).
- **Taking a space away** from another device: a holder or the passphrase signs `revoke:<space>:<device>`; every device pins it (`localStorage`, raised only, as removals, S-259c) and stops serving that space to it. Like removal, it does not claim to recall what was synced (S-76g). A new grant after a revoke needs a higher counter (`grant` carries `n`), so an old grant cannot come back.
- **No rotation.** Space keys still encrypt nothing (S-295); the grant is an authorisation, checked by every honest peer.
- **Shares.** Unchanged gate between accounts (the roster); inside a member account, its devices follow the same rule for the shared space.

## Migration (F39)

- Grants already written stay valid.
- First start of the new build: each holder runs today's automatic pass **once** (wraps to every approved device that keeps the space now), then marks it done (`grants-explicit` in `localStorage`). Testers lose nothing; the window is the one pass.
- Older builds keep wrapping automatically until they update; an account mixing builds behaves as today until then. Documented as an accepted limit, with no version gate.
- Obsidian plugin (O-257): its "keep this space" setting becomes a request, answered from the app; the plugin shows "Waiting for approval".

## What this does not do

- Defend against an approved device running modified code (S-258g, out of scope): it can serve spaces it holds to anyone, and since a grant names its key by `kid` without proof, it could sign a grant to itself that peers count. Closing that needs grants that only a holder or the account key may sign, checked as a chain; a known limit until then.
- Hide which spaces exist: names stay in the account document, so every device sees them.
- Change the private part: it follows the space's grant, as now.

## Cost

- `maintainGrants`: stop the automatic wrap after the one-time pass; grant on Allow, on a holder's tick, or with the account key.
- `revoke:` records and pins; `allowsDoc` also checks "not revoked".
- Settings table: the waiting state and the passphrase offer; Needs you: requests.
- Obsidian: waiting state.
- Tests: unit (grant rules, revoke pins, migration pass) and an e2e (ask, allow, decline, revoke, passphrase path).

## Questions for the owner

1. **Who may allow:** a holder device or the passphrase (recommended), or the passphrase only (simpler, but every new space on a new device then needs it)?
2. **Requests under Needs you** on every holder, like join requests: yes? Recommended.
3. **Take a space away from another device** (`revoke:`), in this issue or later? Recommended in this issue: without it a wrong Allow cannot be undone except by removing the device.
4. **Migration:** one automatic pass for today's kept spaces, then explicit only: acceptable?
5. **Priority:** #1 is in the Later milestone. Build it before sharing with other people more widely (the issue's context says so), or leave it as a known limit for the alpha?
