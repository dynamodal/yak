// End-to-end: the Obsidian plugin (obsidian/) as a device of the account. The plugin bundle is loaded
// into a plain page (no Content-Security-Policy, so it can be evaluated) with an in-memory stand-in
// for the parts of the Obsidian API it uses; the app runs in another profile and the two meet through
// the site's mock relay (the same path as a phone). Android Obsidian itself cannot be driven from here.
//
//   npm run e2e obsidian
//
// Joins with a one-time code (compare, then the app approves); keeps only the spaces the owner ticks on the Devices page; notes become
// files under the root folder and edits go both ways; cross-space links are written as vault paths;
// nothing outside the root is touched; a deleted space folder deletes no note and asks.
//
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BASE, launch, check, watchPage, until, finish, startSyncing, unlockIfAsked, openRow } from './lib.mjs';

// The bundle is rebuilt each run (about a second), so the suite never tests a stale one.
execSync('npm run build:obsidian', { cwd: new URL('../..', import.meta.url), stdio: 'ignore' });
const bundle = readFileSync(new URL('../../obsidian/dist/main.js', import.meta.url), 'utf8');

const browser = await launch();
const app = await (await browser.newContext({ permissions: ['camera'] })).newPage();
watchPage(app, 'app');
await app.goto(`${BASE}?test#/devices`);
await app.waitForFunction(() => window.__app?.spaces().personal && window.__app?.spaces().work, null, { timeout: 15000 });

// Notes made in the app before the plugin exists. The mirror test hook lives on the Mirror route.
await app.evaluate(() => (location.hash = '#/settings/notes'));
await app.waitForFunction(() => window.__mirror !== undefined, null, { timeout: 15000 });
const A = (fn, arg) => app.evaluate(fn, arg);
await A(() => {
  window.__mirror.addNote('personal', 'Ideas/Plan.md', 'first');
  window.__mirror.addNote('work', 'Brief.md', 'the brief');
  window.__mirror.addNote('personal', 'Home.md', 'See [[Work:Brief]]');
});

// Start syncing and make the one-time code the vault joins with.
await app.evaluate(() => (location.hash = '#/devices'));
await startSyncing(app);
await app.getByRole('button', { name: 'Make a one-time code' }).click();
const code = (await app.locator('[data-invite-code]').innerText()).trim();

// The plugin's page: a secure context like Obsidian's own, with the policy bypassed so the bundle can be evaluated.
const page = await (await browser.newContext({ bypassCSP: true })).newPage();
watchPage(page, 'plugin');
await page.goto(`${BASE}probe.html`);
const relay = BASE.replace(/^http/, 'ws').replace(/\/?$/, '/signal');

