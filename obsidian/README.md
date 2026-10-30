# Obsidian plugin

Makes a vault a device of your Yak account.
Notes and tasks of the spaces you choose appear as Markdown files and sync both ways, on a phone too.
Time entries stay in the app.
Needs Obsidian 1.14.5 or later.

## Install and update

With BRAT (Obsidian42 - BRAT, a community plugin; works on phones):

1. Install BRAT from Community plugins and turn it on.
2. BRAT, Add beta plugin: `dynamodal/yak`.
3. BRAT checks for updates at start and installs new releases; "Check for updates to all beta plugins" forces it.
4. A vault that installed the plugin from the old private repo must be re-added: remove it in BRAT, then Add beta plugin `dynamodal/yak`. The old repo gets no more releases.

By hand:

1. Download `main.js`, `manifest.json` (and `THIRD-PARTY-LICENSES.txt`, the licences of the libraries inside) from the latest `obsidian-v…` release on GitHub, or build them: `npm run build:obsidian` (output in `obsidian/dist/`).
2. Put both in `<vault>/.obsidian/plugins/yak-sync/`.
   - Android: copy them with a file manager, or with the vault's own sync, then reload Obsidian.

Then:

1. Settings, Community plugins: turn on "Yak Sync".
2. Settings, Yak Sync: the top line says whether the vault is joined and syncing. Paste the sync code or a one-time code from the app (Settings › Devices and sync › + Add a device), Join.
   - When your account requires device keys, use a one-time code (Make a one-time code).
     A notice in Obsidian shows a code. If the app shows the same, choose "The codes match" in the plugin's settings, then approve the vault in the app.
3. In the app, Settings › Devices and sync: open the row named after the vault (default `Obsidian (<vault name>, desktop or mobile, <4 characters>)`; rename it with Device name in the plugin's settings) and tick the spaces it keeps.
   Nothing is written until you do.

An account can require device keys only once every vault runs version 0.2.0 or later of the plugin: until then Settings › Devices and sync lists the vault as not ready.

## Folders

- One root folder, `Yak/` by default (a setting). Each kept space is a folder inside it: `Yak/<space>/…`.
- Nothing outside the root is read or written. `.obsidian/` is ignored.
- Files live in `Yak/<space>/attachments/`, one folder per space. Yak ignores Obsidian's "Default location for new attachments" (also "Same folder as current file"); a file Obsidian saves elsewhere in the space folder is copied into `attachments/`. Deleting a file there deletes it in Yak, on every device.
- Notes in a space folder sync to that space.
- A note at the root, or a new folder directly under it: not synced; a notice says what to do.
- Rename a space in Yak, not in the vault: a renamed space folder is named back.
- Delete a space folder: no note is deleted. You are asked to restore the folder or stop keeping the space here.
- A link into another space is `[[Space:path]]` in Yak and `[[Yak/<space>/path|title]]` in the vault.

## Where your data is stored

- The sync code is in Obsidian's `localStorage`, under a key per vault. Any plugin you install can read it.
- The vault's device keys are in protected browser key storage (IndexedDB, keys that cannot be read out) when Obsidian has it.
  Otherwise they are in the plugin's settings file, `.obsidian/plugins/yak-sync/data.json`, which vault sync copies: whoever reads the vault can then act as this device.
  The settings tab says which, and shows the vault's fingerprint to compare with the app's.
- Documents (notes, tasks, projects, the account) and the mirror state are files under `<vault>/.obsidian/plugins/yak-sync/`.
  Vault sync (Obsidian Sync, iCloud, Syncthing, git…) copies them without encryption, so treat that folder as readable by whoever reads the vault.
- Time entries never reach the plugin: the private part of a space is neither synced to it nor saved.
- Setting "Keep documents in the vault" (under "Where Yak keeps your data" in the settings), on by default.
  Off: documents go to the app's own database (IndexedDB) instead, and no document file is written in the vault.
  Reload Obsidian after changing it; files from before are imported once and removed at a later start.
- The notes in the `Yak/` folder are ordinary Markdown files in the vault either way.

## Commands

- Show sync status: link, peers, spaces, last pass, the connection log.
- Sync notes now.
- Review folders that need a decision.

## Release

```bash
scripts/release-obsidian.sh            # builds, shows what would be released
scripts/release-obsidian.sh --publish  # pushes tag obsidian-v<version> from a clean, up-to-date main
```

- Bump `version` in `obsidian/manifest.json` first, in a merged PR.
- The tag starts the Release Obsidian plugin workflow: it checks the tag against the manifest, builds, and attaches `main.js`, `manifest.json` and `THIRD-PARTY-LICENSES.txt`.
- BRAT installs the latest release of the repo, so a release of anything else would replace it; keep `obsidian-v…` the only releases or move the plugin to its own repo.

## Tests

- `npm test`: link translation, the vault adapter against the engine, the vault rules, document saving.
- `npm run e2e obsidian`: the built bundle in a page with an in-memory stand-in for Obsidian's API, paired with the app through the mock relay.
- `npm run e2e:obsidian-app`: the built bundle in real Obsidian desktop (`obsidian/e2e/`, wdio-obsidian-service), at `minAppVersion` and the latest release; see `docs/testing.md`.
- Not covered by a machine: Obsidian on a phone, and its background behaviour.
