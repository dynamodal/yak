# Goals, principles and constraints

## Goal

- Replace Toggl for time tracking, and Obsidian plus Obsidian Sync for notes and tasks, without installing anything or running a server.
- Two kinds of users: local-only (no pairing; safe local data plus folder backups) and sync users (two or three of their own devices).
- Notes and tasks should also be editable in Obsidian and other Markdown editors (built: `docs/architecture.md`; routes not built: `docs/design/external-editors.md`).

## Principles

- Sync is a layer, not a dependency: everything works with it off.
- Data you can read without the app: Markdown for notes and tasks, CSV and JSON for time.
- A proven CRDT (Yjs), not custom merge logic. Hand-built op-log sync is easy to get subtly wrong and can lose data silently; soft deletes and stored state vectors avoid the same traps.
- Code an IT department could review: no remote code, strict Content-Security-Policy, few dependencies.
- Customisation is data (templates, key bindings, settings), not code.
- Familiar to people coming from the Toggl desktop app and Obsidian, in behaviour, not look.
- Threat model for sync (S-258g): defend against strangers on the relay or signaling (modified code, no secret or keys) and against a lost or stolen device running the normal app; not against a removed device running modified code. Prefer "stop syncing, re-pair with a new invite" over handling edge cases, and keep re-pairing easy.

## Constraints

- Locked-down computers: managed browsers, some addresses blocked, removable media disabled.
- Linux with Chrome is a full target (Firefox lacks File System Access).
- Phones (Android, Firefox) pause the page in the background, so sync happens while it is open.
- Hosting: one Cloudflare Worker serves the static files and the `/signal` relay (`wrangler.jsonc`).

## Why things are the way they are

- **Own subdomain:** browser storage is per origin.
- **Spaces from day one:** a peer gets a whole Yjs document or nothing, so sync scopes need separate documents.
- **QR and sync code for pairing only:** laptops sleep often; reconnection must be automatic.
- **Signaling is pluggable:** the site's own relay by default, ntfy.sh selectable.
- **Toggl-shaped data:** import and export stay trivial.

## Rejected ideas (do not re-propose without new information)

- A VPN mesh (Tailscale) as the transport; Syncthing in the browser; USB sneakernet.
- DuckDB-Wasm or Pyodide as a sync mechanism (queries only).
- Forking an existing open-source tracker.
- GitHub Gist for signaling; periodic signaling on a timer.
- y-webrtc and Trystero for now.
- Nested spaces with inherited membership (use flat spaces with names).
- CSV as a restore input (lossy).
- User scripts or runtime plugins in the app.
- The name "punchcard" (taken).
- Other names were checked for clashes and dropped (old issue 92).
- A stub note left behind when a note moves to another space (links are rewritten instead).
