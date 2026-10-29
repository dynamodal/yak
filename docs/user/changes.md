# What's new

## 2026-10-29: Obsidian plugin 0.2.1

- The Yak Sync plugin has a first public release on GitHub: add `dynamodal/yak` in BRAT. A vault that installed it from the old private repository must be re-added in BRAT.
- It carries the sync fixes made since 0.2.0.
- The plugin and its guide now point to **Settings › Devices and sync**.
- Nothing stored changed.

## 2026-10-29: Organize in Settings, a tidier Home

- **Organize** (projects, clients, tags, task values) is now a section of **Settings**: open it from the contents row or from **Edit…** in a picker, and it opens in place. Old Organize links and **Go to Organize** in the command palette still work.
- Settings › Features has a shorter intro; the details sit beside each switch.
- Home cards fill the width without big gaps; project names in **Where the week went** wrap instead of being cut off; **Recent notes** shows the folder and a line of each note.
- Nothing stored changed.

## 2026-10-28: Home

- A new **Home** tab comes first and is where Yak opens: a summary with cards for what needs you (the same rows as Settings), this week's hours with a bar per day, tasks due soon (late ones marked, tick one off right there), recent notes, and where the week went by project.
- A card hides when its feature is off or it has nothing to show. The cards sit three across, two, or one by width. Each chart has the same numbers as a table.
- Home is a switch in Settings › Features. The **Time tracker** choice on a new device leaves it off; on a device that already chose it, Home now shows (switch it off in Features if you prefer the old start page).
- Nothing stored changed.

## 2026-10-28: Tidier Tasks and Time pages

- **Tasks** has one switch: **List**, **Board**, **Table**. The four selects above the list are now behind one **Filters** button that shows how many filters are on. Agenda and Projects are in Filters under **Group**.
- The **Table** shows Task, Status, Due, Project and, when Time is on, **Tracked** (time from the timer on that task). Other properties, and Checklist, are columns you add under Filters.
- Tasks in the list and on the board show their tracked time when Time is on.
- **Time**: the Today and This week cards are gone (each day already shows its total; Week shows the week). The space choice moved behind Filters and shows only when you have more than one space. On a phone the switch, Filters, Select and Add entry share one row, so the first entry is near the top.
- Nothing stored changed.

## 2026-10-28: Settings is one long page

- **Settings** is one page with a row of section chips under the title: Backup and safety, Devices and sync, Spaces, Sharing, Display, Features, Help, Advanced. A **Needs you** section appears first while something waits: a device or account asking to join, or "No backup yet". The Settings tab shows a dot for a request.
- The Sync, Backup and Passphrase lines are always there, whatever the state ("Sync: Off · Set up").
- Devices, spaces and accounts are rows that open where they are. The spaces-by-devices table is gone: each device and each space shows what it keeps as toggle chips.
- Device keys and ids, the connection, logs and Reset this device's data moved to **Advanced**.
- Adding a device: the QR code and a link come first, with **Send link** where your browser can share. The code is shown in groups of four with a copy button, and the join field accepts a pasted link.
- Searching: a task is still found, as a note, when only Tasks is switched off.
- Nothing stored changed; old Settings addresses open the right row.

## 2026-10-28: Tasks work without Notes

- **Notes** and **Tasks** are separate switches in Settings › Preferences › Tabs shown. Hide Notes and keep Tasks if you only want a task list.
- With Notes off, a task opens on its own page (**Tasks** › the task) with the same editor and properties. A link to another task opens it; a link to a plain note does nothing and says "Turn on Notes to open this note". The Notes tab, the notes tree, note search results, daily notes and the note commands are hidden.
- **If you had hidden only Notes before, Tasks now show.** Before, hiding Notes hid Tasks too. Turn Tasks off if you want it hidden.
- Nothing is deleted or changed: tasks are still note files, in sync and in backups.

## 2026-10-28: One timer in the header

