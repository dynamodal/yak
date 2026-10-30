import { PLUGIN_STORAGE_PREFIX } from '../../src/core/protocol-ids';
import { Modal, Notice, Plugin, PluginSettingTab, Setting, type App } from 'obsidian';
import * as Y from 'yjs';
import { AccountState } from '../../src/app/account-state';
import { allowsDoc } from '../../src/app/sync-filter';
import { accountDocId, accountOfDoc, readSpaces } from '../../src/core/account';
import { deviceName, isRemoved, readDevices, setDeviceName } from '../../src/core/devices';
import { DocumentStore } from '../../src/core/doc-store';
import { uuid } from '../../src/core/ids';
import { setKeeps } from '../../src/core/keeps';
import { liveRecords } from '../../src/core/schema';
import { emptyState } from '../../src/mirror/engine';
import { MirrorService, mirrorSpaces, type FolderAccess, type MirrorStore, type Persisted, type SpaceInput } from '../../src/mirror/service';
import { SyncService, type SyncStatus } from '../../src/sync/sync-service';
import { createTransport } from '../../src/sync/transport-factory';
import { indexedDbPersistence } from '../../src/core/doc-store';
import { docPersistence, indexedDbWithMigration, type BinaryStore } from './doc-persist';
import type { LinkSpace } from './links';
import { VaultFs } from './vault-fs';
import { obsidianPort } from './vault-obsidian';
import { linkSignature, relinkFiles } from './relink';
import type { VaultPort } from './vault-port';
import { analyzeVault, rootProblem, type RuleSpace, type VaultAnalysis } from './vault-rules';
import { KeyTrust } from '../../src/app/key-trust';
import { deviceFingerprint } from '../../src/core/account-keys';
import { formatFingerprint } from '../../src/core/keys';
import { PluginKeys, type KeyData } from './plugin-keys';
import { defaultDeviceName, syncStatusLine } from './device-name';

/**
 * The Yak plugin (#64): this vault is a device of the account. It joins with the sync code,
 * keeps the spaces the owner chose on the Devices page, and mirrors their notes into one root folder
 * (`Yak/<space>/…`) with the same engine as the browser folder mirror. Nothing outside the
 * root is read or written. Decisions: docs/decisions/obsidian.md.
 *
 * Device keys (#257): the vault has its own key pair and is approved like any device
 * (`plugin-keys.ts`); in an account that requires keys it signs its handshakes and joins by invite.
 */

const DEFAULT_RELAY = 'wss://yak.dynamodal.com/signal';
const DEFAULT_ROOT = 'Yak';
const LOG_LINES = 300;

interface PluginData {
  deviceId: string;
  /** The name the owner gave this device in the settings tab; unset means the default name (#118). */
  deviceName?: string;
  relay: string;
  /** The root folder in the vault, one name. */
  root: string;
  /** Documents in the plugin folder of the vault (true) or in IndexedDB, out of reach of vault sync (false). Read at start. */
  docsInVault: boolean;
  /** What the mirror keeps between passes (the engine's state, spaces left out, conflict copies). */
  mirror: Persisted;
  /** The connection log at the last save, so a later session can show what happened in the background. */
  log: string;
  /** Device keys: the pinned account key, settled space keys, and the private keys where no protected storage exists. */
  keyData: KeyData;
}

/** The plugin's own folder as a store of binary files. */
function pluginFiles(app: App, dir: string): BinaryStore {
  const adapter = app.vault.adapter;
  let made = false;
  return {
    async read(name) {
      const path = `${dir}/docs/${name}`;
      return (await adapter.exists(path)) ? new Uint8Array(await adapter.readBinary(path)) : null;
    },
    async write(name, data) {
      if (!made) {
        if (!(await adapter.exists(`${dir}/docs`))) await adapter.mkdir(`${dir}/docs`);
        made = true;
      }
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      await adapter.writeBinary(`${dir}/docs/${name}`, copy.buffer);
    },
    async remove(name) {
      const path = `${dir}/docs/${name}`;
      if (await adapter.exists(path)) await adapter.remove(path);
    },
  };
}

