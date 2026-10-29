# Decisions: mirror

Reference: `../architecture.md` (Mirror), `../design/external-editors.md` (routes not built).

| # | Decision | Why |
| --- | --- | --- |
| M1 | The file system interface has no "changes since"; `list` returns a stamp per file and the engine diffs against the last pass | Works with every adapter (a folder handle, Obsidian, a helper); no adapter needs a change journal. An adapter can still cache `list` |
| M2 | The engine reads and writes the `notes` map through `core/schema`, not `src/notes` | Modules never import another feature module |
| M3 | Both sides changed: the note keeps the path and the file's version becomes a new note and file named `<name> (conflict).md` | Nothing is lost and both sides show both versions; no guessing |
| M4 | A delete on one side is undone by an edit on the other | An edit is never thrown away silently |
| M5 | A rename is detected by identical text at exactly one new path; otherwise delete plus create | Files carry no id; guessing on partial matches could move the wrong note |
| M6 | Note and file created at one path: the file keeps the path, the note is written beside it as `<name> 2.md` | The outside file is already on disk; the note's path is changed, not its id |
| M7 | Only `.md` files without hidden segments are mirrored; files outside a space folder are ignored | Keeps `.obsidian/`, attachments and strays out |
| M8 | Time entries, projects and rates are never mirrored | Not Markdown; they stay in the app |
| M9 | Moving a file between space folders is a delete plus a create | Moves between spaces are a separate feature (#59) |
| M10 | Outside edits are found by a 4 s poll while the page is visible; File System Observer only adds a faster trigger where it exists | It is Chrome-only and recent; the poll works everywhere the folder picker does, and `list` costs one stat per `.md` file |
| M11 | The folder handle, spaces left out and `MirrorState` stay on the device (IndexedDB) | Handles cannot sync; each device mirrors its own folder |
| M12 | Choosing another folder starts from an empty `MirrorState` and deletes nothing; files already there are imported as notes | A stale state would read every note as "file deleted outside" |
| M13 | Spaces are mirrored by default; the user can leave one out | One shared account may hold work the user keeps out of a personal folder |
| M14 | After a reload the browser may need one click to allow the folder again; a banner offers it on every screen | Chrome drops the grant unless the user chose "Allow on every visit" |
| M15 | Conflict copies are listed on the Mirror screen until dismissed | The engine returns them once; a toast alone is easy to miss |
| M220 | Mirrored paths reject `\`, control characters, Windows device names (`CON`, `NUL`, `COM1`…) and segments ending in a dot or space; `safeName` rewrites them | A path chosen on another device must stay inside the mirror folder on every platform; the check is shared by the mirror engine and the Obsidian vault, which both use `mirrorable` |
