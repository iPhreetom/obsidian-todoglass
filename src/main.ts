import { Plugin, PluginSettingTab, Setting, Notice, TFile, FileSystemAdapter, MarkdownView, moment as obsidianMoment, normalizePath, type App, type Editor } from 'obsidian';
import type momentFactory from 'moment';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LocalBridge } from './bridge';
import { parseTodoDocument, applyTodoAction, type TodoTask, type TaskStatus } from './markdown';

interface Preferences { opacity: number; alwaysOnTop: boolean; theme: 'system' | 'light' | 'dark' }
interface Settings extends Preferences { autoLaunch: boolean; folder: string; dateFormat: string; sectionTitle: string; appearanceVersion: number }
const moment = obsidianMoment as unknown as typeof momentFactory;
const DEFAULTS: Settings = { autoLaunch: true, folder: '', dateFormat: '', sectionTitle: '', opacity: 0.12, alwaysOnTop: true, theme: 'system', appearanceVersion: 2 };
interface DailyOptions { folder?: string; format?: string; template?: string }
interface Snapshot { path: string; sectionTitle: string; task: TodoTask }
type NativeAction = { type: string; taskId?: string; parentId?: string; text?: string; status?: TaskStatus; path?: string; preferences?: Partial<Preferences> };

export default class TodoGlassPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private bridge?: LocalBridge;
  private helper?: ChildProcess;
  private starting?: Promise<void>;
  private disposed = false;
  private snapshots = new Map<string, Snapshot>();
  private cachedState: Record<string, unknown> = {};
  private dirty = true;
  private refreshPromise?: Promise<void>;
  private date = '';
  private command = { seq: 0, type: 'show' };
  private queue: Promise<unknown> = Promise.resolve();
  private dailyOptions: DailyOptions = {};
  private optionsReadAt = 0;

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS, ...saved };
    // The first release did not offer a fully transparent background. Start its
    // upgraded appearance with a light tint; later user adjustments, including 0,
    // remain unchanged across reloads.
    if (saved?.appearanceVersion !== DEFAULTS.appearanceVersion) {
      this.settings.opacity = DEFAULTS.opacity;
      this.settings.appearanceVersion = DEFAULTS.appearanceVersion;
      await this.saveData(this.settings);
    }
    this.addSettingTab(new TodoGlassSettingTab(this.app, this));
    this.addRibbonIcon('list-todo', 'TodoGlass：显示今日待办浮窗', () => { void this.show().catch(e => this.report(e)); });
    this.addCommand({ id: 'show', name: '显示今日待办浮窗', callback: () => { void this.show().catch(e => this.report(e)); } });
    this.addCommand({ id: 'toggle', name: '显示 / 隐藏今日待办浮窗', callback: () => { void this.show('toggle').catch(e => this.report(e)); } });
    this.addCommand({ id: 'open-daily', name: '打开今日日记', callback: () => { void this.openNote().catch(e => this.report(e)); } });
    const changed = () => { this.dirty = true; };
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', changed));
    this.registerEvent(this.app.workspace.on('editor-change', changed));
    this.registerEvent(this.app.workspace.on('active-leaf-change', changed));
    this.registerInterval(window.setInterval(() => {
      if (this.date !== moment().format('YYYY-MM-DD')) this.dirty = true;
    }, 1000));
    if (process.platform !== 'darwin') { new Notice('TodoGlass 的全局浮窗需要 macOS 13 或更新版本。'); return; }
    this.app.workspace.onLayoutReady(() => {
      if (!this.disposed && this.settings.autoLaunch) void this.show().catch(e => this.report(e));
    });
  }

  onunload(): void {
    this.disposed = true;
    this.helper?.stdin?.end();
    this.helper?.kill('SIGTERM');
    this.helper = undefined;
    this.bridge?.close();
    this.snapshots.clear();
  }

  private report(error: unknown): void {
    new Notice(`TodoGlass：${error instanceof Error ? error.message : String(error)}`, 8000);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.dirty = true;
    this.optionsReadAt = 0;
  }

  async show(type = 'show'): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('全局浮窗仅支持 macOS。');
    this.command = { seq: this.command.seq + 1, type };
    if (this.helper && !this.helper.killed && this.helper.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = this.startHelper();
    try { await this.starting; } finally { this.starting = undefined; }
  }

  private async startHelper(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error('需要本地文件系统仓库。');
    const pluginDir = join(adapter.getBasePath(), this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    const bundle = join(pluginDir, 'macos', 'TodoGlass.app', 'Contents');
    const binary = join(bundle, 'MacOS', 'TodoGlass');
    if (!existsSync(binary)) throw new Error('缺少 macOS 浮窗程序。请安装包含 macos 文件夹的完整 TodoGlass 安装包。');
    if (!this.bridge) {
      this.bridge = new LocalBridge(() => this.state(), action => {
        const next = this.queue.then(() => this.handleAction(action));
        this.queue = next.catch(() => {});
        return next;
      });
    }
    if (!this.bridge.port) await this.bridge.start();
    await this.refresh();
    if (this.disposed) return;
    const child = spawn(binary, [], {
      env: { ...process.env, TODOGLASS_PORT: String(this.bridge.port), TODOGLASS_TOKEN: this.bridge.token,
        TODOGLASS_UI_PATH: join(bundle, 'Resources', 'panel.html'),
        TODOGLASS_INSTANCE: createHash('sha256').update(adapter.getBasePath()).digest('hex').slice(0, 16) },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    this.helper = child;
    // Keep stdin open as the ownership lease; the helper exits when Obsidian closes it.
    child.stdin?.on('error', () => {});
    let diagnostic = '';
    child.stderr?.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-1200); });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.once('exit', (code, signal) => {
      if (this.helper === child) this.helper = undefined;
      if (!this.disposed && code && signal !== 'SIGTERM') this.report(new Error(`浮窗程序退出（${code}）。${diagnostic.trim().slice(-300)}`));
    });
  }

  private async getDailyOptions(): Promise<DailyOptions> {
    if (Date.now() - this.optionsReadAt < 10_000) return this.dailyOptions;
    this.optionsReadAt = Date.now();
    // Core-plugin settings are read from the vault, without relying on private runtime APIs.
    try { this.dailyOptions = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/daily-notes.json`)); }
    catch { this.dailyOptions = {}; }
    return this.dailyOptions;
  }

  private async todayPath(): Promise<string> {
    const daily = await this.getDailyOptions();
    const format = this.settings.dateFormat.trim() || daily.format || 'YYYY-MM-DD';
    const folder = this.settings.folder.trim() || daily.folder || '';
    const filename = moment().format(format);
    const path = normalizePath([folder, `${filename}.md`].filter(Boolean).join('/'));
    if (path.startsWith('/') || path.split('/').some(p => p === '..') || !path.endsWith('.md')) throw new Error('日记路径必须位于当前仓库内。');
    // Existing journals may use a weekday locale different from the app's current locale.
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return path;
    const matches: string[] = [];
    if (format.includes('ddd')) {
      for (const locale of moment.locales()) {
        const candidate = normalizePath([folder, `${moment().locale(locale).format(format)}.md`].filter(Boolean).join('/'));
        if (!matches.includes(candidate) && this.app.vault.getAbstractFileByPath(candidate) instanceof TFile) matches.push(candidate);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('找到多篇今日日记，请在设置中填写准确的日记目录和日期格式。');
    return path;
  }

  private editorFor(file: TFile): Editor | undefined {
    const views = this.app.workspace.getLeavesOfType('markdown').map(l => l.view).filter((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path && v.getMode() === 'source');
    const values = new Set(views.map(v => v.editor.getValue()));
    if (values.size > 1) throw new Error('同一日记的多个编辑窗口尚未同步，请先完成编辑后重试。');
    return views[0]?.editor;
  }

  private async state(): Promise<unknown> {
    if (this.date !== moment().format('YYYY-MM-DD')) this.dirty = true;
    // A cheap settings refresh also catches changes made to the Daily notes core plugin.
    if (Date.now() - this.optionsReadAt > 10_000) this.dirty = true;
    if (this.dirty) await this.refresh();
    return { ...this.cachedState, connected: true, command: this.command, preferences: this.preferences() };
  }

  private preferences(): Preferences {
    return { opacity: this.settings.opacity, theme: this.settings.theme, alwaysOnTop: this.settings.alwaysOnTop };
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) { await this.refreshPromise; if (this.dirty) await this.refresh(); return; }
    this.dirty = false;
    this.refreshPromise = (async () => {
      this.date = moment().format('YYYY-MM-DD');
      try {
        const path = await this.todayPath();
        const file = this.app.vault.getAbstractFileByPath(path);
        const markdown = file instanceof TFile ? this.editorFor(file)?.getValue() ?? await this.app.vault.read(file) : '';
        const parsed = parseTodoDocument(markdown, { sectionTitle: this.settings.sectionTitle });
        const ids = new Map(parsed.tasks.map(task => [task.id, createHash('sha256').update(path + '\0' + task.documentHash + '\0' + task.id).digest('hex').slice(0, 24)]));
        const occurrences = new Map<string, number>();
        const tasks = parsed.tasks.map(task => {
          const id = ids.get(task.id)!;
          this.snapshots.set(id, { path, sectionTitle: this.settings.sectionTitle, task });
          const uiBase = task.raw.replace(/\[[^\]]\]/, '[ ]');
          const occurrence = occurrences.get(uiBase) ?? 0;
          occurrences.set(uiBase, occurrence + 1);
          const uiKey = createHash('sha256').update(path + '\0' + uiBase + '\0' + occurrence).digest('hex').slice(0, 24);
          return { id, uiKey, text: task.text, status: task.status, depth: task.depth, parentId: task.parentId ? ids.get(task.parentId) : null };
        });
        // Keep a bounded history so an in-flight edit can safely locate its original line.
        while (this.snapshots.size > 4000) this.snapshots.delete(this.snapshots.keys().next().value!);
        this.cachedState = { date: this.date, label: moment().format('M月D日 dddd'), path, exists: file instanceof TFile, tasks, sectionFound: !!parsed.section };
      } catch (error) {
        this.cachedState = { date: this.date, label: moment().format('M月D日'), tasks: [], error: error instanceof Error ? error.message : String(error) };
      }
    })();
    try { await this.refreshPromise; } finally { this.refreshPromise = undefined; }
  }

  private async handleAction(input: unknown): Promise<void> {
    if (!input || typeof input !== 'object') throw new Error('无效操作。');
    const action = input as NativeAction;
    if (action.type === 'openNote') { await this.openNote(); return; }
    if (action.type === 'settings') {
      const appWithSettings = this.app as App & { setting: { open(): void; openTabById(id: string): void } };
      appWithSettings.setting.open(); appWithSettings.setting.openTabById(this.manifest.id); return;
    }
    if (action.type === 'preferences') {
      const p = action.preferences;
      if (!p || typeof p !== 'object') throw new Error('无效设置。');
      if (typeof p.opacity === 'number' && Number.isFinite(p.opacity)) this.settings.opacity = Math.min(1, Math.max(0, p.opacity));
      if (typeof p.alwaysOnTop === 'boolean') this.settings.alwaysOnTop = p.alwaysOnTop;
      if (p.theme && ['system', 'light', 'dark'].includes(p.theme)) this.settings.theme = p.theme;
      await this.saveSettings(); return;
    }
    if (!['update', 'add'].includes(action.type)) throw new Error('不支持的操作。');
    const capturedDate = moment().format('YYYY-MM-DD');
    const capturedSection = this.settings.sectionTitle;
    const path = await this.todayPath();
    if (typeof action.path !== 'string' || action.path !== path) throw new Error('日记日期或路径已变化。请刷新后重试。');
    if (action.text !== undefined && (typeof action.text !== 'string' || !action.text.trim() || /[\r\n\u0000]/.test(action.text) || action.text.length > 8000)) throw new Error('任务内容须为 1–8000 个字符的单行文本。');
    if (action.status !== undefined && !['todo', 'doing', 'done', 'cancelled', 'deferred'].includes(action.status)) throw new Error('不支持的任务状态。');
    const refId = action.type === 'update' ? action.taskId : action.parentId;
    const snapshot = refId ? this.snapshots.get(refId) : undefined;
    if (refId && (!snapshot || snapshot.path !== path || snapshot.sectionTitle !== capturedSection)) throw new Error('任务或 TODO 区域已变化，请刷新后重试。');
    if (action.type === 'update' && (!snapshot || action.text === undefined && action.status === undefined)) throw new Error('缺少要修改的任务或内容。');
    if (action.type === 'add' && !action.text) throw new Error('请输入新任务内容。');
    const coreAction = action.type === 'update'
      ? { type: 'update' as const, task: snapshot!.task, text: action.text, status: action.status }
      : { type: 'add' as const, text: action.text!, parent: snapshot?.task };
    const assertCurrent = () => {
      if (capturedDate !== moment().format('YYYY-MM-DD') || capturedSection !== this.settings.sectionTitle || this.disposed) throw new Error('日期或 TODO 设置已变化，请刷新后重试。');
    };
    const mutate = (text: string) => { assertCurrent(); return applyTodoAction(text, coreAction, { sectionTitle: capturedSection }); };
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      if (action.type !== 'add') throw new Error('日记已被删除，请刷新后重试。');
      const parts = path.split('/'); parts.pop();
      let folder = '';
      for (const part of parts) { folder = folder ? `${folder}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder); }
      let template = '';
      const templatePath = (await this.getDailyOptions()).template;
      if (templatePath) {
        const t = this.app.vault.getAbstractFileByPath(templatePath.endsWith('.md') ? templatePath : `${templatePath}.md`);
        if (t instanceof TFile) template = (await this.app.vault.read(t)).replace(/\{\{date(?::([^}]+))?\}\}/g, (_, fmt: string) => moment().format(fmt || 'YYYY-MM-DD')).replace(/\{\{time(?::([^}]+))?\}\}/g, (_, fmt: string) => moment().format(fmt || 'HH:mm'));
      }
      assertCurrent();
      await this.app.vault.create(path, mutate(template));
    } else if (file instanceof TFile) {
      const editor = this.editorFor(file);
      if (editor) {
        const before = editor.getValue();
        const after = mutate(before);
        if (before !== after) {
          let from = 0;
          while (from < before.length && from < after.length && before[from] === after[from]) from++;
          let endBefore = before.length, endAfter = after.length;
          while (endBefore > from && endAfter > from && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
          editor.transaction({ changes: [{ from: editor.offsetToPos(from), to: editor.offsetToPos(endBefore), text: after.slice(from, endAfter) }] });
        }
      } else await this.app.vault.process(file, mutate);
    } else throw new Error('日记路径对应的是文件夹。');
    this.dirty = true;
    await this.refresh();
  }

  private async openNote(): Promise<void> {
    const path = await this.todayPath();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice('今日日记尚不存在。新增第一条待办时会创建日记。'); return; }
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}

class TodoGlassSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TodoGlassPlugin) { super(app, plugin); }
  display(): void {
    const el = this.containerEl; el.empty();
    el.createEl('h2', { text: 'TodoGlass · 今日待办浮窗' });
    el.createEl('p', { text: '自动使用核心插件「日记」的目录、日期格式和模板。macOS 浮窗与当天日记双向同步；Obsidian 需保持运行。' });
    new Setting(el).setName('显示浮窗').addButton(b => b.setButtonText('立即显示').setCta().onClick(() => { void this.plugin.show().catch(e => new Notice(String(e))); }));
    new Setting(el).setName('启动时显示').addToggle(t => t.setValue(this.plugin.settings.autoLaunch).onChange(async v => { this.plugin.settings.autoLaunch = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('日记目录（可留空）').setDesc('留空继承核心日记插件的目录。').addText(t => t.setPlaceholder('Time - 日记').setValue(this.plugin.settings.folder).onChange(async v => { this.plugin.settings.folder = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('日期格式（可留空）').setDesc('Moment 格式，例如 YYYY-MM-DD-ddd；留空自动读取。').addText(t => t.setPlaceholder('YYYY-MM-DD-ddd').setValue(this.plugin.settings.dateFormat).onChange(async v => { this.plugin.settings.dateFormat = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('TODO 区域标题').setDesc('留空识别 TODO、【TODO】、待办、待办事项。填写后只识别该标题。').addText(t => t.setPlaceholder('自动识别 TODO').setValue(this.plugin.settings.sectionTitle).onChange(async v => { this.plugin.settings.sectionTitle = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(el).setName('置顶显示').addToggle(t => t.setValue(this.plugin.settings.alwaysOnTop).onChange(async v => { this.plugin.settings.alwaysOnTop = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('背景不透明度').setDesc('0 为完全透明，1 为实色。背后内容保持清晰，文字和层级线不受透明度影响。').addSlider(s => s.setLimits(0, 1, 0.01).setValue(this.plugin.settings.opacity).setDynamicTooltip().onChange(async v => { this.plugin.settings.opacity = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName('外观').addDropdown(d => d.addOptions({ system: '跟随系统', light: '浅色', dark: '深色' }).setValue(this.plugin.settings.theme).onChange(async v => { this.plugin.settings.theme = v as Preferences['theme']; await this.plugin.saveSettings(); }));
    el.createEl('p', { text: '支持 - [ ] 待办、- [/] 进行中、- [x] 完成、- [-] 取消、- [>] 延后。完成父任务只修改该任务；子任务保持各自状态。可在快捷键设置中为 TodoGlass 命令绑定按键（仅 Obsidian 内有效）。' });
  }
}