export default class YakPlugin extends Plugin {
  data: PluginData = { deviceId: '', relay: DEFAULT_RELAY, root: DEFAULT_ROOT, docsInVault: true, mirror: { excluded: [], state: emptyState(), conflicts: [] }, log: '', keyData: {} };
  store!: DocumentStore;
  keys!: PluginKeys;
  sync!: SyncService;
  account: AccountState | undefined;
  mirror!: MirrorService;
  vaultPort!: VaultPort;
  /** What the vault rules found at the last pass. */
  analysis: VaultAnalysis = { held: [], renames: [], notices: [] };
  private flush: (() => Promise<void>) | undefined;
  private stopMirror: (() => void) | undefined;
  private shown = new Set<string>();
  private asked = new Set<string>();

  async onload(): Promise<void> {
    this.data = { ...this.data, ...((await this.loadData()) as Partial<PluginData> | null) };
    if (!this.data.deviceId) this.data.deviceId = uuid();
    this.vaultPort = obsidianPort(this.app);
    const folder = pluginFiles(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
    if (this.data.docsInVault) {
      const files = docPersistence(folder);
      this.flush = files.flush;
      this.store = new DocumentStore(files.persist);
    } else {
      this.store = new DocumentStore(indexedDbWithMigration(folder, indexedDbPersistence));
    }
    const me = this.data.deviceId;
    const trust = new KeyTrust();
    this.sync = new SyncService(this.store, {
      deviceId: me,
      createTransport,
      // The vault name keeps two vaults on one desktop from sharing a sync code.
      storageKey: `${PLUGIN_STORAGE_PREFIX}-${this.app.vault.getName()}`,
      // Obsidian has no camera to ask for; connections use whatever addresses the webview gives.
      realAddresses: false,
      isBlocked: (id) => (this.account ? isRemoved(this.account.doc, id) : false),
      accountId: () => this.account?.id ?? '',
      identity: trust,
      // The account document, and the spaces both devices keep; never a space's private part (time entries).
      allowDoc: (docId, peerId) => {
        if (/\/private$/.test(docId)) return false;
        if (trust.required() && !(this.sync.isVerified(peerId) && trust.peer(peerId))) return false;
        if (!this.account) return accountOfDoc(docId) !== undefined && this.sync.status.paired;
        return allowsDoc({
          docId,
          peerId,
          account: this.account.doc,
          accountId: this.account.id,
          me,
          paired: this.sync.status.paired,
          pairedAccountId: this.sync.pairedAccountId,
          keys: { required: trust.required(), peerVerified: this.sync.isVerified(peerId) && trust.peer(peerId) !== undefined, peerHolds: (space) => trust.holds(space, peerId) },
        });
      },
    });
    this.keys = new PluginKeys({ me, data: this.data.keyData, save: () => this.saveData(this.data), sync: this.sync, store: this.store, trust, log: (d) => this.sync.log.log('keys', d), onChange: () => this.joinNotice() });
    void this.keys.start();
    this.store.onOpened((id) => {
      const accountId = accountOfDoc(id);
      if (!accountId) return;
      this.sync.setAccount(accountId);
      void this.attach(accountId);
    });
    this.mirror = new MirrorService({ spaces: () => this.spaceInputs(), folder: this.folderAccess(), store: this.mirrorStore() });
    this.sync.start();
    // A stored pairing knows its account: open that document from disk without waiting for a peer.
    const known = this.sync.pairedAccountId;
    if (known) void this.store.open(accountDocId(known));
    this.sync.log.log('plugin', `loaded, visibility ${document.visibilityState}`);
    this.sync.log.subscribe((e) => {
      if (e.kind === 'visibility' || e.kind === 'sync' || e.kind === 'link') void this.save();
    });
    this.registerInterval(window.setInterval(() => void this.save(), 15_000));
    this.registerDomEvent(document, 'visibilitychange', () => {
      this.sync.log.log('plugin', `visibility ${document.visibilityState}`);
      void this.save();
    });
    const touched = (path: string): void => {
      if (path.startsWith(`${this.data.root}/`)) this.mirror.notifyFolderChanged();
    };
    this.registerEvent(this.app.vault.on('create', (f) => touched(f.path)));
    this.registerEvent(this.app.vault.on('modify', (f) => touched(f.path)));
    this.registerEvent(this.app.vault.on('delete', (f) => touched(f.path)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (touched(f.path), touched(old))));
    this.mirror.subscribe((s) => {
      for (const c of s.conflicts) {
        if (this.shown.has(`conflict:${c}`)) continue;
        this.shown.add(`conflict:${c}`);
        new Notice(`Both sides changed a note: your Obsidian version is saved as "${c}".`, 10_000);
      }
      for (const n of this.analysis.notices) {
        if (this.shown.has(n)) continue;
        this.shown.add(n);
        new Notice(n, 12_000);
      }
      const unasked = this.analysis.held.filter((h) => !this.asked.has(h.id));
      if (unasked.length > 0) {
        for (const h of unasked) this.asked.add(h.id);
        new ProblemsModal(this).open();
      }
    });
    this.stopMirror = this.mirror.start();
    this.addCommand({ id: 'status', name: 'Show sync status', callback: () => new StatusModal(this).open() });
    this.addCommand({ id: 'problems', name: 'Review folders that need a decision', callback: () => new ProblemsModal(this).open() });
    this.addCommand({ id: 'sync-now', name: 'Sync notes now', callback: () => void this.mirror.run() });
    this.addSettingTab(new YakSettings(this));
  }

  onunload(): void {
    this.stopMirror?.();
    void this.flush?.();
    void this.save();
  }

  async save(): Promise<void> {
    this.data.log = this.sync.log.toText().split('\n').slice(-LOG_LINES).join('\n');
    await this.saveData(this.data);
  }

  /** Build the account state once the account document is here, and name this device. */
  private async attach(accountId: string): Promise<void> {
    if (this.account?.id === accountId) return;
    const doc = await this.store.open(accountDocId(accountId));
    const account = new AccountState(accountId, doc, this.store, this.data.deviceId);
    this.account = account;
    account.subscribe(() => void this.mirror.run());
    await account.refresh();
    // Without a name the Devices page shows an id; a vault that already has one keeps it (#118).
    if (!deviceName(doc, this.data.deviceId)) setDeviceName(doc, this.data.deviceId, this.deviceNameNow());
    this.keys.attach(doc);
  }

  private noticed = '';

  /** While joining by invite: the code to compare, until the owner approves (#257). */
  private joinNotice(): void {
    const j = this.keys.join;
    const key = `${j?.phase}:${j?.compare ?? ''}:${j?.confirmed ? 1 : 0}`;
    if (!j || key === this.noticed) return;
    this.noticed = key;
    if (j.phase === 'compare' && !j.confirmed) new Notice(`Yak: your other device must show ${j.compare}. If it does, choose "The codes match" in Settings › Yak Sync, then approve the vault there.`, 0);
    else if (j.phase === 'approved') new Notice('Yak: this vault was approved and joins your account.');
    else if (j.phase === 'declined' || j.phase === 'failed') new Notice(`Yak: ${j.error ?? 'the other device declined this vault.'}`);
  }

  /** The name this device joins under: the owner's choice, else vault, platform and a short id (#118). */
  deviceNameNow(): string {
    const chosen = this.data.deviceName?.trim();
    if (chosen) return chosen;
    return defaultDeviceName(this.app.vault.getName(), this.app.isMobile === true, this.data.deviceId);
  }

  /** The name in the account, once it has arrived, else the one this device will join under. */
  shownDeviceName(): string {
    const account = this.accountDoc();
    return (account && deviceName(account.doc, this.data.deviceId)) ?? this.deviceNameNow();
  }

  /** Rename this device; an empty name goes back to the default. */
  async renameDevice(name: string): Promise<void> {
    const trimmed = name.trim();
    this.data.deviceName = trimmed || undefined;
    await this.saveData(this.data);
    const account = this.accountDoc();
    if (account) setDeviceName(account.doc, this.data.deviceId, this.deviceNameNow());
  }

  /** Join with a code from the app; in an account that requires keys, the code is a one-time invite and the vault waits for approval. */
  joinWithCode(code: string): Promise<void> {
    return this.keys.joinWithCode(code, this.data.relay, this.deviceNameNow());
  }

  private spaceInputs(): SpaceInput[] {
    const a = this.account?.current;
    return (a?.spaces ?? []).flatMap((s) => {
      const doc = a?.spaceDocs.get(s.id);
      return doc ? [{ id: s.id, name: s.name, doc }] : [];
    });
  }

  /** Folder names of the spaces being mirrored. */
  private ruleSpaces(): RuleSpace[] {
    return mirrorSpaces(this.spaceInputs(), this.data.mirror.excluded).map((m) => ({ id: m.id, name: this.spaceInputs().find((s) => s.id === m.id)?.name ?? m.folder, folder: m.folder }));
  }

  /** Spaces with their folders and note paths, for link translation. */
  linkSpaces(): LinkSpace[] {
    const docs = new Map(this.spaceInputs().map((s) => [s.id, s.doc]));
    return this.ruleSpaces().map((s) => ({ ...s, paths: liveRecords<{ path: string }>(docs.get(s.id)!, 'notes').map((n) => n.path) }));
  }

  private folderAccess(): FolderAccess {
    return {
      current: async () => {
        const root = this.data.root;
        const spaces = this.ruleSpaces();
        const archived = (this.account?.current.allSpaces ?? []).filter((s) => s.archived).map((s) => s.name);
        const analysis = analyzeVault(this.vaultPort, root, spaces, this.data.mirror.state, archived);
        // A folder renamed in the vault is named back; that is not a space rename.
        for (const r of analysis.renames) {
          try {
            await this.vaultPort.rename(`${root}/${r.from}`, `${root}/${r.space.folder}`);
            this.sync.log.log('plugin', `renamed folder "${r.from}" back to "${r.space.folder}"`);
            analysis.notices.push(`Renaming a space's folder does not rename the space. "${r.from}" is named "${r.space.folder}" again; rename the space in Yak instead.`);
          } catch (e) {
            analysis.held.push(r.space);
            this.sync.log.log('plugin', `could not rename folder back: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        this.analysis = analysis;
        // Files written before a space was kept here get their links spelled for the spaces kept now.
        const links = this.linkSpaces();
        const signature = linkSignature(links);
        if (signature !== this.linkSig) {
          this.linkSig = signature;
          await relinkFiles(this.vaultPort, root, links.filter((l) => !analysis.held.some((h) => h.id === l.id)), this.data.mirror.state);
        }
        // A held space is left out of the pass, so its notes are not read as deleted.
        this.heldIds = new Set(analysis.held.map((h) => h.id));
        return { state: 'granted', name: root, id: `${this.app.vault.getName()}:${root}`, fs: new VaultFs(this.vaultPort, root, () => this.linkSpaces()) };
      },
    };
  }

  private heldIds = new Set<string>();
  private linkSig = '';

  private mirrorStore(): MirrorStore {
    return {
      load: async () => {
        const p = this.data.mirror;
        // Held spaces count as left out for this pass only; the saved list is the owner's choice.
        return { ...p, excluded: [...new Set([...p.excluded, ...this.heldIds])] };
      },
      save: async (p) => {
        this.data.mirror = { ...p, excluded: p.excluded.filter((id) => !this.heldIds.has(id) || this.data.mirror.excluded.includes(id)) };
        await this.saveData(this.data);
      },
    };
  }

  /** The owner chose to have the folder back: write the space's notes out again. */
  async restoreFolder(space: RuleSpace): Promise<void> {
    const state = this.data.mirror.state;
    delete state.spaces[space.id];
    await this.saveData(this.data);
    await this.mirror.run();
  }

  /** The owner chose to stop keeping the space on this device. */
  async stopKeeping(space: RuleSpace): Promise<void> {
    if (!this.account) return;
    setKeeps(this.account.doc, this.data.deviceId, space.id, false);
    delete this.data.mirror.state.spaces[space.id];
    await this.saveData(this.data);
    await this.mirror.run();
  }

  /** Change the root folder; the mirror starts clean and deletes nothing. */
  async setRoot(root: string): Promise<void> {
    this.data.root = root;
    await this.saveData(this.data);
    await this.mirror.reset();
    void this.mirror.run();
  }

  /** The account document, if it has arrived. */
  accountDoc(): { doc: Y.Doc; id: string } | undefined {
    for (const [id, doc] of this.store.opened()) {
      const account = accountOfDoc(id);
      if (account) return { doc, id: account };
    }
    return undefined;
  }
}

/** What the settings tab says about stored data; the same facts are in obsidian/README.md. */
const STORAGE_NOTES = [
  'The sync code is kept in Obsidian\'s local storage. Any plugin you install can read it.',
  'Documents (notes, tasks, projects and the account) and the mirror state are kept under .obsidian/plugins/yak-sync/ unless you turn the option below off. Vault sync copies that folder without encryption.',
  'Time entries never reach this plugin.',
];

/** What the settings tab says about the vault's device keys (S-76p). */
function keyNotes(p: YakPlugin): string[] {
  const where =
    p.keys.storage === 'protected'
      ? "This vault's device keys are kept in protected browser key storage: they cannot be read out or copied, not even by vault sync."
      : p.keys.storage === 'settings'
        ? "This vault's device keys are kept in the plugin's settings file (.obsidian/plugins/yak-sync/data.json), because this Obsidian has no protected key storage. Vault sync copies that file: whoever reads the vault can act as this device."
        : 'This Obsidian cannot make device keys, so the vault cannot join an account that requires them.';
  return [where];
}

class YakSettings extends PluginSettingTab {
  private off: (() => void) | undefined;

  constructor(private readonly plugin: YakPlugin) {
    super(plugin.app, plugin);
  }

  hide(): void {
    this.off?.();
    this.off = undefined;
  }

  /** Not joined, joining, or syncing with N of M devices (#120). */
  private statusText(): string {
    const p = this.plugin;
    const s = p.sync.status;
    const account = p.accountDoc();
    const devices = account ? [...readDevices(account.doc).values()].filter((d) => !d.removed && !d.left).length : 0;
    const phase = p.keys.join?.phase;
    return syncStatusLine({
      joined: s.paired,
      joining: phase === 'asking' || phase === 'compare',
      connected: s.peers.filter((x) => x.state === 'connected').length,
      devices,
    });
  }

  display(): void {
    const el = this.containerEl;
    this.off?.();
    el.textContent = '';
    let code = '';
    const joined = this.plugin.sync.status.paired;
    const status = new Setting(el).setName('Sync status').setDesc(this.statusText());
    this.off = this.plugin.sync.subscribe(() => {
      status.setDesc(this.statusText());
    });
    new Setting(el)
      .setName('Device name')
      .setDesc('How this vault appears on the Devices page. Leave it empty for the default: vault, phone or desktop, and a short id.')
      .addText((t) => {
        t.setPlaceholder(this.plugin.deviceNameNow())
          .setValue(this.plugin.shownDeviceName())
          .onChange((v) => {
            void this.plugin.renameDevice(v);
          });
      });
    const keys = this.plugin.keys.keys;
    if (keys) {
      let shown = '';
      const fp = new Setting(el).setName('This vault\'s fingerprint').setDesc('Compare it with the one the app shows for this vault before you approve it.');
      fp.addButton((b) =>
        b.setButtonText('Copy').onClick(() => {
          if (!shown) return;
          navigator.clipboard?.writeText(shown).then(
            () => {
              new Notice('Fingerprint copied.');
            },
            () => {
              new Notice('Could not copy. Select the fingerprint and copy it.');
            },
          );
        }),
      );
      void deviceFingerprint({ deviceId: this.plugin.data.deviceId, ...keys.publicKeys }).then((f) => {
        // A block body: Obsidian 1.14's Setting is a thenable, so a promise must never resolve with it (#91).
        shown = formatFingerprint(f, 2);
        fp.setDesc(`${shown}. Compare it with the one the app shows for this vault before you approve it.`);
      });
    }
    const join = this.plugin.keys.join;
    if (join?.phase === 'compare' && !join.confirmed)
      new Setting(el)
        .setName('Compare the code')
        .setDesc(`Your other device must show ${join.compare}.`)
        .addButton((b) =>
          b
            .setButtonText('The codes match')
            .setCta()
            .onClick(() => {
              this.plugin.keys.confirmJoin();
              this.display();
            }),
        )
        .addButton((b) => b.setButtonText("Don't match? Start again").onClick(() => void this.plugin.keys.restartJoin().then(() => this.display())));
    else if (join?.phase === 'compare') new Setting(el).setName('Approve this vault').setDesc(`Now approve it on your other device, which shows ${join.compare}.`);
    else if (join?.phase === 'declined' || join?.phase === 'failed') new Setting(el).setName('Not joined').setDesc(join.error ?? 'The other device declined this vault.');
    new Setting(el)
      .setName('Sync code')
      .setDesc('From Yak, Settings › Devices and sync: the sync code, or a one-time code when your account requires device keys. Adds this vault as a device. Then choose which spaces it keeps in its row there.')
      .addText((t) => t.setPlaceholder('XXXX-XXXX-…').onChange((v) => (code = v)))
      .addButton((b) =>
        b
          .setButtonText('Join')
          .setCta()
          .onClick(() => {
            this.plugin.joinWithCode(code).then(
              () => {
                new Notice('Joining…');
              },
              (e: unknown) => {
                new Notice(e instanceof Error ? e.message : String(e));
              },
            );
          }),
      );
    if (joined)
      new Setting(el)
        .setName('Leave')
        .setDesc('Forget the sync code on this device. Notes already in the folder stay.')
        .addButton((b) =>
          b.setButtonText('Forget sync code').onClick(() => {
            this.plugin.sync.unpair();
            new Notice('Sync code forgotten.');
            this.display();
          }),
        );
    new Setting(el).setName('Advanced').setHeading();
    new Setting(el)
      .setName('Root folder')
      .setDesc('The one folder in this vault that Yak reads and writes. Each space is a folder inside it.')
      .addText((t) =>
        t.setValue(this.plugin.data.root).onChange((v) => {
          const root = v.trim();
          if (rootProblem(root) || root === this.plugin.data.root) return;
          void this.plugin.setRoot(root);
        }),
      );
    new Setting(el)
      .setName('Files in notes')
      .setDesc('Files go in <root>/<space>/attachments/, one folder per space. Yak ignores Obsidian\'s "Default location for new attachments", including "Same folder as current file". A file Obsidian saves elsewhere in a space folder still works by name; Yak copies it into attachments/. Deleting a file there deletes it on every device.');
    new Setting(el)
      .setName('Signaling server')
      .setDesc('Relay (wss://…) or ntfy address. Pairing and reconnecting go through it; documents never do.')
      .addText((t) => {
        t.inputEl.style.width = '100%';
        t.inputEl.style.minWidth = '22em';
        t.setValue(this.plugin.data.relay).onChange((v) => {
          this.plugin.data.relay = v.trim() || DEFAULT_RELAY;
          void this.plugin.saveData(this.plugin.data);
        });
      });
    const where = document.createElement('details');
    where.setAttribute('data-where-data', '');
    const summary = document.createElement('summary');
    summary.textContent = 'Where Yak keeps your data';
    where.append(summary);
    el.append(where);
    for (const line of [...STORAGE_NOTES, ...keyNotes(this.plugin)]) {
      const p = document.createElement('p');
      p.textContent = line;
      where.append(p);
    }
    new Setting(where)
      .setName('Keep documents in the vault')
      .setDesc('Off: documents are kept in this app\'s own database (IndexedDB) and vault sync never copies them. Takes effect after you reload Obsidian. Turn it on again only if the database is cleared often.')
      .addToggle((t) =>
        t.setValue(this.plugin.data.docsInVault).onChange((v) => {
          this.plugin.data.docsInVault = v;
          void this.plugin.saveData(this.plugin.data);
          new Notice('Reload Obsidian to apply.');
        }),
      );
  }
}

class ProblemsModal extends Modal {
  constructor(private readonly plugin: YakPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    const el = this.contentEl;
    el.textContent = '';
    const held = this.plugin.analysis.held;
    const h = document.createElement('h3');
    h.textContent = held.length ? 'A space folder is missing' : 'Nothing needs a decision';
    el.append(h);
    for (const space of held) {
      const p = document.createElement('p');
      p.textContent = `The folder "${this.plugin.data.root}/${space.folder}" is gone. Your notes in "${space.name}" are safe in Yak and nothing was deleted.`;
      el.append(p);
      const row = document.createElement('div');
      for (const [label, run] of [
        ['Restore the folder', () => this.plugin.restoreFolder(space)],
        ['Stop keeping this space here', () => this.plugin.stopKeeping(space)],
      ] as const) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => {
          void run().then(() => this.close());
        });
        row.append(b);
      }
      el.append(row);
    }
  }
}

class StatusModal extends Modal {
  private off: (() => void) | undefined;
  private timer: number | undefined;

  constructor(private readonly plugin: YakPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.off = this.plugin.sync.subscribe(() => this.render());
    this.timer = window.setInterval(() => this.render(), 2000);
  }

  onClose(): void {
    this.off?.();
    window.clearInterval(this.timer);
  }

  private render(): void {
    const p = this.plugin;
    const s: SyncStatus = p.sync.status;
    const account = p.accountDoc();
    const m = p.mirror.state;
    const lines: string[] = [
      `this device: ${p.data.deviceId.slice(0, 8)}`,
      `paired: ${s.paired}   link: ${s.state}   signaling problem: ${s.signalingProblem}`,
      `signaling: ${s.signalingUrl}`,
      `peers: ${s.peers.map((x) => `${x.id.slice(0, 8)} ${x.state}`).join(', ') || 'none'}`,
      '',
      account ? `account ${account.id.slice(0, 8)}` : 'account document: not received yet',
    ];
    if (account) {
      const kept = new Set((p.account?.current.spaces ?? []).map((x) => x.id));
      for (const sp of readSpaces(account.doc)) lines.push(`  space: ${sp.name}${kept.has(sp.id) ? ' (kept here)' : ' (not kept here)'}`);
      for (const [id, d] of readDevices(account.doc)) lines.push(`  device: ${d.name ?? id.slice(0, 8)}${d.removed ? ' (removed)' : ''}${d.left ? ' (left)' : ''}`);
    }
    lines.push('', `notes: last pass ${m.lastRunAt ?? 'not yet'}${m.running ? ' (running)' : ''}${m.error ? `, error: ${m.error}` : ''}`);
    for (const e of m.errors) lines.push(`  left alone: ${e}`);
    for (const n of p.analysis.notices) lines.push(`  ${n}`);
    for (const h of p.analysis.held) lines.push(`  needs a decision: folder of "${h.name}" is gone`);
    const el = this.contentEl;
    el.textContent = '';
    const pre = document.createElement('pre');
    pre.setAttribute('data-plugin-status', '');
    pre.textContent = lines.join('\n');
    el.append(pre);
    const log = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Connection log';
    const logText = document.createElement('pre');
    logText.textContent = p.sync.log.toText().split('\n').slice(-60).join('\n');
    log.append(summary, logText);
    el.append(log);
    if (p.data.log) {
      const prev = document.createElement('details');
      const ps = document.createElement('summary');
      ps.textContent = 'Log saved at the last write (shows what happened while Obsidian was in the background)';
      const pt = document.createElement('pre');
      pt.textContent = p.data.log;
      prev.append(ps, pt);
      el.append(prev);
    }
  }
}
