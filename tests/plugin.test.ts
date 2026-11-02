import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { App, PluginManifest } from 'obsidian';
import TodoGlassPlugin from '../src/main';
import { LocalBridge } from '../src/bridge';
import { makeApp, setClock, type MockApp, type TFile } from './obsidian-mock';

interface State {
  path: string; date: string; exists: boolean; sectionFound: boolean; error?: string;
  tasks: Array<{ id: string; uiKey: string; text: string; status: string; parentId: string | null; depth: number }>;
  preferences: { opacity: number; theme: string; alwaysOnTop: boolean };
}
interface Access {
  state(): Promise<State>;
  handleAction(action: unknown): Promise<void>;
  snapshots: Map<string, unknown>;
  bridge?: LocalBridge;
}
interface Fixture { app: MockApp; plugin: TodoGlassPlugin; access: Access; path: string }

async function fixture(source?: string, config: Record<string, unknown> = {}, saved?: Record<string, unknown>): Promise<Fixture> {
  setClock('2026-11-02T10:30:00');
  // A fake timer registers the lifecycle without leaving background work behind.
  (globalThis as unknown as { window: unknown }).window = { setInterval: () => 1 };
  const app = makeApp();
  app.vault.adapter.configuration.set('.obsidian/daily-notes.json', JSON.stringify({ folder: 'Journal', format: 'YYYY-MM-DD', ...config }));
  const path = `Journal/2026-11-02.md`;
  if (source !== undefined) app.vault.seed(path, source);
  const plugin = new TodoGlassPlugin(app as unknown as App, { id: 'todoglass', name: 'TodoGlass', version: '1.0.0', minAppVersion: '1.0.0', author: 'test', description: 'test' } as PluginManifest);
  if (saved) (plugin as unknown as { data: Record<string, unknown> }).data = { autoLaunch: false, ...saved };
  await plugin.onload();
  return { app, plugin, access: plugin as unknown as Access, path };
}

test('legacy opaque appearance migrates once to a translucent background while preserving all other settings', async t => {
  const legacy = { opacity: 1, theme: 'dark', alwaysOnTop: false, autoLaunch: false, folder: 'Custom/Daily', dateFormat: 'YYYY.MM.DD', sectionTitle: '行动' };
  const f = await fixture(undefined, {}, legacy); t.after(() => f.plugin.onunload());
  assert.equal(f.plugin.settings.opacity, 0.12);
  const persisted = (f.plugin as unknown as { data: Record<string, unknown> }).data;
  assert.equal(persisted.appearanceVersion, 2);
  assert.equal(persisted.opacity, 0.12);
  for (const [key, value] of Object.entries(legacy)) if (key !== 'opacity') assert.equal(persisted[key], value, key);
});

test('version-two settings preserve a fully transparent background instead of resetting its zero value', async t => {
  const f = await fixture(undefined, {}, { appearanceVersion: 2, opacity: 0, theme: 'light', alwaysOnTop: false });
  t.after(() => f.plugin.onunload());
  assert.equal(f.plugin.settings.opacity, 0);
  assert.equal((await f.access.state()).preferences.opacity, 0);
  const persisted = (f.plugin as unknown as { data: Record<string, unknown> }).data;
  assert.equal(persisted.opacity, 0);
  assert.equal(persisted.theme, 'light');
  assert.equal(persisted.alwaysOnTop, false);
});

test('native preferences accept zero opacity and persist it across a subsequent plugin load', async t => {
  const f = await fixture(); t.after(() => f.plugin.onunload());
  await f.access.handleAction({ type: 'preferences', preferences: { opacity: 0 } });
  assert.equal(f.plugin.settings.opacity, 0);
  const persisted = (f.plugin as unknown as { data: Record<string, unknown> }).data;
  assert.equal(persisted.opacity, 0);
  assert.equal(persisted.appearanceVersion, 2);
  const reopened = await fixture(undefined, {}, { ...persisted }); t.after(() => reopened.plugin.onunload());
  assert.equal(reopened.plugin.settings.opacity, 0);
});

test('plugin lifecycle reads the live unsaved editor and updates it with a minimal transaction', async t => {
  const source = '## TODO\n- [ ] disk\n## Notes\nunchanged\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  const editor = f.app.workspace.edit(f.app.vault.getAbstractFileByPath(f.path) as TFile, source.replace('disk', '未落盘 [[项目]]'));
  const state = await f.access.state();
  assert.deepEqual(state.tasks.map(task => task.text), ['未落盘 [[项目]]']);
  await f.access.handleAction({ type: 'update', path: f.path, taskId: state.tasks[0].id, status: 'done' });
  assert.equal(editor.getValue(), source.replace('disk', '未落盘 [[项目]]').replace('[ ]', '[x]'));
  assert.equal(f.app.vault.content.get(f.path), source, 'Obsidian remains responsible for saving the editor buffer');
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.transactions[0][0].text, 'x');
  assert.equal(f.app.vault.writes.length, 0);
  f.plugin.onunload();
  assert.equal(f.access.snapshots.size, 0);
});