- The timer is a **pill** in the header on every page. The round button starts or stops at once. The words beside it open the details: description, **Recent** work (the first row is **Continue**), project, tags and billable, with **Start** or **Update**.
- **Alt S** starts the timer and opens the details with the cursor in the description. **Esc** closes it and the timer keeps running; **Alt S** again stops it.
- The Time page no longer has a start bar. **Add entry** at the top adds a finished entry.
- On a phone the header stays one row (two while a timer runs, the second being the timer); the tabs are icons beside the logo.
- The separate **Reports** switch is gone: Reports is part of Time and follows the **Time** switch.
- **Time** is a switch in Settings › Preferences › Tabs shown. Off hides the tab, Reports, the pill, the shortcut and the title and icon cue; nothing is deleted. A running timer must be stopped first. The app opens on the first tab still shown.

## 2026-10-28: A tidier header

- Tabs have icons. On a narrow screen only the icons show; each still has its name for screen readers.
- The **Timer** tab is now **Time**. The address is `#/time`; old `#/timer` bookmarks do not redirect.
- A **command** button at the right of the header opens the command palette and shows its shortcut (**Alt P** unless you changed it).
- A **sync** button shows how this device syncs, by shape as well as colour: grey square (off, or no other device yet), green circle (linked directly), green ring (through the relay only), amber triangle (no device linked). Press it for the devices and how each is linked.
- **Help** moved: open it from **Settings** (About & help), the command palette or the welcome screen. A dot on the **Settings** tab shows when What's new has something you have not seen, or amber when backups or sync need attention.
- Headings and numbers use the same sans font as the rest; the serif is gone.

## 2026-10-28: New look

- Warmer colours with a soft green accent, in light and dark.
- Rounder buttons, cards and tabs; the current tab is a soft pill.
- Headings and big numbers (the timer clock, totals) use a serif font.
- The stop button is now a warm red-brown while a timer runs; start and selection are green.
- New projects get softer default colours; your existing projects keep theirs.

## 2026-10-28: No "Keep all spaces" flash after joining

- A device you approved by one-time code no longer shows the **Keep all spaces** notice for a few seconds before opening the Timer.
- Spaces that appear later still ask.

## 2026-10-27: Coming back to a share connects faster

- After a share was ended and you join again with a new link, the two devices now find each other within seconds; before, it could take a minute or more before anything synced.

## 2026-10-27: Before coworkers: backups, pairing, wording, phones, quick wins

- **Backup:** until your first backup works, a bar on every screen says **No backup yet** with **Set up**. Welcome and **Backup & restore** say plainly that clearing this site's data in the browser deletes Yak's data, and **Backup & restore** shows **Storage: kept** or **may be cleared by the browser**.
- **New sync:** right after **Start syncing**, Sync says **On · waiting for your first device**, and the Devices page no longer claims this device was removed.
- **Adding a device:** a request to join shows above the code and QR code. Your device names are asked for and saved, so devices show as "Firefox on Linux", not as a string of letters. A phone you approve keeps the account's spaces by itself and opens on the Timer.
- **Sharing:** a space with someone waiting to join shows "<name> asks to join · Review" on **Settings**.
- **Words fixed:** Help no longer says checkbox lines in notes appear in **Tasks** (only task notes do); joining says **+ Add a device**; Help explains what losing your passphrase means; What's new lists the newest entries first.
- **Phones:** while you type a note with the keyboard up, the page header steps aside so the text has room. Entries with tags keep their project on narrow screens.
- Code fields (one-time codes) no longer capitalise or autocorrect what you type.
- The header **▶** starts with the text you typed on the Timer page. On phones the header buttons are bigger and **Continue** is just its icon.
- **Organize** has a **← Settings** link. The command palette hides keyboard hints on touch screens.
- Notes: bigger formatting buttons on touch screens, with **Undo** and **Redo**. An empty Notes page offers **New note** and **Today's note**. Enter in a note's title moves to the text.
- Reports: **Download CSV** is next to **Copy as Markdown**. Projects that share a name show as **Project · Client**.
- Import links to the steps in Toggl and says "not a valid date" for a date that does not exist.
- Devices: ids, fingerprints, switching to device keys and Reset moved under **Advanced**.
- Sharing: **Copy link**, and the name offered is yours, not "Chrome on Linux".
- The alpha banner no longer touches the screen edges on a phone.
- Stored data: unchanged.