/** Load the plugin bundle into a page with an in-memory vault named `vault`, and join with `code`. */
const setupPlugin = async ({ bundle, relay, code, vault: vaultName }) => {
    // An in-memory vault with Obsidian's shapes.
    class TAbstractFile {
      constructor(path) {
        this.path = path;
        this.name = path.slice(path.lastIndexOf('/') + 1);
      }
    }
    class TFile extends TAbstractFile {
      constructor(path) {
        super(path);
        this.stat = { mtime: 0, size: 0 };
      }
    }
    class TFolder extends TAbstractFile {
      constructor(path) {
        super(path);
        this.children = [];
      }
    }
    const texts = new Map();
    const nodes = new Map();
    const listeners = { create: [], modify: [], delete: [], rename: [] };
    const emit = (name, ...args) => listeners[name].forEach((cb) => cb(...args));
    let clock = 0;
    const trashed = [];
    const touch = (f, text) => {
      texts.set(f.path, text);
      f.stat = { mtime: ++clock, size: text.length };
    };
    const vault = {
      adapter: {
        binary: new Map(),
        async exists(p) {
          return this.binary.has(p) || [...this.binary.keys()].some((k) => k.startsWith(`${p}/`)) || p.endsWith('/docs');
        },
        async mkdir() {},
        async readBinary(p) {
          return this.binary.get(p);
        },
        async writeBinary(p, d) {
          this.binary.set(p, d);
        },
      },
      getName: () => vaultName,
      getFiles: () => [...nodes.values()].filter((n) => n instanceof TFile),
      getAllLoadedFiles: () => [...nodes.values()],
      getAbstractFileByPath: (p) => nodes.get(p) ?? null,
      read: async (f) => texts.get(f.path),
      create: async (path, data) => {
        const f = new TFile(path);
        nodes.set(path, f);
        touch(f, data);
        emit('create', f);
        return f;
      },
      modify: async (f, data) => {
        touch(f, data);
        emit('modify', f);
      },
      rename: async (f, to) => {
        const from = f.path;
        for (const [p, n] of [...nodes]) {
          if (p === from || p.startsWith(`${from}/`)) {
            nodes.delete(p);
            n.path = to + p.slice(from.length);
            nodes.set(n.path, n);
            if (texts.has(p)) (texts.set(n.path, texts.get(p)), texts.delete(p));
          }
        }
        emit('rename', f, from);
      },
      createFolder: async (path) => {
        const f = new TFolder(path);
        nodes.set(path, f);
        return f;
      },
      on: (name, cb) => (listeners[name].push(cb), { name, cb }),
    };
    const fileManager = {
      trashFile: async (f) => {
        for (const p of [...nodes.keys()]) if (p === f.path || p.startsWith(`${f.path}/`)) (nodes.delete(p), texts.delete(p));
        trashed.push(f.path);
        emit('delete', f);
      },
    };
    const saved = { value: null };
    const commands = [];
    const notices = [];
    class Plugin {
      constructor() {
        this.app = { vault, fileManager };
        this.manifest = { id: 'yak-sync', dir: '.obsidian/plugins/yak-sync' };
      }
      async loadData() {
        return saved.value;
      }
      async saveData(d) {
        saved.value = JSON.parse(JSON.stringify(d));
      }
      addCommand(c) {
        commands.push(c);
      }
      addSettingTab(tab) {
        window.__settingTab = tab;
      }
      registerDomEvent(el, type, cb) {
        el.addEventListener(type, cb);
      }
      registerInterval(id) {
        return id;
      }
      registerEvent() {}
    }
    class Modal {
      constructor() {
        this.contentEl = document.body.appendChild(document.createElement('div'));
        this.contentEl.setAttribute('data-modal', '');
      }
      open() {
        this.onOpen();
      }
      close() {
        this.onClose?.();
        this.contentEl.remove();
      }
    }
    class Notice {
      constructor(m) {
        notices.push(m);
      }
      hide() {}
    }
    // The settings tab, with Obsidian 1.14's Setting: a thenable (`then` calls back with itself), so a
    // promise resolved with one never settles (#91). Components accept any call and return themselves.
    const component = () => new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : k === 'inputEl' ? document.createElement('input') : () => component()) });
    class Setting {
      constructor(el) {
        this.row = el.appendChild(document.createElement('div'));
      }
      setName(n) {
        this.row.setAttribute('data-name', n);
        return this;
      }
      setHeading() {
        this.row.setAttribute('data-heading', '');
        return this;
      }
      setDesc(d) {
        this.row.setAttribute('data-desc', d);
        return this;
      }
      addText(cb) {
        cb(component());
        return this;
      }
      addToggle(cb) {
        cb(component());
        return this;
      }
      addButton(cb) {
        cb(component());
        return this;
      }
      addDropdown(cb) {
        cb(component());
        return this;
      }
      then(cb) {
        cb(this);
        return this;
      }
    }
    class PluginSettingTab {
      constructor(app) {
        this.app = app;
        this.containerEl = document.body.appendChild(document.createElement('div'));
        this.containerEl.setAttribute('data-settings-tab', '');
      }
    }
    const stub = { Plugin, Modal, Notice, PluginSettingTab, Setting, TFile, TFolder, TAbstractFile };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', bundle)(module, module.exports, (n) => {
      if (n !== 'obsidian') throw new Error(`unexpected require ${n}`);
      return stub;
    });
    // A note of the owner's outside the root: the plugin must leave it alone.
    await vault.create('Daily/2026-10-17.md', 'mine');
    const plugin = new module.exports();
    await plugin.onload();
    window.__plugin = plugin;
    window.__commands = commands;
    window.__notices = notices;
    window.__trashed = trashed;
    window.__vault = {
      text: (p) => texts.get(p),
      paths: () => [...texts.keys()].sort(),
      folders: () => [...nodes.values()].filter((n) => n instanceof TFolder).map((n) => n.path),
      // The owner edits or creates a file in Obsidian.
      put: async (p, text) => {
        const f = nodes.get(p);
        if (f) return vault.modify(f, text);
        const dir = p.slice(0, p.lastIndexOf('/'));
        if (dir && !nodes.has(dir)) await vault.createFolder(dir);
        return vault.create(p, text);
      },
      removeFolder: (p) => fileManager.trashFile(nodes.get(p)),
    };
    plugin.data.relay = relay;
    await plugin.joinWithCode(code);
};
await page.evaluate(setupPlugin, { bundle, relay, code, vault: 'TestVault' });
const P = (fn, arg) => page.evaluate(fn, arg);
// The vault shows a compare code; it confirms, and the app (already unlocked by starting) approves.
await until(() => P(() => window.__plugin.keys.join?.phase === 'compare').catch(() => false), 30000);
await P(() => window.__plugin.keys.confirmJoin());
await app.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await unlockIfAsked(app);
const settle = () => P(async () => (await window.__plugin.mirror.run(), window.__plugin.mirror.whenIdle()));
const appPass = () => A(async () => (await window.__mirror.run(), window.__mirror.idle()));
const plugged = (cond, ms = 20000) => until(() => P(cond).catch(() => false), ms);