test('closed-note status, text, parent-child add and top-level add stay inside the TODO section', async t => {
  const source = '# 今日\n## 【TODO】\n- [ ] parent\n  - [/] child\n\n## Notes\n- [ ] unrelated\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  let state = await f.access.state();
  await f.access.handleAction({ type: 'update', path: f.path, taskId: state.tasks[0].id, text: '重命名 [[项目]]', status: 'done' });
  state = await f.access.state();
  assert.equal(state.tasks[1].status, 'doing', 'completing a parent does not complete its child');
  await f.access.handleAction({ type: 'add', path: f.path, parentId: state.tasks[0].id, text: 'new child' });
  await f.access.handleAction({ type: 'add', path: f.path, text: 'new root' });
  assert.equal(f.app.vault.content.get(f.path), '# 今日\n## 【TODO】\n- [x] 重命名 [[项目]]\n  - [/] child\n  - [ ] new child\n- [ ] new root\n\n## Notes\n- [ ] unrelated\n');
});

test('the first child created through the plugin uses a real Tab and subsequent siblings retain that level', async t => {
  const f = await fixture('## TODO\n- [ ] parent\n'); t.after(() => f.plugin.onunload());
  let state = await f.access.state();
  await f.access.handleAction({ type: 'add', path: f.path, parentId: state.tasks[0].id, text: 'first child' });
  state = await f.access.state();
  assert.equal(state.tasks[1].parentId, state.tasks[0].id);
  await f.access.handleAction({ type: 'add', path: f.path, parentId: state.tasks[0].id, text: 'second child' });
  assert.equal(f.app.vault.content.get(f.path), '## TODO\n- [ ] parent\n\t- [ ] first child\n\t- [ ] second child\n');
  state = await f.access.state();
  assert.deepEqual(state.tasks.slice(1).map(task => task.parentId), [state.tasks[0].id, state.tasks[0].id]);
});

test('external edits conflict safely and rendered IDs retain distinct snapshot versions', async t => {
  const source = '## TODO\n- [ ] duplicate\n- [ ] duplicate\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  const before = await f.access.state();
  const changed = source + '\nAn unrelated edit\n';
  f.app.vault.externalWrite(f.path, changed);
  const after = await f.access.state();
  assert.notEqual(after.tasks[0].id, before.tasks[0].id, 'identity includes document revision');
  assert.equal(after.tasks[0].uiKey, before.tasks[0].uiKey, 'fold state can retain its stable UI key');
  await assert.rejects(f.access.handleAction({ type: 'update', path: f.path, taskId: before.tasks[0].id, status: 'done' }), /相同任务|变化|改变/);
  assert.equal(f.app.vault.content.get(f.path), changed);
  assert.equal(f.app.vault.writes.length, 0);
  await f.access.handleAction({ type: 'update', path: f.path, taskId: after.tasks[1].id, status: 'done' });
  assert.equal(f.app.vault.content.get(f.path), changed.replace('- [ ] duplicate\n\n', '- [x] duplicate\n\n'));
});

test('a unique task changed externally is never overwritten by an old floating-window action', async t => {
  const f = await fixture('## TODO\n- [ ] A\n'); t.after(() => f.plugin.onunload());
  const state = await f.access.state();
  f.app.vault.externalWrite(f.path, '## TODO\n- [x] A\n');
  await assert.rejects(f.access.handleAction({ type: 'update', path: f.path, taskId: state.tasks[0].id, text: 'stale edit' }), /改变|变化/);
  assert.equal(f.app.vault.content.get(f.path), '## TODO\n- [x] A\n');
});

test('the first task creates today from the core daily-note template and creates its folders', async t => {
  const f = await fixture(undefined, { folder: 'Journal/Nested', template: 'Templates/daily' }); t.after(() => f.plugin.onunload());
  f.app.vault.seed('Templates/daily.md', '# {{date:YYYY-MM-DD}}\n时间 {{time:HH:mm}}\n\n## 【TODO】\n\n## Notes\n保留\n');
  const state = await f.access.state();
  assert.equal(state.path, 'Journal/Nested/2026-11-02.md');
  assert.equal(state.exists, false);
  await f.access.handleAction({ type: 'add', path: state.path, text: '第一条任务' });
  assert.equal(f.app.vault.content.get(state.path), '# 2026-11-02\n时间 10:30\n\n## 【TODO】\n- [ ] 第一条任务\n\n## Notes\n保留\n');
  assert.deepEqual(f.app.vault.createdFolders, ['Journal', 'Journal/Nested']);
});