## 2026-10-25: Other accounts, and a page for each space and account

- **Settings** has an **Other accounts** list under the spaces table: each account's name, short fingerprint and what you share. The per-row **Share…** link is gone; use **+ Share with an account** or the space's page.
- A **space's page** shows **Kept on** (your devices, with a box each and when each was last seen) and **Shared with** (accounts, since when, **End…** or **Leave…**, an open link with its time left and **Cancel link**).
- A new **account page**: its full fingerprint, your own name for it (**Rename**), the spaces you share and that it shares, and **+ Share another space**. Every share is still one space with a one-time link and a code comparison.
- Stored data: your names for accounts and the date a share began are kept in your account's document (older data needs no change).

## 2026-10-25: Reports moved onto the Timer page

- **Reports** is now the third view of the Timer page: **List**, **Week**, **Reports**. The Reports tab is gone. Old Reports links still work.
- **Previous** and **Next** on Reports step through days, weeks, months or years (a custom range by its own length). **Next** is off while the period includes today.
- The Timer page opens the view you used last, and Reports keeps its range. A range other than **This week** is highlighted, with **This week ×** to get back.
- One space menu now covers List, Week and Reports. Reports no longer has its own **Spaces** setting.
- No timer bar on Reports; the timer in the header is still there.
- Stored data: unchanged.

## 2026-10-25: Settings is one page

- **Settings** is a single page with three cards and no menu: **Your data**, **Preferences** and **About & help**. On a wide screen it has two columns.
- **Your data** is a table: a row for each space, a column for each device (this one first). Tick a box to make that device keep that space. A device that has not decided yet shows a dash.
- Choose a space's name to rename, archive or remove it (or **Leave share**). **Share…** on a row starts sharing it with another account. **+ Add a device** adds a device and **+ New space** adds a space. With many devices the table scrolls sideways and the space names stay put.
- Under the table, one line each for **Backup**, **Passphrase** (locked, or unlocked with the minutes left) and **Sync**: a coloured dot, a few words and a link, never wrapping.
- A device that never synced sees one column, **+ Add a device**, **Share…** and the backup line, with no passphrase or device id.
- **Preferences** starts with **Organize** and has week start, hours, theme, the tabs shown (was Features, one folded row), and history warnings.
- The pages Spaces, Sharing, Security and Features are gone: their content lives in the table, the status lines and Preferences. Old links open Settings. A device, a space and Backup & restore keep their own pages, and Back returns to Settings. The passphrase details (forget it on this device) are on Backup & restore.
- Stored data: unchanged.

## 2026-10-25: One passphrase sheet, sharing from one device

- Anything that needs your passphrase (making or approving a share, approving or removing a device, starting to sync, restoring an encrypted backup) opens one sheet, then carries on by itself. The button names the action: **Create and make a link**, **Unlock and approve Bob**.
- **Create a passphrase:** suggested words, **Other words**, or **Type my own**, and a tick for **I've written it down**. This also gives the device what it needs to share, so one device can share a space and one device can join a share. No need to start syncing first.
- It stays unlocked for 5 minutes after you last used it, not 5 minutes after you typed it.
- Opening a share link on a device you have not set up shows the sheet; the link is kept meanwhile.
- **Security** shows whether the passphrase is unlocked and has no forms. **Restore** has no passphrase field: it asks only when a backup needs one this device does not hold.
- Stored data: unchanged (one new device-only note remembering an opened share link).

## 2026-10-25: Organize, note settings and shortcuts in new places

- **Organize** holds projects, clients, tags and task values. Open it from **Edit…** in the project, tag and note property pickers, the command palette or **Organize…** on Settings.
- **Note settings** (links, files, daily notes) and **Mirror** are behind the gear on Notes. Mirror always shows; where the browser has no folder access it says so.
- **Keyboard shortcuts** are in Help, still changeable, on phones too.
- Settings no longer lists Projects & tags, Notes, Mirror or Shortcuts; old links go to the new places.
- Stored data: unchanged.

