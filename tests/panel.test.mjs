import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../native/panel.html', import.meta.url), 'utf8');
const TODAY = 'Journal/2026-11-02.md';
function task(id, text, status = 'todo', parentId = null, uiKey = id) {
  return { id, uiKey, text, status, parentId, depth: parentId ? 1 : 0 };
}
function panel(t) {
  const messages = [], runtimeErrors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => {
    // jsdom does not implement every WebKit CSS feature. Script failures matter.
    if (error.type === 'unhandled-exception' || error.type === 'unhandled exception') runtimeErrors.push(error);
  });
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/panel.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(window) {
      window.webkit = { messageHandlers: { todoglass: { postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); } } } };
      window.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  const { window } = dom;
  const document = window.document;
  t.after(() => { window.close(); assert.deepEqual(runtimeErrors, [], 'the panel must not throw during interaction'); });
  assert.ok(window.TodoGlass, 'the real panel script initializes');
  return {
    window, document, messages,
    receive(tasks, extra = {}) {
      window.TodoGlass.receive({ date: '2026-11-02', path: TODAY, exists: true, connected: true, tasks, preferences: { opacity: 0.12, theme: 'light' }, ...extra });
    },
    actions() { return messages.filter(message => message.type === 'action'); },
    async result(message, result = { ok: true }) { window.TodoGlass.result({ requestId: message.requestId, ...result }); await tick(); },
  };
}
function row(p, id) { return p.document.querySelector(`[data-task-id="${id}"]`); }
function rowIds(p) { return [...p.document.querySelectorAll('[data-task-id]')].map(element => element.dataset.taskId); }
function button(element, label) {
  const found = element.querySelector(`button[aria-label="${label}"]`);
  assert.ok(found, `a visible action is available: ${label}`);
  return found;
}
function childInput(p) {
  const input = p.document.querySelector('textarea[aria-label="新增子任务内容"]');
  assert.ok(input, 'a child draft has an accessible inline input');
  return input;
}
function type(p, input, text) { input.value = text; input.dispatchEvent(new p.window.Event('input', { bubbles: true })); }
function assertVisible(p, element) {
  assert.ok(element);
  for (let node = element; node; node = node.parentElement) {
    const style = p.window.getComputedStyle(node);
    assert.notEqual(style.display, 'none');
    assert.notEqual(style.visibility, 'hidden');
    assert.ok(style.opacity === '' || Number(style.opacity) > 0, 'the action is visible without hovering');
    assert.equal(node.hidden, false);
  }
}

test('receiving interleaved statuses displays active tasks first and ended tasks visibly at the bottom without writing', t => {
  const p = panel(t);
  const tasks = Object.freeze([
    task('done-first', '已完成甲', 'done'), task('parent', '进行中的父任务'),
    task('cancelled', '已取消甲', 'cancelled'), task('child', '待办子任务', 'todo', 'parent'),
    task('done-last', '已完成乙', 'done'), task('active-last', '另一件待办', 'doing'),
  ].map(Object.freeze));
  p.receive(tasks);
  assert.deepEqual(rowIds(p), ['parent', 'child', 'active-last', 'done-first', 'cancelled', 'done-last']);
  for (const id of ['done-first', 'cancelled', 'done-last']) assertVisible(p, row(p, id));
  assert.equal(p.document.querySelector('button[aria-label="展开已结束任务"]'), null);
  assert.equal(p.document.querySelector('button[aria-label="折叠已结束任务"]'), null);
  assert.deepEqual(tasks.map(item => item.id), ['done-first', 'parent', 'cancelled', 'child', 'done-last', 'active-last'], 'presentation does not reorder the source array');
  assert.deepEqual(p.actions(), [], 'receiving/rendering tasks is read-only');
});

test('completing a task sends only a status update and moves its refreshed row below active tasks', async t => {
  const p = panel(t);
  const original = [task('old-done', '既有完成', 'done'), task('finish', '马上完成'), task('remain', '仍需处理')];
  p.receive(original);
  button(row(p, 'finish'), '完成此任务').click();
  assert.equal(p.actions().length, 1);
  const message = p.actions()[0];
  assert.deepEqual(message.action, { type: 'update', taskId: 'finish', path: TODAY, status: 'done' });
  const refreshed = [task('done-r2', '既有完成', 'done', null, 'old-done'), task('finish-r2', '马上完成', 'done', null, 'finish'), task('remain-r2', '仍需处理', 'todo', null, 'remain')];
  p.receive(refreshed);
  await p.result(message);
  assert.deepEqual(rowIds(p), ['remain-r2', 'done-r2', 'finish-r2']);
  assert.deepEqual(refreshed.map(item => item.id), ['done-r2', 'finish-r2', 'remain-r2']);
  assert.equal(p.actions().length, 1, 'presentation order never becomes a reorder request');
});

