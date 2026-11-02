import realMoment from 'moment';

export const moment = realMoment;
export function setClock(value: string): void { realMoment.now = () => new Date(value).getTime(); }
export function normalizePath(path: string): string { return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, ''); }

type Listener = (...args: unknown[]) => void;
class Events {
  listeners = new Map<string, Listener[]>();
  on(event: string, callback: Listener): { event: string; callback: Listener } {
    this.listeners.set(event, [...this.listeners.get(event) ?? [], callback]);
    return { event, callback };
  }
  emit(event: string, ...args: unknown[]): void { for (const callback of this.listeners.get(event) ?? []) callback(...args); }
}

export class TFile {
  basename: string;
  name: string;
  extension: string;
  constructor(public path: string) {
    this.name = path.split('/').at(-1)!;
    this.extension = this.name.split('.').at(-1)!;
    this.basename = this.name.replace(/\.[^.]+$/, '');
  }
}
export class TFolder { constructor(public path: string) {} }

export class FileSystemAdapter {
  configuration = new Map<string, string>();
  async read(path: string): Promise<string> {
    const value = this.configuration.get(path);
    if (value === undefined) throw new Error('ENOENT');
    return value;
  }
  getBasePath(): string { return '/mock-vault'; }
}

export class MockVault extends Events {
  adapter = new FileSystemAdapter();
  configDir = '.obsidian';
  files = new Map<string, TFile | TFolder>();
  content = new Map<string, string>();
  writes: Array<{ path: string; text: string }> = [];
  createdFolders: string[] = [];
  beforeProcess?: () => void | Promise<void>;
  beforeRead?: (file: TFile) => void | Promise<void>;
  seed(path: string, text: string): TFile {
    const file = new TFile(path); this.files.set(path, file); this.content.set(path, text); return file;
  }
  getAbstractFileByPath(path: string): TFile | TFolder | null { return this.files.get(path) ?? null; }
  getMarkdownFiles(): TFile[] { return [...this.files.values()].filter((f): f is TFile => f instanceof TFile && f.extension === 'md'); }
  async read(file: TFile): Promise<string> { await this.beforeRead?.(file); return this.content.get(file.path)!; }
  async process(file: TFile, mutate: (source: string) => string): Promise<string> {
    await this.beforeProcess?.();
    const text = mutate(this.content.get(file.path)!);
    this.content.set(file.path, text); this.writes.push({ path: file.path, text }); this.emit('modify', file); return text;
  }
  async create(path: string, text: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error('already exists');
    const file = this.seed(path, text); this.writes.push({ path, text }); this.emit('create', file); return file;
  }
  async createFolder(path: string): Promise<void> { this.files.set(path, new TFolder(path)); this.createdFolders.push(path); }
  externalWrite(path: string, text: string): void { this.content.set(path, text); this.emit('modify', this.files.get(path)); }
}

interface Position { line: number; ch: number }
interface Change { from: Position; to: Position; text: string }
export class MockEditor {
  transactions: Change[][] = [];
  constructor(public value: string, private changed: () => void = () => {}) {}
  getValue(): string { return this.value; }
  offsetToPos(offset: number): Position {
    const prefix = this.value.slice(0, offset).split('\n');
    return { line: prefix.length - 1, ch: prefix.at(-1)!.length };
  }
  posToOffset(pos: Position): number {
    const lines = this.value.split('\n'); return lines.slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.ch;
  }
  transaction(transaction: { changes: Change[] }): void {
    const changes = transaction.changes.map(change => ({ ...change, start: this.posToOffset(change.from), end: this.posToOffset(change.to) }));
    this.transactions.push(transaction.changes);
    for (const change of changes.sort((a, b) => b.start - a.start)) this.value = this.value.slice(0, change.start) + change.text + this.value.slice(change.end);
    this.changed();
  }
}

export class MarkdownView {
  constructor(public file: TFile, public editor: MockEditor, private mode = 'source') {}
  getMode(): string { return this.mode; }
}
export class MockWorkspace extends Events {
  views: MarkdownView[] = [];
  opened: string[] = [];
  getLeavesOfType(): Array<{ view: MarkdownView }> { return this.views.map(view => ({ view })); }
  onLayoutReady(callback: () => void): void { callback(); }
  getLeaf(): { openFile(file: TFile): Promise<void> } { return { openFile: async file => { this.opened.push(file.path); } }; }
  edit(file: TFile, value: string): MockEditor {
    const editor = new MockEditor(value, () => this.emit('editor-change'));
    this.views.push(new MarkdownView(file, editor)); return editor;
  }
}

export interface MockApp { vault: MockVault; workspace: MockWorkspace; setting: { open(): void; openTabById(id: string): void } }
export function makeApp(): MockApp { return { vault: new MockVault(), workspace: new MockWorkspace(), setting: { open() {}, openTabById() {} } }; }

export class Plugin {
  data: Record<string, unknown> = { autoLaunch: false };
  commands: unknown[] = [];
  eventRefs: unknown[] = [];
  intervals: unknown[] = [];
  constructor(public app: MockApp, public manifest: { id: string; dir?: string }) {}
  async loadData(): Promise<Record<string, unknown>> { return this.data; }
  async saveData(data: Record<string, unknown>): Promise<void> { this.data = data; }
  addSettingTab(): void {}
  addRibbonIcon(): void {}
  addCommand(command: unknown): void { this.commands.push(command); }
  registerEvent(event: unknown): void { this.eventRefs.push(event); }
  registerInterval(interval: unknown): void { this.intervals.push(interval); }
}
export class PluginSettingTab { containerEl = {}; constructor(public app: MockApp, public plugin: Plugin) {} }
export class Setting {}
export class Notice { static messages: string[] = []; constructor(message: string) { Notice.messages.push(message); } }