## 2026-10-25: Small Settings fixes

- **Passphrases:** a suggested passphrase joins its words with hyphens (`cobalt-fern-ledger-mango-quiet`), so no one mistakes the spaces for separate things. A passphrase you type is unchanged.
- **Devices:** the one-time code and its QR code fold away once the new device has joined. The Advanced section is called **Advanced: connection server and logs**.
- **Settings › General:** **Export settings** and **Import settings** are gone; backups and sync already carry these settings.
- **Phone:** checkboxes, section headings that open and close, links that stand on their own line and selects are at least 44 px tall to tap.
- Stored data: unchanged.

## 2026-10-25: Plainer Devices, Spaces and Sharing

- **Devices:** one name for adding a device, **one-time code**. The connection server, relay usage and STUN servers are under **Advanced**. The status says **Waiting**, **Connecting…** or **No other devices**, the same words the device rows use.
- **Spaces:** no raw id, no "Kept by" (choose which devices keep a space on **Devices**). A space shared with you has **Leave share…** instead of **Remove**.
- **Settings › Sharing:** all spaces in one place, with two steps (passphrase, then a link). The link and QR code fold away once the person is approved.
- Wording: "account" means your own devices; another person is a person. The server that introduces devices is the **connection server**.
- Stored data: unchanged.

## 2026-10-24: Device keys are always on

- **Start syncing** now asks for your passphrase in the same step (choose one if you have none; 20 characters or more). Every new synced account requires device keys from its first device: the switch is gone.
- A device joins with a **one-time code** that one of your devices approves. Entering the account's sync code no longer joins anyone.
- An older account shows **Switch to device keys** on **Devices**. Compare the fingerprints, tick the devices you recognise and enter your passphrase. The page tells you before you press which devices will have to join again.
- A device left out (not ticked, an older Yak, or no keys) keeps all its data and stops syncing. On it choose **Join again with a one-time code** on **Devices** and approve it from another device: what it wrote meanwhile merges back.
- **Change sync code** is gone: a new code could not be entered on other devices any more. Switch to device keys instead. **Join again** on a device of a not yet switched account works once another device has switched.
- Stored data: nothing is deleted or reset. Update Yak on every device first.

## 2026-10-23: Security and Features pages

- **Settings › Security** is the one place for your passphrase. It lists what the passphrase protects: encrypted backups, approving and removing devices, approving and ending shares. Backup & restore and Devices link to it.
- Every passphrase field has a **Show** switch.
- A new passphrase needs at least 20 characters. Under 28 it works but is warned about: four or more random words is best. The hint shows while you type.
- A shorter passphrase you set earlier keeps working. Security suggests a longer one.
- **Settings › Features** hides Notes, Tasks, Reports, Mirror and Import on this device. Hiding Notes hides Tasks too. Your data stays, keeps syncing and is still in backups.
- Welcome asks **Time tracker** (Notes and Tasks hidden) or **Time, notes and tasks**.
- Stored data: nothing to do.

## 2026-10-23: Manage is now Settings

- **Manage** is now **Settings**. Old links and shortcuts still work.
- **Backups** and **History** are one page, **Backup & restore**. The history part is called **Go back in time** and starts at the first time this device recorded anything.
- The page list has no group headings. On a phone it is a list that opens, not tabs that scroll sideways.
- Welcome says what Yak is, has the **?** for Help and About, and puts joining a device or restoring a backup in one small line.
- One notice on first start instead of two. What the debug log holds is under **Settings › Devices › Advanced › Logs from all devices** and in Help › Privacy.
- General no longer repeats Import from Toggl or links to other pages. Daily-note tokens, history warnings, STUN servers and **Reset this device's data** are folded away.
- Stored data: nothing to do.

## 2026-10-23: Files travel with moved and shared notes

