import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const docs = new URL('../docs/', import.meta.url);
const REPOSITORY = 'https://github.com/iPhreetom/obsidian-todoglass';
const VERSION = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version;
const DOWNLOAD = `${REPOSITORY}/releases/download/v${VERSION}/TodoGlass-${VERSION}-macOS.zip`;

function site(t) {
  const networkAttempts = [], runtimeErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    if (error.type === 'unhandled-exception' || error.type === 'unhandled exception') runtimeErrors.push(error);
  });
  // No resources loader is enabled: styles, scripts and URLs are never fetched.
  // Evaluate only the committed local entry point and its two local scripts.
  const dom = new JSDOM(readFileSync(new URL('index.html', docs), 'utf8'), {
    url: 'https://todoglass-macos.fytmarryzwl.chatgpt.site/',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const blocked = name => (...args) => {
    networkAttempts.push({ name, args });
    throw new Error(`The introduction demo must not use ${name}`);
  };
  window.fetch = blocked('fetch');
  window.XMLHttpRequest = function () { networkAttempts.push({ name: 'XMLHttpRequest' }); throw new Error('No network in the demo'); };
  window.WebSocket = function () { networkAttempts.push({ name: 'WebSocket' }); throw new Error('No network in the demo'); };
  window.navigator.sendBeacon = blocked('sendBeacon');
  window.matchMedia = () => ({ matches: false });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(readFileSync(new URL('config.js', docs), 'utf8'));
  window.eval(readFileSync(new URL('app.js', docs), 'utf8'));
  t.after(() => {
    window.close();
    assert.deepEqual(runtimeErrors, [], 'the committed site must initialize and respond without runtime errors');
    assert.deepEqual(networkAttempts, [], 'interacting with synthetic demo content stays entirely local');
  });
  return { window, document: window.document };
}
function row(s, id) {
  const found = s.document.querySelector(`[data-task-id="${id}"]`);
  assert.ok(found, `demo task is present: ${id}`);
  return found;
}
function type(s, input, value) {
  input.value = value;
  input.dispatchEvent(new s.window.Event('input', { bubbles: true }));
}
function labelled(element, label) {
  const found = [...element.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label);
  assert.ok(found, `accessible demo action is present: ${label}`);
  return found;
}
function addChild(s, id) {
  const action = row(s, id).querySelector('button[aria-label$="下新增子任务"]');
  assert.ok(action, 'every demo task exposes its own child action');
  action.click();
  const input = s.document.getElementById('demoTaskInput');
  assert.ok(input, 'the child action opens an editable input');
  return input;
}

test('the committed site exposes the actual repository and versioned download and clearly labels the synthetic demo', t => {
  const s = site(t);
  const links = [...s.document.querySelectorAll('a[data-link]')];
  assert.ok(links.some(link => link.dataset.link === 'repo'));
  assert.ok(links.some(link => link.dataset.link === 'download'));
  for (const link of links) {
    assert.equal(link.href, link.dataset.link === 'repo' ? REPOSITORY : DOWNLOAD);
    assert.equal(link.hasAttribute('aria-disabled'), false);
    assert.equal(link.textContent.includes('准备中'), false);
  }
  assert.match(s.document.querySelector('.demo-disclaimer').textContent, /合成示例/);
  assert.match(s.document.querySelector('.demo-disclaimer').textContent, /不连接你的 Obsidian 仓库/);
  for (const script of s.document.querySelectorAll('script[src]')) assert.ok(['config.js', 'app.js'].includes(script.getAttribute('src')), 'only the bundled local scripts are loaded');
});

test('the opacity control reaches a fully transparent background without changing task text', t => {
  const s = site(t), input = s.document.getElementById('demoOpacity');
  const original = row(s, 'idea').textContent;
  input.value = '0'; input.dispatchEvent(new s.window.Event('input', { bubbles: true }));
  assert.equal(s.document.getElementById('opacityValue').textContent, '0%');
  assert.equal(s.document.getElementById('glassWindow').style.getPropertyValue('--panel-opacity'), '0');
  assert.equal(row(s, 'idea').textContent, original, 'background transparency does not remove the task labels');
  input.value = '100'; input.dispatchEvent(new s.window.Event('input', { bubbles: true }));
  assert.equal(s.document.getElementById('opacityValue').textContent, '100%');
  assert.equal(s.document.getElementById('glassWindow').style.getPropertyValue('--panel-opacity'), '1');
});

test('completing a parent places it below active tasks while its children keep their own unfinished states', t => {
  const s = site(t);
  row(s, 'idea').querySelector('[role="checkbox"]').click();
  const rows = [...s.document.querySelectorAll('[data-task-id]')];
  const parent = row(s, 'idea');
  assert.equal(parent.querySelector('[role="checkbox"]').getAttribute('aria-checked'), 'true');
  for (const id of ['write', 'choose', 'walk']) {
    const active = row(s, id);
    assert.equal(active.querySelector('[role="checkbox"]').getAttribute('aria-checked'), 'false');
    assert.ok(rows.indexOf(active) < rows.indexOf(parent), 'active work remains above ended work');
  }
  assert.equal(row(s, 'write').dataset.depth, '0', 'an active child of an ended parent is displayed as a visible group root');
  assert.equal(row(s, 'plant').querySelector('[role="checkbox"]').getAttribute('aria-checked'), 'true');
});

test('the row child action opens directly after its parent before existing children and saves at the correct depth', t => {
  const s = site(t), input = addChild(s, 'idea');
  const inline = row(s, 'idea').nextElementSibling;
  assert.ok(inline.contains(input), 'the input stays beside the parent rather than at the page bottom');
  assert.equal(inline.nextElementSibling.dataset.taskId, 'write');
  assert.equal(s.document.getElementById('demoRootComposer').contains(input), false);
  type(s, input, '一个全新的示例步骤');
  labelled(inline, '保存演示任务').click();
  const added = [...s.document.querySelectorAll('[data-task-id]')].find(element => element.textContent.includes('一个全新的示例步骤'));
  assert.ok(added, 'the saved example appears in the local checklist');
  assert.equal(Number(added.dataset.depth), Number(row(s, 'idea').dataset.depth) + 1);
  assert.equal(s.document.getElementById('demoTaskInput'), null);
});

test('switching between child and root add actions preserves an unfinished local draft', t => {
  const s = site(t), input = addChild(s, 'idea');
  type(s, input, '暂时没有写完的想法');
  input.setSelectionRange(2, 6, 'backward');
  row(s, 'walk').querySelector('button[aria-label$="下新增子任务"]').click();
  labelled(s.document, '演示：新增顶级待办').click();
  assert.equal(s.document.getElementById('demoTaskInput'), input);
  assert.equal(input.value, '暂时没有写完的想法');
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 6);
  assert.equal(input.selectionDirection, 'backward');
  labelled(input.parentElement, '取消演示新增').click();
  assert.equal(s.document.getElementById('demoTaskInput'), null);
  labelled(s.document, '演示：新增顶级待办').click();
  assert.ok(s.document.getElementById('demoRootComposer').contains(s.document.getElementById('demoTaskInput')));
});

