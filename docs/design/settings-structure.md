# Settings structure: one long page, a contents row, rows that open in place

Issues #22 (the problem) and #33 (the UI direction, `ui-direction.md`).
Status: agreed with the owner in a design review (2026-10-28); not built.
Builds on F-326, F-326b and F-334 (`decisions/settings.md`); reverses part of F-326b.
Replaces the earlier proposal in this note (a page per device, Add and Connection pages), which the owner set aside.

## Problem

The owner finds Settings hard to use: things are sometimes hidden, hard to find, hard to understand.
A UI review (2026-10-27) found five causes:

| # | Cause | Example today |
| --- | --- | --- |
| 1 | Every device link opens one long page | `#/settings/devices/<id>` and `/add` only scroll inside `DevicesView.tsx` |
| 2 | Lines appear and disappear with state | No Sync or Passphrase line before the first pairing (F-326b), so a newcomer cannot find where sync is |
| 3 | Time-limited requests show where you are not looking | A 15-minute join request sits below the QR code |
| 4 | Wording describes the internals | "removed or missed a change", ids, fingerprints, "Device keys" on the main path |
| 5 | Devices go unnamed | Columns read `cf9fe69d` or "Chrome on Linux" twice |

The must-do fixes for the coworker alpha (#20) patched 3 to 5 in place; this note is the structure.

## Goals and non-goals

- Every thing has one fixed place, found from a contents row at the top, the same whatever the state.
- What needs action now sits at the top of Settings, not inside a detail page.
- Plain words on the main path; internals behind Advanced.
- One column at every width: no layout that needs two columns, no spaces-by-devices table (it does not fit a phone).
- Not a goal: changing sync, keys or stored data (no migration, F39).
- Not a goal: a sub-menu, a new tab or a Settings sheet (rejected in F-326b: F14, F21; the owner still prefers one long page).

## Design

### One page, many sections

`#/settings` is one scrolling page of cards, in this order.
A contents row sits under the title: one chip per section, with a status dot where it matters.
A chip scrolls to its section; every section heading has a link icon, and `#/settings/<section>` opens the page scrolled to it (so help text and issues can link to one section).

| Section | Holds |
| --- | --- |
| Needs you | Only while something is pending: "Phone asks to join · Review (12 min left)", "No backup yet · Set up". Each row opens where it is answered |
| Backup and safety | Backup (always: "No folder chosen" or "Last backup 10:42"), Passphrase (always: "Not set", "Locked", "Unlocked 4 min"), Restore and history (link to `#/settings/backup`) |
| Devices and sync | Sync (always: "Off · Set up", "On · waiting for your first device", "On · 2 devices"); one row per device; "Add a device" |
| Spaces | One row per space; "New space" |
| Sharing | Other accounts (F-334), "Share a space" |
| Display | Theme, week start, hours format |
| Features | Switches for Timer, Notes, Tasks, Import and mirror (`features.ts`); the timer switch also controls the header pill |
| Help | Guide, What's new, Keyboard shortcuts, Report a problem, About |
| Advanced | Connection server, STUN and network stats, device keys and ids, debug log, Reset this device's data |

- Status lines are always shown (reverses part of F-326b, which showed Sync and Passphrase only after pairing); Import stays a registered line (`registerDataLine`).
- A section is fixed in place; its rows change with state, never the section.
- Advanced is its own section, apart from Help; it opens in place.

### Rows open in place

- A device row: name, "Chrome on Linux · seen 2 min ago · keeps Personal, Work".
  Opening it shows the spaces it keeps as toggle chips, Rename, and Remove… (another device) or Leave this account… (this one).
- A space row: name and "on 2 devices".
  Opening it shows the devices that keep it as toggle chips, Rename, Archive, and Remove (the old `SpaceView`).
  Both toggles write the same `keeps` record, so they never disagree.
- An account row (Sharing): your label, the spaces shared with it, since when, and End share (the old `AccountView`).
- An unnamed device reads "Unnamed device · Rename" (#20 asks for a name when a device joins).
- Detail routes stay only for flows that need a whole screen: adding a device (the code or QR, a request that appears above the code, a name for the new device), Backup and restore, and Import.
  Old `#/settings/devices/<id>`, `#/settings/space/<id>` and `#/settings/account/<fp>` open `#/settings` with that row open (`legacyRoute`).

### Words

| Today | Proposed |
| --- | --- |
| Device keys | Advanced › Device keys and ids |
| this device was removed or missed a change | (only when it is true) This device was removed from your account · Join again |
| link open | Link open · 12 min left · Cancel |
| Not syncing (before any device) | Sync off · Set up |

## Options for the one-time code (separate decision)

Today: 26 base32 characters plus 2 check characters, shown as `ABCD-EFGH-…` (`src/sync/pairing-secret.ts`); 0, 1 and 8 already read as O, I and B, and a typo is caught by the check characters.
A newcomer review still found it long to type on a phone.

| Option | For | Against |
| --- | --- | --- |
| A. Keep the code; make the QR or link the first path on phones and typing the fallback | No protocol or format change | Typing stays long when no camera |
| B. A short code (about 8 characters) used once for a PAKE-style handshake over the relay | Easy to type | New protocol and security review; the 128-bit secret's guarantees change |

Recommendation: A (part of #20's "QR first"); B only if testers still struggle.
Still open for the owner.

## Slices

One PR each, `Refs #33` (slices 1 and 2 are slice 4 of #33's list).

1. The page: contents row, always-on status lines, Needs you, Backup, Display, Features, Help, Advanced as sections; Device keys moves into Advanced (absorbs #21).
2. Devices, Spaces and Sharing as rows that open in place; redirects from the old detail routes; e2e updates.
3. Add a device as its own flow (request above the code), if not already so.
4. One-time code option A, if not done in #20.

The Settings page and the new look are separate PRs: build the page on the old look, restyle after, or the other way round, whichever lands first.