- Moving a note to another space now takes its files along. The first space keeps its copies; **Settings › Notes › Unused files** lists what no note uses any more.
- A file that has the same name as a different one in the new space gets a number (`photo 2.png`) and the note's link is changed to match.
- In a shared space, members' devices now fetch its files from each other directly, like your own devices do. Until a direct connection exists the note says it is waiting.
- Stored data: nothing to do.

## 2026-10-23: Share a space with another account

- **Settings › Spaces › Sharing › Share with another account** makes a link that works once, for 15 minutes. The other person opens it in Yak, you both compare a code over a call, and you approve with your passphrase.
- Only that space is shared; your private part (time entries), logs and everything else stay yours. Edits and deletes reach everyone in the share.
- You end a share per account (passphrase); a member can leave. Whoever is out keeps what they have and the space stays theirs. They can be added again with a new link.
- To share one note, move it into its own space first.
- Needs device keys on both accounts. Stored data: nothing to do; older versions ignore shares, and sharing stops there until they update.

## 2026-10-22: Simpler removal, Join again

- Removing a device no longer changes the account's keys: your other devices just stop accepting it. A device that was off at the time syncs as before when you open it, however long it was off.
- **Devices › Join again or remove this device › Join again with a one-time code** brings a device back without leaving the account: it keeps its data, makes new keys, and you approve it from another device. Use it on a removed device, or one that stopped finding the others.
- In accounts that require device keys, Devices no longer offers **Change sync code**: the other devices ignored the new code, so it only cut this device off.
- The join box also takes a one-time code, and says so.
- Stored data: nothing to do. Devices that already moved to a new sync secret keep it; a device still on the old one needs **Join again** once. A device not opened for weeks, since accounts got their own keys, may not get the account's changes: choose **Remove this device from the account** on it without erasing anything, then enter the sync code again; its data stays.

## 2026-10-22: Joining after a decline

- When joining with a one-time code is declined, the new device now offers **Try again** and **Use another code** instead of leaving the join by itself. Someone else who has the code can no longer stop the join.

## 2026-10-22: Removing a device locks it out

- In an account that requires device keys, **Devices › Remove from account** asks for your passphrase and changes the account's keys. Your other devices move to a new sync secret by themselves; the removed device finds none of them and gets nothing new.
- It keeps what it already synced: nothing can take that back. To use it again, choose Remove this device on it and join with a new invite.
- A device that was off at the time catches up by itself when it is opened within a day; after that, join it again with a new invite.
- A removed device that sees its removal stops syncing and says how to join again.
- **Remove this device**, on the device itself, now also deletes its device keys in accounts that require them.

## 2026-10-22: Clean up unused files

- **Settings › Notes › Unused files** lists, per space, the files no note links to, with their sizes. Delete removes a file on every device that keeps the space, and for everyone in a shared space; only a backup brings it back.
- Yak never deletes a file by itself: taking a link out of a note keeps the file.
- The same page warns when a space's files use over 80% of what it can hold.

## 2026-10-21: Files in backups

- Folder backups now include the files in your notes, and so does **Download backup (zip, with files)**. The zip is one file, uncompressed, and can be bigger than 4 GB.
- **Download backup (JSON, without files)** is text only. It says so, and leaves the files out.
- Encrypted backups cover files too, under the same passphrase; their names reveal nothing.
- Restoring brings the files back, a file you deleted since included.
- Backups made by this version cannot be restored by an older Yak (it says to update). Older backups still restore.

## 2026-10-21: Require device keys

- **Devices › Require device keys**: after you set a passphrase, review every device with its fingerprint and approve the ones you recognise. From then on a device joins only when one of yours approves it, and the sync code alone gets nobody in.
- The switch cannot be undone. Every device must run this version first (and the Obsidian plugin 0.2.0); the page lists those that do not.
- Adding a device then uses a one-time code for one device: both screens show a short code; when they match, say so on the new device and approve it on the other. A device you did not approve at the switch can be approved later on Devices.
- Approving needs your passphrase, kept for 5 minutes.
- Obsidian plugin 0.2.0: the vault gets its own device keys and joins with a one-time code too. Its settings say where its keys are kept.
- Accounts that switched no longer keep the copy of the account data that older versions used; it is removed on each device.

