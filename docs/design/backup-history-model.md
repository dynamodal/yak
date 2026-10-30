# Backup, history and deleted items: one model

Issues #96 (what backup, restore and history each do), #107 (deleted items) and #97 (Backup becomes a Settings section).
Status: **proposal, waiting for the owner's decisions** (questions at the end).
No code changes until approved.

## Problem today

Four things sit on one page and look alike, but they are different in kind:

| Today's label | What it really is | Scope |
| --- | --- | --- |
| Backups in the folder + Restore… | Full copies written to a folder you chose | This device writes; the folder is outside the app |
| Restore to a time… | Rebuild from the folder's restore points and logged segments | Folder |
| Go back in time / days with changes | Browse this device's own change log (`HI1`, `HI10`) | This device only, not synced |
| Notes › Version history | Same change log, for one note, plus named versions | This device only (named versions too) |
| "Recently deleted" in Notes, Undo toast in Time | Soft delete: the record stays with `deleted: true`, restorable for 45 days | Synced with the data (Yjs) |

The owner cannot tell which is a backup and which is history, what is shared between devices, and what a restore does to the current state.

## The model: three layers

Everything the owner can undo belongs to exactly one layer.
The UI names the layer, in the same words everywhere.

| Layer | Name in the UI | Where it lives | Synced? | Answers |
| --- | --- | --- | --- | --- |
| 1. Soft delete | **Recently deleted** | In the data itself | Yes, with the data | "I deleted that by mistake" |
| 2. Change log | **History** | This device's IndexedDB (`HI1`) | No: each device keeps its own | "What did this look like yesterday / before that edit?" |
| 3. Backups | **Backups** | A folder (or downloaded file) outside the app | No: files you keep | "My browser lost everything" or "go back to a state from weeks ago" |

Rules that hold for all three:

- **Nothing destructive happens without a way back.** Every action that replaces or rewrites state first keeps the state it replaces (table below).
- **Restore always adds, never rolls back the log.** Applying old values is a new edit (`HI5`). Later work is kept unless the owner explicitly asks for Replace.
- **Say the scope in the title.** History: "on this device". Recently deleted: "on all your devices". Backups: "in your backup folder".

## What each action does to the current state, and where the undo is

| Action | Effect on current state | Safety copy kept | Where the undo is |
| --- | --- | --- | --- |
| Delete an entry, note, project, client, tag | Marked deleted, stays in data | The record itself | Recently deleted (layer 1), within the retention below |
| Restore a deleted item | Item returns; its edits since stay | Delete is in history | History |
| History: restore chosen items / a note version | Old values written as new edits; the rest untouched | The replaced values are in the log (layer 2) | History again: the pre-restore point is in the day list, **new: the confirmation names it** ("Before this restore, at 14:32") |
| Backup: **Merge into this device** | Adds what is missing; changes nothing existing | Nothing replaced, so none needed | n/a (additive) |
| Backup: **Replace local data** | Device becomes exactly the backup | A fresh backup in the folder and a copy on the device | "Merge it back" on the Backup section, **new: stays visible until dismissed or 45 days**, and the confirmation names the safety backup by time |
| Restore to a time | Opens the ordinary restore panel with a rebuilt state | As Merge or Replace | As Merge or Replace |

Gaps found in the current build that this model closes:

1. History restore keeps the old state only in the log, which is thinned (60 days, then daily, then monthly; `HI6`). The confirmation should say so and offer the named save: "Save a named version first" for notes, and for entries a "Before restore" mark in the log. **New: a history restore writes a log mark ("Before restore") so the pre-restore point survives thinning and is easy to find.**
2. "Merge it back" is a hint line far from Replace and disappears from sight after reload. It moves next to the Replace result and the Backups list.
3. Replace on a paired device changes only this device and peers send data back (`backup.md`). The Replace confirmation must say this in one sentence, because it is the surprising part.

## Deleted items (#107)

Today: entries 45 days (`RESTORE_WINDOW_DAYS`), notes 45 days (`NOTE_RESTORE_DAYS`, by `updated_at`), listed in Notes ("Recently deleted") and the Timer view only.
Files: `deleteFiles` marks the index entry deleted and **drops the bytes at once** on every device. The only way back is a backup. Projects, clients, tags: soft deleted, no list, no window.