test('different buffers for the same note are detected before any mutation', async t => {
  const source = '## TODO\n- [ ] A\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  const initial = await f.access.state();
  const file = f.app.vault.getAbstractFileByPath(f.path) as TFile;
  const first = f.app.workspace.edit(file, source + 'first');
  const second = f.app.workspace.edit(file, source + 'second');
  f.app.workspace.emit('editor-change');
  assert.match((await f.access.state()).error ?? '', /多个编辑窗口/);
  await assert.rejects(f.access.handleAction({ type: 'update', path: f.path, taskId: initial.tasks[0].id, status: 'done' }), /多个编辑窗口/);
  assert.equal(first.transactions.length + second.transactions.length + f.app.vault.writes.length, 0);
});

test('invalid actions cannot alter text, an unrelated path, or unsupported status', async t => {
  const source = '## TODO\n- [ ] A\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  const state = await f.access.state();
  for (const action of [
    { type: 'add', path: '../outside.md', text: 'B' },
    { type: 'add', path: f.path, text: 'B\n## Notes' },
    { type: 'update', path: f.path, taskId: state.tasks[0].id, status: 'unrecognized' },
    { type: 'update', path: f.path, taskId: 'not-rendered', status: 'done' },
    { type: 'add', path: f.path, text: 'x'.repeat(8001) },
  ]) await assert.rejects(f.access.handleAction(action));
  assert.equal(f.app.vault.content.get(f.path), source);
  assert.equal(f.app.vault.writes.length, 0);
});

test('date rollover rejects stale paths and a rollover while waiting for Vault.process', async t => {
  const source = '## TODO\n- [ ] A\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  const state = await f.access.state();
  setClock('2026-11-03T00:00:01');
  await assert.rejects(f.access.handleAction({ type: 'update', path: f.path, taskId: state.tasks[0].id, status: 'done' }), /日期|变化|跨/);
  setClock('2026-11-02T23:59:59');
  f.app.vault.beforeProcess = () => setClock('2026-11-03T00:00:00');
  await assert.rejects(f.access.handleAction({ type: 'update', path: f.path, taskId: state.tasks[0].id, status: 'done' }), /日期|变化|跨/);
  assert.equal(f.app.vault.content.get(f.path), source);
});

test('date rollover during template loading cannot create yesterday with a new task', async t => {
  const f = await fixture(undefined, { template: 'Templates/daily' }); t.after(() => f.plugin.onunload());
  f.app.vault.seed('Templates/daily.md', '# {{date}}\n## TODO\n');
  const state = await f.access.state();
  setClock('2026-11-02T23:59:59');
  f.app.vault.beforeRead = file => { if (file.path === 'Templates/daily.md') setClock('2026-11-03T00:00:00'); };
  await assert.rejects(f.access.handleAction({ type: 'add', path: state.path, text: 'stale day' }), /日期|变化|跨/);
  assert.equal(f.app.vault.getAbstractFileByPath(state.path), null);
  assert.equal(f.app.vault.writes.length, 0);
});

test('a changed TODO section setting rejects actions from the old section snapshot', async t => {
  const source = '## TODO\n- [ ] A\n## Work\n- [ ] A\n';
  const f = await fixture(source); t.after(() => f.plugin.onunload());
  const state = await f.access.state();
  f.plugin.settings.sectionTitle = 'Work';
  await f.plugin.saveSettings();
  await assert.rejects(f.access.handleAction({ type: 'update', path: f.path, taskId: state.tasks[0].id, status: 'done' }), /区域|设置|变化/);
  assert.equal(f.app.vault.content.get(f.path), source);
});

test('a dated meeting note does not become the journal when today is missing', async t => {
  const f = await fixture(); t.after(() => f.plugin.onunload());
  f.app.vault.seed('Journal/2026-11-02-meeting.md', '## TODO\n- [ ] meeting\n');
  const state = await f.access.state();
  assert.equal(state.path, f.path);
  assert.equal(state.exists, false);
  assert.deepEqual(state.tasks, []);
});

test('HTTP bridge to the real plugin state/action round-trips a Chinese TODO', async t => {
  const f = await fixture('## TODO\n- [ ] 第一条\n'); t.after(() => f.plugin.onunload());
  const bridge = new LocalBridge(() => f.access.state(), action => f.access.handleAction(action));
  f.access.bridge = bridge;
  await bridge.start();
  async function http(method: string, path: string, action?: unknown): Promise<{ code: number; body: State }> {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: bridge.port, method, path, headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ code: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on('error', reject); req.end(action ? JSON.stringify(action) : undefined);
    });
  }
  const initial = await http('GET', '/state');
  assert.equal(initial.code, 200);
  assert.equal(initial.body.tasks[0].text, '第一条');
  const updated = await http('POST', '/action', { type: 'add', path: initial.body.path, text: '新增中文待办' });
  assert.equal(updated.code, 200);
  assert.deepEqual((await http('GET', '/state')).body.tasks.map(task => task.text), ['第一条', '新增中文待办']);
});