const t = await plugged(() => window.__plugin.accountDoc() !== undefined);
check(t >= 0, `the account document arrived through the relay${t >= 0 ? ` in ${t} ms` : ''}`);

// It is a device of its own; nothing reaches it until the owner ticks spaces.
await app.evaluate(() => (location.hash = '#/settings'));
const vaultName = await P(() => window.__plugin.deviceNameNow());
check(/^Obsidian \(TestVault, desktop, [0-9a-f]{4}\)$/.test(vaultName), `the default device name has the platform and a short id (${vaultName})`);
await plugged(() => window.__plugin.accountDoc() !== undefined && window.__plugin.shownDeviceName() === window.__plugin.deviceNameNow());
await openRow(app, vaultName);
await app.getByLabel(`${vaultName} keeps Personal`).waitFor({ timeout: 20000 });
check(true, 'Settings lists the plugin by name, with a keep chip per space');
await settle();
check(!(await P(() => window.__vault.paths().some((p) => p.startsWith('Yak/')))), 'no notes are written before the owner chooses spaces');
check((await P(() => [...window.__plugin.store.opened().keys()].filter((id) => id.startsWith('space/')).length)) === 0, 'no space document is held yet');

await app.getByLabel(`${vaultName} keeps Personal`).check();
const came = await plugged(async () => (await window.__plugin.mirror.run(), window.__vault.text('Yak/Personal/Ideas/Plan.md') === 'first'), 30000);
check(came >= 0, 'a kept space becomes a folder of files under the root');
check((await P(() => window.__vault.text('Yak/Work/Brief.md'))) === undefined, 'a space that is not kept is not written');
check((await P(() => window.__vault.text('Yak/Personal/Home.md'))) === 'See [[Work:Brief]]', 'a link into a space not kept here is left as it is');

await app.getByLabel(`${vaultName} keeps Work`).check();
const work = await plugged(async () => (await window.__plugin.mirror.run(), window.__vault.text('Yak/Work/Brief.md') === 'the brief'), 30000);
check(work >= 0, 'ticking the second space adds its folder');
await plugged(async () => (await window.__plugin.mirror.run(), window.__vault.text('Yak/Personal/Home.md')?.includes('Yak/Work/Brief')));
check((await P(() => window.__vault.text('Yak/Personal/Home.md'))) === 'See [[Yak/Work/Brief|Brief]]', 'a cross-space link is written as a vault path');

