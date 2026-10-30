# Backups, version history and recently deleted: one model

Issues #96 (what backup, restore and history each do), #107 (deleted items) and #97 (Backup leaves its own page).
Status: **agreed with the owner on 2026-10-30**; built in four PRs (end of this note).

## Problem today

Four things sit on one page and look alike, but differ in kind:

| Today's label | What it really is | Scope |
| --- | --- | --- |
| Backups in the folder, Restore… | Full copies written to a folder | Files outside the app |
| Restore to a time… | Rebuild from the folder's restore points and logged segments | Folder |
| Go back in time, days with changes | This device's change log (`HI1`, `HI10`) | This device |
| Notes › Version history | Same log, one note, plus named versions | This device |
| "Recently deleted" in Notes, Undo toast in Time | Soft delete, restorable 45 days | Synced with the data |

The owner could not tell backup from history, shared from per-device, or what a restore does to the current state.

## The model: three layers

Every undo belongs to exactly one layer, named the same everywhere.

| Layer | Like | Stored where | Method | Synced |
| --- | --- | --- | --- | --- |
| **Recently deleted** | Trash can | Inside the data | Record marked deleted | Yes, with the data |
| **Version history** | Version history | A separate database in the browser | Log of every change | Not yet: each device records its own |
| **Backups** | External drive | Files in a folder outside the browser, or a download | Full copies plus a change log | No: they are your files |

Rules for all three:

- Nothing destructive happens without a way back: every action that replaces state keeps what it replaces.
- Restore adds; it never rolls the log back. Old values are written as new edits (`HI5`); later work stays unless the owner picks Replace.
- Each section says what it covers and where it is stored, in one line at the top.

### Version history is designed to sync later

History will probably sync between devices later (owner), tagged with the device and account that made each edit.
So it is defined by what it is; "this device only" is today's limit, not its definition.

- Wording: "Earlier versions of your time entries, notes and tasks. For now each device records its own; this list shows versions recorded on this device."
- Every point carries a source (device, later account) and shows "Recorded on: This device"; nothing in UI or code assumes one device.
- Syncing it later is an `idea` issue, as is covering projects, clients, tags and settings.

## What restore covers

| Restore from | Covers |
| --- | --- |
| A backup (Merge or Replace) | Everything: entries, notes and tasks, projects, clients, tags, settings, files in notes |
| Version history | Time entries, notes and tasks; not projects, clients, tags or settings (`HI11`): their edits (a rename) cannot be undone here, deletes come back through Recently deleted |
| A note's version history | One note's text |
| Recently deleted | One item of any kind |

## Each action, its effect and its undo

| Action | Effect | Safety copy | Undo |
| --- | --- | --- | --- |
| Delete any item | Marked deleted | The record | Recently deleted, 45 days |
| Delete for good (from Recently deleted) | Content cleared on all devices; a contentless marker stays for sync | Older backups and Version history may still hold it, and the confirmation says so | Backups |
| Restore a deleted item | Item returns | — | Delete again |
| Version history restore | Old values as new edits | Pre-restore state in the log, plus a **"Before restore" mark** so it survives thinning (`HI6`) | Version history; the confirmation names the mark |
| Backup: Merge | Adds what is missing | Nothing replaced | — |
| Backup: Replace | Device becomes the backup | Safety backup in the folder and the old data on the device | **Merge it back**, visible until dismissed or 45 days |

## Recently deleted (#107)

Every kind 45 days, newest first, each row with **Restore**, **Delete for good** (confirmed) and the date it goes.

| Kind | Today | Change |
| --- | --- | --- |
| Time entries | 45 days, `deleted_at` | Listed here too |
| Notes and tasks | 45 days by `updated_at` | Listed here too |
| Projects, clients, tags | Soft deleted, no list | Add `deleted_at`; older deletes show "date unknown" and never expire by themselves |
| Files in notes | Bytes dropped at once on every device | Kept 45 days (delay `dropDeletedBytes`), then dropped |

- Account setting (synced, since a file delete reaches every device): **Delete files for good straight away**, default off.
- Delete for good confirmation: "Delete "X" for good on all your devices? It can no longer be restored from Recently deleted. Older backups and this device's Version history may still hold a copy."
- No migration (F39): `deleted_at` is optional; absent means "date unknown".

## Replace is hard to do by mistake

1. Choosing a backup shows the diff against now: what Merge would add, what Replace would remove (counts per kind, then items).
2. Replace is offered only after that view; Merge stays the default, one click.
3. Confirmation: "This makes this device exactly like the backup from <time>. Removed: <counts>. Your current data is kept as a backup at <time> and on this device. To undo: Settings › Backups › Merge it back." Plus a checkbox naming the effect.
4. Paired device: "Only this device changes. Your other devices will send their data back when they connect."
5. Merge it back stays visible until dismissed or 45 days.

## Interface

- Navigator pattern of Notes version history: points on the left (when, recorded on, summary), contents or diff on the right, one primary button, a closing line naming the undo.
- Three Settings sections, each with a contents chip, a one-line description and its own anchor:
  1. **Backups** (`#/settings/backups`; `#/backup` and `#/settings/backup` redirect). Closed: last backup or "Backed up by", warnings, **Back up now**. Open: where backups go (folder, schedule, downloads), the encrypted-only switch with "Uses your passphrase → set it", restore (backups navigator, Restore to a time as a date inside it, Merge it back).
  2. **Version history**: the History navigator and the warning thresholds.
  3. **Recently deleted**: all kinds, retention per kind stated once.
- The passphrase stays its own Settings line: it also approves devices and shares (F-309, F-324).
- The Notes and Timer "Recently deleted" lists stay and link to the section.
- User guide `docs/user/backups.md` is rewritten around the three layers.

## Build order (owner, 2026-10-30)

One PR each, in this order; each adds decision rows and a `docs/user/changes/` entry.

1. **Wording and safeguards:** user guide, section descriptions, confirmation texts, Replace safeguards 3–5, "Before restore" mark. No layout change.
2. **Three Settings sections (#97):** layout, redirects, passphrase link, tests, a11y suite.
3. **Recently deleted (#107):** all kinds, Delete for good, `deleted_at` on projects, clients, tags and files, 45-day file retention, the account setting.
4. **Backups navigator:** diff against now; Replace only after it (safeguards 1–2). Closes #96.