test('visitor-supplied demo text is rendered literally without inserting HTML or executing code', t => {
  const s = site(t), input = addChild(s, 'idea');
  const text = '<img src=x onerror="window.__demoXss=1"> 只是任务文字';
  type(s, input, text);
  labelled(input.parentElement, '保存演示任务').click();
  assert.ok([...s.document.querySelectorAll('[data-task-id]')].some(element => element.textContent.includes(text)));
  assert.equal(s.document.querySelectorAll('#demoTasks img,#demoTasks script').length, 0);
  assert.equal(s.window.__demoXss, undefined);
});

test('the demo can collapse and reset after completion and transparency changes', t => {
  const s = site(t);
  row(s, 'walk').querySelector('[role="checkbox"]').click();
  const opacity = s.document.getElementById('demoOpacity'); opacity.value = '0'; opacity.dispatchEvent(new s.window.Event('input'));
  s.document.getElementById('collapseDemo').click();
  assert.equal(s.document.getElementById('collapseDemo').getAttribute('aria-expanded'), 'false');
  s.document.getElementById('resetDemo').click();
  assert.equal(s.document.getElementById('collapseDemo').getAttribute('aria-expanded'), 'true');
  assert.equal(s.document.querySelectorAll('[data-task-id]').length, 5);
  assert.equal(row(s, 'walk').querySelector('[role="checkbox"]').getAttribute('aria-checked'), 'false');
  assert.equal(row(s, 'plant').querySelector('[role="checkbox"]').getAttribute('aria-checked'), 'true');
  assert.equal(opacity.value, '12');
  assert.equal(s.document.getElementById('opacityValue').textContent, '12%');
  assert.match(s.document.getElementById('demoStatus').textContent, /已重置/);
});

test('local navigation anchors resolve and the FAQ uses working native disclosure controls', t => {
  const s = site(t);
  for (const link of s.document.querySelectorAll('a[href^="#"]')) {
    const id = link.getAttribute('href').slice(1);
    if (id) assert.ok(s.document.getElementById(id), `the local navigation target exists: ${id}`);
  }
  const faqs = [...s.document.querySelectorAll('.faq-list details')];
  assert.ok(faqs.length > 0);
  for (const faq of faqs) {
    const summary = faq.querySelector('summary'); assert.ok(summary);
    assert.equal(faq.open, false); summary.click(); assert.equal(faq.open, true); summary.click(); assert.equal(faq.open, false);
  }
  assert.match(s.document.querySelector('.faq-list').textContent, /不会自动迁移历史未完成任务/);
  assert.match(s.document.querySelector('.faq-list').textContent, /不上传日记/);
});