Proposal: one **Recently deleted** place, a Settings section (see below), with a list per kind, newest first, each row with **Restore** and the date it will be gone:

| Kind | Window | Restore |
| --- | --- | --- |
| Time entries | 45 days | existing `restoreEntry` |
| Notes and tasks | 45 days | existing `restoreNote` |
| Projects, clients, tags | 45 days (needs `deleted_at`; older ones have none, so they show as "date unknown" and never expire from the list) | un-delete |
| Files in notes | Not recoverable once deleted: bytes are dropped. Option A: keep the bytes 45 days (delay `dropDeletedBytes`). Option B: say plainly "files are deleted for good; a backup is the only way back" next to the Delete button | A: restore; B: none |

The retention table is also stated in the Delete confirmation/toast and in the user guide, one sentence per kind.
No data migration: `deleted_at` is optional and absent means "unknown date", which keeps showing (F39).

## Interface

Reuse the Notes version-history navigator, which works well: **a list of points on the left (when, who/where, one-line summary), the chosen point's diff or contents on the right, one primary button, a closing line saying where the undo is.**

- One **History** navigator opened from Settings › Backup & safety and from each note (already there). It browses layer 2 only: days with changes, then points, then the compare view (already built, `HistoryBrowser`).
- One **Backups** navigator for layer 3: the list of backups in the folder (newest 50) as points; choosing one shows the counts and diff against now (what Merge would add, what Replace would remove), then the buttons. "Restore to a time" becomes a date picker inside this navigator instead of a separate button.
- **Recently deleted** list as above.
- Confirmation text template: *"This will <effect>. Your current data is kept as <safety copy>. To undo: <where>."* Replace additionally requires ticking a checkbox that names its effect; Merge stays one click.
- Mistake hardening: Replace is not offered on the first screen of a backup, only after the diff has been viewed; the default button is Merge.

## Backup as a Settings section (#97)

Backup & restore stops being a page and becomes a collapsed section of the Settings page, like Advanced (`F-33x`, `F-33zs`).
It keeps `#/settings/backup`; the old `#/backup` route redirects there.

- Collapsed summary: last backup (or "Backed up by <device>"), warnings, **Back up now**.
- Open, in this order: **1 Where backups go** (folder, schedule, download), **2 Encryption and passphrase** (merge the Encrypted backups panel and the Passphrase section), **3 Restore** (the Backups navigator, Merge/Replace, Restore to a time), **4 History** (the History navigator and warning thresholds, which now sit in General), **5 Recently deleted**.
- The Settings contents row keeps its "Backup and safety" chip; the dot logic is unchanged.
- The user guide (`docs/user/backups.md`) is rewritten around the three layers; the in-app help link points to it.

## Order of work after approval

1. Model copy and confirmations (words only, history "Before restore" mark, Merge-it-back visibility).
2. Settings section move (#97), route redirect, tests, a11y suite.
3. Recently deleted section and retention text (#107), plus the file decision.
4. Backups navigator (diff before restore) in its own PR if it grows.

Each step ships with a `docs/user/changes/` entry and decision rows; no stored-data format changes, so no migration.

## Questions for the owner

1. **Three layers and names** (Recently deleted, History, Backups): approved? History is per device and not synced; is that acceptable, or should the log eventually sync?
2. **Files in notes:** keep deleted file bytes 45 days so they can be restored (A, uses disk), or leave them deleted at once and say so (B)? Recommendation: A, since this is the one deletion that cannot be undone today.
3. **Projects, clients and tags** in Recently deleted with a 45-day window: yes? Recommendation: yes.
4. **Replace friction:** only offered after viewing the diff, with a checkbox: right level? Recommendation: yes.
5. **Settings section order** as listed (folder, encryption, restore, history, recently deleted)? Recommendation: yes.
6. **Scope of the first PR:** words and confirmations first (1), then the section move (2), or everything in one PR? Recommendation: separate PRs per step above, since the repo prefers fewer PRs but step 2 touches Settings layout the later Settings-polish session also works on.
