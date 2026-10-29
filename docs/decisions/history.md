# Decisions: version history

Built in #52. Incremental backups, restore points, restore to a time and encrypted mode are built (`../backups.md`, `backup.md`).

Not built:
- Edit attribution (Yjs client id to device) and "undo what one device did since T".
- Sending the log to a new device.
- Encrypt files already in the folder when the mode is switched on.

| # | Decision | Why |
| --- | --- | --- |
| HI1 | Each device keeps an append-only change log per document (IndexedDB `<prefix>-history`), not Yjs snapshots or `gc: false` | Yjs items carry no wall-clock time |
| HI2 | Updates merged per segment (`Y.mergeUpdates`), flushed after 60 s, on hide and on close; first segment is the whole state (baseline) | Per-keystroke logs were 18× larger (measured) |
| HI3 | One writer tab (Web Lock `app-history-writer`) | Two tabs would log twice |
| HI4 | Time travel = replay segments up to a time; accurate to about a minute | A segment cannot be split |
| HI5 | Restore applies old values as new edits, never rolls back; stamps `restored_at` | Later good work is kept (owner H4) |
| HI6 | Thinning: every change 60 days, then one per day to a year, then one per month | Owner H1 |
| HI7 | Notes: version list from the log, line diff, restore as one minimal edit, named versions keep their own text | Survives thinning |
| HI8 | Deleted notes restorable for 45 days, like entries | Owner H7 |
| HI9 | Warning banner: 10 deleted or 25 entries older than 14 days changed within a minute; settable; restores and imports never trigger it | Owner H3 |
| HI10 | History is per device and not synced | A device that joins later has no earlier history |
| HI11 | The History tab covers time entries, notes and tasks at one "As of" time (notes: deleted or changed since, text diff, restore); projects, clients, tags and settings are not covered, and the page says so | Owner found the tab confusing (B25); notes still have their own Version history for one note |
| HI12 | The History tab browses the log: days with changes (newest first, 14 per page), then a day's points (one per segment, summarised on demand from the Yjs transaction's changed records); a point sets the exact compare time, "As of" stays for jumping | Owner, 2026-10-17 (#103); empty days skipped; summaries only for the opened day keep 200 points quick |