test('each row offers a persistent child action that opens next to its parent and submits the correct target', async t => {
  const p = panel(t);
  p.receive([task('parent', '父任务'), task('existing', '已有子任务', 'todo', 'parent'), task('next-root', '下一件事'), task('done', '完成项', 'done')]);
  for (const id of ['parent', 'existing', 'next-root', 'done']) assertVisible(p, button(row(p, id), '添加子任务'));
  button(row(p, 'parent'), '添加子任务').click();
  const input = childInput(p);
  assert.equal(p.document.activeElement, input);
  const parentRow = row(p, 'parent'), existingRow = row(p, 'existing');
  const inlineDraft = parentRow.nextElementSibling;
  assert.ok(inlineDraft?.contains(input), 'the draft appears immediately after its parent, ahead of existing children');
  assert.ok(input.compareDocumentPosition(existingRow) & p.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(p.document.getElementById('composer').contains(input), false, 'the row action does not use the bottom composer');
  type(p, input, '新增 [[项目]] 子任务');
  button(inlineDraft, '添加待办').click();
  assert.equal(p.actions().length, 1);
  const message = p.actions()[0];
  assert.deepEqual(message.action, { type: 'add', text: '新增 [[项目]] 子任务', path: TODAY, parentId: 'parent' });
  await p.result(message);
  assert.equal(p.document.querySelector('textarea[aria-label="新增子任务内容"]'), null);
});

test('live state updates preserve the exact child draft node, typed text, focus, selection and original date target', async t => {
  const p = panel(t);
  p.receive([task('parent-v1', '稳定父任务', 'todo', null, 'stable-parent'), task('other-v1', '其他任务')]);
  button(row(p, 'parent-v1'), '添加子任务').click();
  const input = childInput(p);
  type(p, input, '保留正在输入的子任务草稿');
  input.focus(); input.setSelectionRange(2, 7, 'backward');
  p.receive([task('parent-v2', '稳定父任务', 'todo', null, 'stable-parent'), task('other-v2', '其他任务已变化', 'doing')]);
  assert.equal(childInput(p), input, 'a refresh must not replace the focused textarea');
  assert.equal(input.value, '保留正在输入的子任务草稿');
  assert.equal(p.document.activeElement, input);
  assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 7); assert.equal(input.selectionDirection, 'backward');
  p.receive([task('tomorrow', '新一天的任务')], { date: '2026-11-03', path: 'Journal/2026-11-03.md' });
  assert.equal(childInput(p), input);
  assert.equal(input.value, '保留正在输入的子任务草稿');
  const inlineDraft = input.closest('.inline-composer') ?? input.parentElement;
  button(inlineDraft, '添加待办').click();
  const message = p.actions().at(-1);
  assert.ok(message);
  assert.equal(message.action.type, 'add');
  assert.equal(message.action.path, TODAY, 'an old draft must never silently target tomorrow');
  assert.equal(message.action.parentId, 'parent-v1', 'the original snapshot remains the conflict-checked target');
  await p.result(message, { ok: false, error: '日记日期或路径已变化。请刷新后重试。' });
  assert.equal(childInput(p), input);
  assert.equal(input.value, '保留正在输入的子任务草稿');
  assert.equal(input.disabled, false);
  assert.match(p.document.getElementById('toast').textContent, /日期|路径/);
});

test('adding under a folded parent opens that branch, and cancelling the draft never writes', t => {
  const p = panel(t);
  p.receive([task('parent', '父任务'), task('child', '原有子任务', 'todo', 'parent'), task('root', '其他任务')]);
  button(row(p, 'parent'), '折叠子任务').click();
  assert.equal(row(p, 'child'), null);
  button(row(p, 'parent'), '添加子任务').click();
  assertVisible(p, row(p, 'child'));
  const input = childInput(p);
  type(p, input, '这条草稿将取消');
  const inlineDraft = input.closest('.inline-composer') ?? input.parentElement;
  button(inlineDraft, '取消新增').click();
  assert.equal(p.document.querySelector('textarea[aria-label="新增子任务内容"]'), null);
  assertVisible(p, row(p, 'child'));
  assert.deepEqual(p.actions(), []);
});