// Obsidian to the app.
await P(() => window.__vault.put('Yak/Personal/Ideas/Plan.md', 'edited in Obsidian'));
await P(() => window.__vault.put('Yak/Personal/Inbox.md', 'written in Obsidian'));
await settle();
const reached = await until(() => A(() => window.__mirror.notes('personal')).then((n) => n['Ideas/Plan.md'] === 'edited in Obsidian' && n['Inbox.md'] === 'written in Obsidian'), 20000);
check(reached >= 0, 'an edit and a new file in Obsidian reach the app');
check((await A(() => window.__mirror.notes('personal')))['Home.md'] === 'See [[Work:Brief]]', 'the link is a space link again in the note');

// The app to Obsidian.
await A(() => window.__mirror.appendToNote('personal', 'Inbox.md', ' + app'));
const back = await plugged(async () => (await window.__plugin.mirror.run(), window.__vault.text('Yak/Personal/Inbox.md') === 'written in Obsidian + app'), 30000);
check(back >= 0, 'an edit in the app reaches the file');

// Vault rules.
await P(() => window.__vault.put('Yak/Loose.md', 'at the root'));
await P(() => window.__vault.put('Yak/Ideas/One.md', 'in a folder that is no space'));
await settle();
check((await P(() => window.__notices.filter((n) => n.includes('not synced') || n.includes('not a space')).length)) === 2, 'a root note and a stray folder each get a notice');
check(!Object.keys(await A(() => window.__mirror.notes('personal'))).some((p) => p.includes('Loose') || p.includes('One')), 'and are not synced');

await P(() => window.__vault.removeFolder('Yak/Work'));
await settle();
check(Object.keys(await A(() => window.__mirror.notes('work'))).includes('Brief.md'), 'deleting a space folder deletes no note');
check((await P(() => document.querySelector('[data-modal]')?.innerText ?? '')).includes('Restore the folder'), 'and asks what to do');
await P(() => [...document.querySelectorAll('[data-modal] button')].find((b) => b.textContent === 'Restore the folder').click());
const restored = await plugged(async () => (await window.__plugin.mirror.run(), window.__vault.text('Yak/Work/Brief.md') === 'the brief'), 20000);
check(restored >= 0, 'restoring writes the folder again');

// Nothing outside the root, and no time entries.
check((await P(() => window.__vault.text('Daily/2026-10-17.md'))) === 'mine', 'a note outside the root is untouched');
check((await P(() => window.__trashed.every((p) => p.startsWith('Yak/')))), 'only the root was ever trashed from');
check((await P(() => [...window.__plugin.store.opened().keys()].filter((id) => id.endsWith('/private') && window.__plugin.store.get(id).getMap('time_entries').size > 0).length)) === 0, 'no time entries reach the plugin');

// The save waits for a pause in edits; no explicit flush here, as a phone would not give one.
await new Promise((r) => setTimeout(r, 2500));
const files = await P(() => [...window.__plugin.app.vault.adapter.binary.keys()].filter((k) => k.endsWith('.bin')).length);
check(files >= 3, `documents are saved in the plugin folder (${files} files)`);
check((await P(() => window.__plugin.data.log)).includes('loaded'), 'the connection log is saved for later sessions');
const vaultKeys = await P(() => Object.keys(localStorage).filter((k) => k.startsWith('yak-sync-TestVault')));
check(vaultKeys.length === 1, `the pairing is stored under a vault-specific key (${vaultKeys.join(', ')})`);

// Device keys (#257): the vault has its own keys, was approved at the join, and a second vault joins by invite.
check((await P(() => window.__plugin.keys.storage)) === 'protected', 'the vault keeps its device keys in protected browser storage');
check(await plugged(() => window.__plugin.keys.trust.required() && window.__plugin.keys.trust.proof !== undefined, 30000) >= 0, 'the vault is approved and knows keys are required');
await A(() => window.__mirror.appendToNote('personal', 'Inbox.md', ' + keys'));
await A(() => (location.hash = '#/settings/notes'));
await A(() => window.__mirror.run());
const signed = await plugged(async () => (await window.__plugin.mirror.run(), window.__vault.text('Yak/Personal/Inbox.md')?.endsWith('+ keys')), 40000);
check(signed >= 0, 'notes keep syncing to the vault with keys required');

