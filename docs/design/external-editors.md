# Editing notes in Obsidian and other editors

Built: the browser mirror (route 3) and the Obsidian plugin (route 1); see `../architecture.md` ("Mirror", "Obsidian plugin"), `../decisions/mirror.md` and `../decisions/obsidian.md`.
This note keeps the routes not built.

## Constraint

- Only the File System Access API lets a page write a folder: Chrome and Edge on a computer. Not Firefox, not Safari.
- Phones and Firefox need something outside the browser: the Obsidian plugin, or one of the routes below.

## Routes not built

| # | Route | Phone | Firefox | Other editors | Size |
| --- | --- | --- | --- | --- | --- |
| 2 | Desktop helper that keeps a folder current; the user syncs the folder (Syncthing, a drive) | Via the user's sync tool | Yes | Yes | L |
| 4 | Cloud drive as the bridge | Fragile (Obsidian says Drive is not officially supported) | n/a | Yes | M |
| 5 | Zip export and import of Markdown | By hand | Yes | Yes | S |

## Still untested

- The Obsidian plugin in real Obsidian on a phone: edits both ways, and the WebRTC link in the background and after the screen locks.
- Typing in both editors at once: diff-based merging is good for turn-taking, poor for simultaneous typing.
