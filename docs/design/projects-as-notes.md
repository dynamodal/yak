# Projects and clients as notes

Issue #12.
Status: **design agreed** (owner's answers below, decision T-12 in `decisions/time.md`); build after #147, #138 and #93.
Owner decision (2026-10-30, in #12): one list; a project and a client are Markdown notes; a task's `projects: [[<name>]]` is a real link; UUIDs stay internal; rates stay private.

## Today

| List | Where | Used by |
| --- | --- | --- |
| Timer projects and clients | `projects`, `clients` maps in the space's shared part (UUID, `name`, `client_id`, `color`, `billable`, `active` / `archived`); rates in the private part (`project_rates`, `src/core/rates.ts`) | Time entries (`project_id`), pickers, Reports, Organize, Toggl import, bulk edit, move to space |
| Task projects | `projects` front matter of task notes: free text or `[[Name]]` (TaskNotes) | Tasks › Projects (N37), board filter (N43), the property picker (`property-choices.ts`), Make this a task (N36) |

Nothing connects the two: N19 starts a task's timer without a project.

## Target in one picture

```text
Work/                         ← the space's folder (mirror, Obsidian)
  Clients/
    Client A.md               type: client
  Projects/
    Project X.md              type: project, client: "[[Client A]]", color, billable
  Tasks/
    Write spec.md             tags: [task], projects: ["[[Project X]]"]
```

- The note is the single source of truth for everything a person edits: name (the file name), client, colour, billable, archived, body.
- The `projects` / `clients` records stay as the **id anchor** for time entries and as a cache that older code paths and rollback can read.
- Rates and currency stay in `project_rates` (private part), keyed by the project id; never in a note.

## Folders and naming

- New project notes go to `Projects/<name>.md`, client notes to `Clients/<name>.md`, at the top of the space (folder names fixed, English).
- The folder is only where new ones land: a project note moved to another folder stays a project.
- The project's name is the note title (file name without `.md`), as Obsidian shows it.
- A name the file system cannot hold (`/`, `:`, M220's `safeName`) keeps the safe file name and adds `name: <original>` to front matter; Yak shows `name` when present.
- Two projects with one name but different clients (Toggl allows it): the second becomes `Projects/<name> (<client>).md`; a bare `[[<name>]]` then resolves to the first (Obsidian's rules, `makeResolver`). The migration report lists each such pair.

## Front matter

Field names follow Toggl v9 where one exists (`docs/architecture.md`); values are plain YAML Obsidian's Properties panel can edit.

| Note | Field | Value | Absent means |
| --- | --- | --- | --- |
| Project | `type` | `project` | not a project (see Recognition) |
| Project | `client` | `"[[Client A]]"` (link to a client note) | no client |
| Project | `color` | `"#rrggbb"` | the palette colour by id (stable, `PROJECT_COLORS`) |
| Project | `billable` | `true` / `false` | `false` |
| Project | `active` | `false` when archived | active |
| Project | `name` | only when the file name cannot hold it | the title |
| Client | `type` | `client` | not a client |
| Client | `archived` | `true` when archived | not archived |
| Client | `name` | as for projects | the title |

- Never in a note: the project or client UUID, `rate`, `currency`, `created_at`, `updated_at`, entry counts.
- Unknown fields and the body are left untouched (the note may also be a TaskNotes or Dataview target).
- A `client` that is plain text (`client: Client A`) is read like a link to that name, and written back as a link only when Yak changes the field.

## Recognition (answered: `type:` field)

A note is a project when its front matter has `type: project`; a client when `type: client`.
Owner, 2026-10-30: the `type:` field, since TaskNotes offers no project marker to reuse.
TaskNotes identifies tasks by a tag (`task`, default) or a configurable property and value (e.g. `type: task`); its `projects` links may point at any note and mark nothing, so `type: project` follows its property method.

| Option | For | Against |
| --- | --- | --- |
| **`type:` field (recommended)** | mdbase's default explicit type key (`settings.explicit_type_keys: [type, types]`); survives moving the note; one field to read; Obsidian Bases can filter on it | One more field in each note |
| Folder `Projects/` | No field at all | A move breaks it; a folder rename silently drops every project; a stray note in the folder becomes a project |
| Tag `project` | Like TaskNotes' `task` tag | Tags are for the person; mixing kinds into `tags` clutters tag lists and the tag picker |

## Ids: how time entries resolve projects

- `time_entries.project_id` keeps pointing at a `projects` record; nothing in entries changes.
- Each `projects` record gains `note_id` (the note's UUID in the `notes` map); each `clients` record the same.
- Notes keep their UUID across renames and moves, in Yak and through the mirror (a vanished file whose text reappears at one new path is a move), so `note_id` stays valid.
- A project note with no record (made in Obsidian, or `type: project` typed into a note) gets a record **keyed by the note's own id**, its fields computed from the note.
  Two devices that do this at once write the same key with the same values (`created_at` = the note's), so they converge (rule in `src/core/migrations.ts`).
- The cache: whenever a project or client note changes, every device recomputes the record's `name`, `client_id`, `color`, `billable`, `active` / `archived` from the note text. Deterministic, so concurrent devices write identical values. Yak never writes these record fields any other way.
- Lookups: `project_id` → record → `note_id` → note (title, link to open it). Name → project: the space's project notes by title, ignoring case.
- New code lives in `src/core/project-notes.ts` (parse, recognise, write fields, keep the cache), so time, notes, reports and import share it without importing each other.

## Rename, archive, delete

| Action | In Yak | In Obsidian / mirror |
| --- | --- | --- |
| Rename project or client | Renames the note; `[[links]]` in tasks and projects follow the `link_update` setting | Obsidian renames the file and its links; the mirror brings both back |
| Change client, colour, billable | Writes the front matter field (minimal edit, so concurrent body edits merge) | Edit the property; the cache follows |
| Archive | Writes `active: false` / `archived: true`; hidden from pickers, still in Reports (as today) | Same field |
| Delete in Yak | As today (time.md row 19): only when unused, else "Move entries to…" first; deletes the note (Recently deleted, 45 days) and the record | — |
| Note deleted elsewhere | The record stays, so entries keep their project; Organize lists it under "Note missing" with Restore note (Recently deleted) or Make a new note | Obsidian trash (O16) |
| `type: project` removed | Same as note missing; the note stays a plain note | Same |
| Move to another space | Organize's "Move to space" (`move-space.ts`) also moves the note; Notes' "Move to space" on a project note asks the time module to do the same through the event bus | A move between space folders is delete plus create (M9): the source record becomes "Note missing" and the target gets a new project; Organize offers to merge them |

## Tasks

- `projects` stays the TaskNotes field: a list of `[[links]]` (plain names still read, N37).
- The picker offers the space's project notes (title, colour dot, client), then other values already used; choosing writes `[[<title>]]`. "New project…" makes the note.
- Tasks › Projects groups by the project note a link resolves to (colour, client, link to the note); unresolved names stay their own group with "Make a project".
- Start timer on a task (N19 amended): the notes module resolves the first `projects` link to a note id and sends `projectNoteId` in `timer:start-request`; the time module maps it to the record. No module import.
- Make this a task (N36) keeps linking the current note; if that note is not a project, nothing changes.

## Per screen

| Screen | Change |
| --- | --- |
| Timer, Add entry, entry editor, bulk edit | Pickers read the cache (unchanged look); "New project…" creates note and record in one transaction; each row has Open note |
| Reports | Unchanged numbers; a project or client name links to its note |
| Organize (Settings) | Lists read the cache; Add creates the note; Rename renames the note; rates edited here only (private); "Note missing" group; Open note per row |
| Notes | Project and client notes are ordinary notes in the tree; the Properties panel shows `client` as a client picker, `color` as a colour input, `billable` and `active` as switches |
| Tasks | Picker, grouping and Start timer as above |
| Home, search | Search already finds project names (N45); a project result opens the note |
| Mirror, Obsidian plugin | Project and client notes are mirrored like every note (M8 amended: time entries and rates are never mirrored). The plugin needs no change: it never held projects; front matter links are same-space |

## Toggl import and export

- Import keeps its matching (by name within the client, archived still match, deleted do not; import.md) against the cache.
- A project or client the import creates is a note plus record (`billable: false`, palette colour, no rate), one transaction per batch as today.
- Reports CSV export: same columns (`Client`, `Project` by name).
- Folder backups' `projects.json` and `clients.json`: records keep the Toggl v9 names (`name`, `client_id`, `color`, `billable`, `active`; `name`, `archived`) plus `note_id`; the notes are in the backup as notes.

## Sync

- Project and client notes live in the space's shared part (`notes` map), like the records today; anyone the space is shared with sees names, clients, colours, billable (as today) and now the body.
- Rates and time entries stay in the private part; nothing new there.
- Projects belong to a space (S17); one `Projects/` folder per space.
- All merging is Yjs: the note is a `Y.Text`, the cache is per-field plain values computed from it.

## Migration (F39)

### Steps

Run once per space as an explicit action (owner, 2026-10-30): Settings › Organize shows "Turn projects into notes" with a preview, then a report. Never automatic on update.

1. **Check** every device that keeps the space runs a build that understands project notes (the device's `v` in the account document); otherwise list the devices to update and stop (owner, 2026-10-30: version gate, no compatibility window; old builds never write a converted space).
2. **Offer a backup** first (Backups part), as for any bulk change.
3. **Clients:** each live client gets `Clients/<name>.md` (`type: client`, `archived` if archived), note id derived from the client id (hash), so two devices running the step create the same key.
4. **Projects:** each live project gets `Projects/<name>.md` with `type`, `client`, `color`, `billable`, `active`; its record gets `note_id`. Same id rule.
5. **Task project names:** each name in task `projects` (link or text, case-insensitive) that matches no project:
   - resolves to an existing note → that note becomes the project: `type: project` added, body untouched, listed in the report (owner, 2026-10-30: adopt, never a second note of the same name);
   - otherwise → a new `Projects/<name>.md` (no client, palette colour, not billable) and a record keyed by the note id.
   Plain-text task values are left as written; they now match by name.
6. **Existing notes at a target path** (`Projects/<name>.md` already there, not typed): same as step 5, adopt it.
7. **Report:** a note `Projects/Conversion report <date>.md` in the space, listing what was created, adopted, renamed for a clash, and the task names that were matched; shown in a dialog too.
8. **Mark** the space done (`meta.projects_as_notes`) and raise the declared document version, so a build that does not understand it stops writing that space and says "Update Yak" (the keys-required pattern, `KEYS_REQUIRED_DOC_VERSION`).

### Known limit

- Two devices converting the same space at the same moment while offline from each other: created notes converge (derived ids), but adding `type: project` to one adopted note twice can duplicate the line. The front matter reader accepts identical duplicate keys and the next write removes them. The action says when another device of the space was online in the last minute.

### Rollback

- Records are never removed and their cached fields stay current, so a build that ignores notes still shows every project, client and entry correctly.
- Undo right after: one bulk edit, one Undo (deletes the created notes, removes added `type` lines, clears `note_id`).
- Later: the notes are ordinary notes; deleting the `type` line or the note leaves the record as it was.
- The document version cannot go down; a rollback build declares the same version and reads records.

## mdbase (answered: compatible now, files later)

- The mdbase spec (v0.3.0, release candidate) types a collection with `mdbase.yaml` and `_types/<name>.md` (JSON Schema; `match.path_glob` / `match.where`; explicit `type:` key).
- TaskNotes' own mdbase files (`mdbase-tasknotes`) still use the older v0.2 format (`fields:`, `tn_role`), so one file set cannot match both today.
- The front matter above fits both: `type: project` is mdbase's explicit type, `projects` stays TaskNotes' link list, `client` is a link field.
- Owner, 2026-10-30: this build writes no mdbase files; the front matter stays compatible.
- Writing the files later is additive: per space folder, `mdbase.yaml` and `_types/project.md`, `client.md`, `task.md`, as notes the app hides from the tree.

## Cost

Size L, about five PRs after the three blockers:

| PR | Content |
| --- | --- |
| 1 | `src/core/project-notes.ts`: recognise, read and write fields, cache, record keyed by note id; unit and `migrationConverges` tests |
| 2 | Conversion action, report, device-build check, document version; browser test with an older-layout fixture |
| 3 | Organize and time pickers write notes; Note missing group; Reports links |
| 4 | Tasks picker, grouping, Start timer with project (N19 amended) |
| 5 | Toggl import creates notes; Properties panel controls; backup `note_id`; docs (architecture, M8, N19, N37) |

Risks: link resolution across many notes on every change (keep it incremental), duplicate names, and the mirror reading a move between space folders as delete plus create.

## Owner's answers (2026-10-30)

| # | Question | Answer |
| --- | --- | --- |
| 1 | How is a note recognised? | `type: project` / `type: client` front matter; TaskNotes has no project marker to reuse |
| 2 | Explicit action or automatic? | Explicit action per space in Organize: preview, backup offer, report |
| 3 | Older builds? | Version gate: convert only when every device keeping the space is updated; old builds then stop writing it |
| 4 | Task name resolving to an existing plain note? | Adopt that note (`type: project` added, body untouched, in the report) |
| 5 | mdbase files? | Not now; front matter stays compatible, files are a later additive step |