## 2026-10-21: Files reach your other devices

- Files in notes now copy to your other devices that keep the space, in the background, straight from device to device. They never go through the relay, so a file shows "waiting for a direct connection" until two devices can reach each other.
- Files added before this update are fetched too. Large files arrive in pieces and carry on after a lost connection.

## 2026-10-21: Device keys, second step

- Your devices now prove who they are to each other with their keys when they connect, and data through the relay is locked with a key only the two devices share. Syncing works as before, also with devices on the older version.
- If you replace a lost account key in Backups, the device that made it must first be removed in Devices on another device.
- A device name typed on Devices right after opening the page is no longer lost.

## 2026-10-20: Files in your folder and in Obsidian

- Files in notes are real files now: Mirror and the Obsidian plugin put them in `<space>/attachments/`, one folder per space.
- A file you add to that folder shows up in Yak; a file you delete there is deleted in Yak, and the other way round.
- Obsidian: Yak ignores "Default location for new attachments" and uses `attachments/` in the space folder. Files Obsidian saves next to a note are copied there.

## 2026-10-20: Device keys, first step

- Each device now makes a key pair and shows on Devices whether it has keys, with a short fingerprint. Nothing changes in how syncing works yet, and devices on the older version keep syncing with updated ones.
- Your account gets its own key. Existing accounts move to a new internal id on the first start after the update; your data is copied, so you notice nothing.
- Backup passphrases need at least 12 characters, or you can use five suggested words. The passphrase now also protects your account key; it is asked for once when you set or enter it, and not kept for this. If you set a backup passphrase earlier, Backups asks for it once.

## 2026-10-20: Files in notes

- Paste or drop a file into a note, or use **Add file** under the editor. PNG, JPEG, WebP and GIF show in the note; every other file (SVG and HTML included) shows as a chip with a Download link.
- Files stay on this device for now; sending them to your other devices comes next. Up to 10 MB per file and 1 GB per space; you get a notice at 80%.
- Photos with location data get a notice. Yak adds them unchanged.
- Settings › Notes › Files: **Shrink large photos** (off by default).

## 2026-10-20: Timer rows on tablets

- On tablet-width screens the description now sits on its own line, with the project and tags underneath, so long project names are no longer cut to "Websi…".
- The time range stays on the right.

## 2026-10-20: Reports table on small screens

- Long project names in the Reports table now cut off with "…" (hover or tap for the full name), so more days fit on a phone.
- When Reports covers several spaces, the space name shows under the project name.

## 2026-10-20: Safari and iPhone

- New Help section **Browsers and phones**: what works in Safari and on an iPhone, and why folder backups and Mirror do not.
- Fields no longer zoom the page on iPhone when you tap them.
- The ⌘ button in the header now shows on phones, so you can open the command palette there.

## 2026-10-19: Accessibility

- Skip link ("Skip to content") as the first Tab stop.
- Better contrast for blue, green and amber text; screen readers get proper lists, headings and names for duration buttons.
- Long text boxes (report preview, licences, code) can be scrolled with the keyboard.

## 2026-10-19: Help, privacy and credits

- New **?** button in the header opens Help & About: the user guide, shortcuts, privacy and open-source credits on one page.
- **Report a problem** has its own page; it is also offered in the status dot's panel after an error.
- Privacy and data says what stays on your devices, what the relay sees and what is logged.
- Open source lists every library in this build with its licence.
- Projects, clients and tags can be moved to another space in bulk.

## 2026-10-18: Backups and history

- Backups keep restore points and can be restored to a chosen time.
- Backups can be encrypted with a passphrase.
- Notes keep a version history.

## 2026-10-17: Notes in other editors

- Mirror to a folder keeps your notes as Markdown files that other editors can open.
- The Yak Sync plugin brings your notes into an Obsidian vault.
