/**
 * The part of the Obsidian API the plugin uses, declared here so the repo takes no dependency on the
 * `obsidian` package (it pins exact CodeMirror versions that clash with the app's, decision O1).
 * Keep to what the e2e stand-in (`scripts/e2e/obsidian.mjs`) also provides.
 */
declare module 'obsidian' {
  export interface Stat {
    mtime: number;
    size: number;
  }
  export class TAbstractFile {
    path: string;
    name: string;
  }
  export class TFile extends TAbstractFile {
    stat: Stat;
  }
  export class TFolder extends TAbstractFile {
    children: TAbstractFile[];
  }
  export interface EventRef {
    __brand?: never;
  }
  export class Vault {
    adapter: DataAdapter;
    getName(): string;
    getFiles(): TFile[];
    getAllLoadedFiles(): TAbstractFile[];
    getAbstractFileByPath(path: string): TAbstractFile | null;
    read(file: TFile): Promise<string>;
    create(path: string, data: string): Promise<TFile>;
    modify(file: TFile, data: string): Promise<void>;
    readBinary(file: TFile): Promise<ArrayBuffer>;
    createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
    modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
    rename(file: TAbstractFile, newPath: string): Promise<void>;
    createFolder(path: string): Promise<TFolder>;
    on(name: 'create' | 'modify' | 'delete', cb: (file: TAbstractFile) => void): EventRef;
    on(name: 'rename', cb: (file: TAbstractFile, oldPath: string) => void): EventRef;
  }
  export interface DataAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    readBinary(path: string): Promise<ArrayBuffer>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    remove(path: string): Promise<void>;
  }
  export class App {
    vault: Vault;
    /** True on a phone or tablet. */
    isMobile?: boolean;
    fileManager: { trashFile(file: TAbstractFile): Promise<void> };
  }
  export interface PluginManifest {
    id: string;
    dir?: string;
  }
  export class Plugin {
    app: App;
    manifest: PluginManifest;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    addCommand(command: { id: string; name: string; callback: () => void }): void;
    addSettingTab(tab: PluginSettingTab): void;
    registerDomEvent(el: Document | Window, type: string, callback: (e: Event) => void): void;
    registerInterval(id: number): number;
    registerEvent(ref: EventRef): void;
    onunload(): void;
  }
  export class PluginSettingTab {
    constructor(app: App, plugin: Plugin);
    containerEl: HTMLElement;
    display(): void;
    hide(): void;
  }
  export class Modal {
    constructor(app: App);
    contentEl: HTMLElement;
    open(): void;
    close(): void;
    onOpen(): void;
    onClose(): void;
  }
  export class Notice {
    constructor(message: string, timeout?: number);
  }
  export interface TextComponent {
    setPlaceholder(v: string): TextComponent;
    inputEl: HTMLInputElement;
    setValue(v: string): TextComponent;
    onChange(cb: (v: string) => void): TextComponent;
  }
  export interface ButtonComponent {
    setButtonText(v: string): ButtonComponent;
    setCta(): ButtonComponent;
    onClick(cb: () => void): ButtonComponent;
  }
  export interface ToggleComponent {
    setValue(v: boolean): ToggleComponent;
    onChange(cb: (v: boolean) => void): ToggleComponent;
  }
  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    setHeading(): this;
    addText(cb: (text: TextComponent) => void): this;
    addButton(cb: (button: ButtonComponent) => void): this;
    addToggle(cb: (toggle: ToggleComponent) => void): this;
  }
}