await A(() => (location.hash = '#/settings/devices/add'));
await app.getByRole('button', { name: /Make a (new )?one-time code/ }).click();
const invite = (await app.locator('[data-invite-code]').innerText()).trim();
const second = await (await browser.newContext({ bypassCSP: true })).newPage();
watchPage(second, 'second');
await second.goto(`${BASE}probe.html`);
await second.evaluate(setupPlugin, { bundle, relay, code: invite, vault: 'Second' });
const S = (fn, arg) => second.evaluate(fn, arg);
await until(() => S(() => window.__plugin.keys.join?.phase === 'compare').catch(() => false), 30000);
const vaultCompare = await S(() => window.__plugin.keys.join?.compare);
const appCompare = await app.locator('[data-compare]').first().innerText({ timeout: 30000 });
check(!!vaultCompare && vaultCompare === appCompare, `the vault and the app show the same code (${vaultCompare} / ${appCompare})`);
check((await S(() => window.__notices.some((n) => n.includes(window.__plugin.keys.join.compare)))), 'the vault shows the code in a notice');
await S(() => window.__plugin.keys.confirmJoin());
await app.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
await unlockIfAsked(app);
check(await until(() => S(() => window.__plugin.accountDoc() !== undefined && window.__plugin.keys.trust.proof !== undefined && window.__plugin.keys.trust.required()).catch(() => false), 40000) >= 0, 'the second vault joins by invite, approved, with keys required');
check(await until(() => S(() => window.__plugin.accountDoc()?.id).then(async (id) => id === (await A(() => window.__app.accountId()))), 20000) >= 0, 'in the same account');

// Obsidian 1.14 froze on this tab once keys existed (#91): open it now that they do, and check the page answers.
await P(() => window.__settingTab.display());
const names = await P(() => [...document.querySelectorAll('[data-settings-tab] [data-name]')].map((r) => r.getAttribute('data-name')));
check(names[0] === 'Sync status' && names.indexOf('Device name') < names.indexOf('Sync code') && names.indexOf('Sync code') < names.indexOf('Advanced') && names.indexOf('Advanced') < names.indexOf('Root folder') && names.indexOf('Signaling server') < names.indexOf('Keep documents in the vault'), `the settings tab order: ${names.join(' > ')}`);
check(names.includes('Leave'), 'a joined vault offers Leave');
check(await P(() => document.querySelector('[data-settings-tab] [data-name="Advanced"]').hasAttribute('data-heading')), 'Advanced is a Setting heading');
check(await P(() => document.querySelector('[data-settings-tab] [data-name="Sync status"]').getAttribute('data-desc').startsWith('Syncing')), 'the status line says the vault is syncing');
await P(() => window.__plugin.renameDevice('Kitchen tablet'));
check((await P(() => window.__plugin.shownDeviceName())) === 'Kitchen tablet', 'renaming the device from the settings changes its name in the account');
await P(() => window.__plugin.renameDevice(''));
check((await P(() => window.__plugin.shownDeviceName())) === vaultName, 'an empty name goes back to the default');
check(
  await P(() => document.querySelector('[data-settings-tab] [data-name="This vault\'s fingerprint"]') !== null),
  'the settings tab shows the fingerprint row once the vault has keys',
);
const fpDone = await plugged(() => /\w{4}/.test(document.querySelector('[data-settings-tab] [data-name="This vault\'s fingerprint"]').getAttribute('data-desc') ?? '') && !document.querySelector('[data-settings-tab] [data-name="This vault\'s fingerprint"]').getAttribute('data-desc').startsWith('Compare'), 10000);
check(fpDone >= 0, 'the fingerprint fills in and the page still responds');
check((await Promise.race([P(() => 1 + 1), new Promise((r) => setTimeout(() => r('hung'), 5000))])) === 2, 'the page answers after the settings tab opens');

await finish(browser);
