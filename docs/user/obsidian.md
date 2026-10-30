# Obsidian plugin and folder mirror

Your notes are Markdown. Two ways to also use them in other editors:

## Mirror to a folder

**Mirror** (**Settings › Mirror to a folder**) keeps a folder of `.md` files in step with your notes, two ways (it needs folder access; where the browser has none, Mirror says it is not available, see [Browsers and phones](#/help/browsers)).

- One sub-folder per space. Edit a file outside Yak and the note changes, and the other way round.
- If both sides changed the same note, nothing is lost: the file's version is kept as `<name> (conflict).md`.
- Only Markdown notes are mirrored; time entries stay in the app.

## Obsidian plugin

The **Yak Sync** plugin is a device: it pairs like any other (see [Devices and sync](#/help/devices)) and keeps your notes in an Obsidian vault.
Install it with BRAT (Obsidian42 - BRAT, a community plugin; works on phones):

1. In Obsidian, install **BRAT** from Community plugins and turn it on.
2. In BRAT choose **Add beta plugin** and enter `dynamodal/yak`.
3. Turn on **Yak Sync** under Community plugins, open its settings and join with a code from **Settings › Devices and sync › + Add a device** in Yak.
4. In Yak, open the vault's row ("Obsidian (<vault name>)") in **Settings › Devices and sync** and tick the spaces it may keep. It keeps nothing until you do.

BRAT installs new versions by itself.
A vault that installed the plugin from the old private repository must be re-added: remove it in BRAT, then add `dynamodal/yak`.
Version 0.2.0 gave the vault its own device keys, so it can join an account that requires them; its settings say where the keys are kept.
