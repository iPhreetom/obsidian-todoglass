(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.TODOGLASS_CONFIG || {};
  const validUrl = value => typeof value === 'string' && /^https:\/\/github\.com\//.test(value) && !value.includes('__');
  let readyLinks = 0;
  document.querySelectorAll('[data-link]').forEach(link => {
    const url = link.dataset.link === 'download' ? config.downloadUrl : config.repoUrl;
    const ready = validUrl(url);
    const label = ready ? link.dataset.readyLabel : link.dataset.loadingLabel;
    const text = link.querySelector('span');
    if (text) text.textContent = label; else link.textContent = label;
    if (ready) {
      link.href = url;
      link.removeAttribute('aria-disabled');
      if (link.dataset.link === 'repo') { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      readyLinks++;
    } else {
      link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', event => { event.preventDefault(); $('release-status').scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); });
    }
  });
  if (readyLinks) $('release-status').textContent = 'MIT 开源 · 本地联动 · 让 Obsidian 保持运行，即可使用。';

  const initial = [
    {id: 'idea', text: '把灵感变成一个小计划', status: 'todo'},
    {id: 'write', parentId: 'idea', text: '写下三个想法', status: 'todo'},
    {id: 'choose', parentId: 'idea', text: '挑选最想做的一件', status: 'todo'},
    {id: 'walk', text: '给自己留一段散步时间', status: 'todo'},
    {id: 'plant', text: '给植物浇水', status: 'done'}
  ];
  let tasks = initial.map(task => ({...task}));
  let draft = null;
  let editing = null;
  let serial = 0;
  let collapsed = false;
  const folded = new Set();
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.setAttribute('aria-hidden', 'true');
    svg.append(use);
    return svg;
  }
  function button(className, label, glyph, handler) {
    const node = element('button', className);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.title = label;
    if (glyph) node.append(icon(glyph));
    node.addEventListener('click', handler);
    return node;
  }
  function announce(text) { $('demoStatus').textContent = text; }
  function inputBusy() {
    if (!draft && !editing) return false;
    announce('先保存或取消正在输入的内容，草稿会留在这里。');
    return true;
  }
  function forest(group, completed) {
    const list = group.slice();
    if (draft && draft.parentId && completed === (tasks.find(task => task.id === draft.parentId)?.status === 'done')) {
      const parentIndex = list.findIndex(task => task.id === draft.parentId);
      if (parentIndex !== -1) list.splice(parentIndex + 1, 0, {id: '__draft__', parentId: draft.parentId, isDraft: true});
    }
    const nodes = new Map(list.map(task => [task.id, {task, children: [], parent: null}]));
    nodes.forEach(node => {
      const parent = nodes.get(node.task.parentId);
      if (parent) { node.parent = parent; parent.children.push(node); }
    });
    const rows = [];
    function visit(siblings, depth, continuations) {
      siblings.forEach((node, index) => {
        const hasNext = index < siblings.length - 1;
        const isFolded = !completed && folded.has(node.task.id);
        rows.push({task: node.task, tree: {depth, continuations, hasNext, children: node.children.length, stem: node.children.length > 0 && !isFolded, completed}});
        if (!isFolded) visit(node.children, depth + 1, depth ? continuations.concat(hasNext) : []);
      });
    }
    visit([...nodes.values()].filter(node => !node.parent), 0, []);
    return rows;
  }
  function guides(row, tree) {
    row.style.setProperty('--depth', tree.depth);
    row.dataset.depth = tree.depth;
    tree.continuations.forEach((continues, level) => {
      if (!continues) return;
      const rail = element('span', 'demo-rail ancestor');
      rail.style.setProperty('--rail', level); rail.setAttribute('aria-hidden', 'true'); row.append(rail);
    });
    if (tree.depth) {
      const rail = element('span', 'demo-rail branch' + (tree.hasNext ? '' : ' last'));
      rail.style.setProperty('--rail', tree.depth - 1); rail.setAttribute('aria-hidden', 'true'); row.append(rail);
    }
    if (tree.stem) { const stem = element('span', 'demo-stem'); stem.setAttribute('aria-hidden', 'true'); row.append(stem); }
  }
  function beginAdd(parentId = null) {
    if (draft && draft.parentId === parentId) { $('demoTaskInput')?.focus(); return; }
    if (inputBusy()) return;
    draft = {parentId, text: ''};
    if (parentId) folded.delete(parentId);
    render();
    const input = $('demoTaskInput'); input.focus(); input.scrollIntoView({block: 'nearest'});
    announce(parentId ? '直接在这条任务下，写下下一步。' : '写下一件属于今天的小事。');
  }
  function draftFields() {
    const fields = element('div', 'demo-draft-fields');
    const input = element('textarea');
    input.id = 'demoTaskInput'; input.maxLength = 240;
    input.setAttribute('aria-label', draft.parentId ? '演示：新增子任务内容' : '演示：新增顶级任务内容');
    input.placeholder = draft.parentId ? '写下下一步…' : '添加一件事…'; input.value = draft.text;
    input.addEventListener('input', () => { draft.text = input.value; });
    const actions = element('div', 'demo-draft-actions');
    const cancel = button('', '取消演示新增', null, () => { draft = null; render(); announce('已取消。演示不会写入任何仓库。'); }); cancel.textContent = '取消';
    const save = button('', '保存演示任务', null, () => {
      const text = input.value.trim(); if (!text) { input.focus(); return; }
      const task = {id: 'new-' + (++serial), text, status: 'todo'};
      if (draft.parentId) task.parentId = draft.parentId;
      tasks.push(task); draft = null; render(); announce('已加入演示清单。真实插件会把它写回原日记。');
    }); save.textContent = '添加';
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancel.click(); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save.click(); }
    });
    actions.append(cancel, save); fields.append(input, actions); return fields;
  }
  function beginEdit(task) {
    if (inputBusy()) return;
    editing = {id: task.id, text: task.text}; render();
    const input = $('demoEditInput'); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  function editFields(task) {
    const fields = element('div', 'demo-draft-fields');
    const input = element('textarea', 'demo-edit-input'); input.id = 'demoEditInput'; input.maxLength = 240;
    input.setAttribute('aria-label', '演示：编辑任务'); input.value = editing.text;
    input.addEventListener('input', () => { editing.text = input.value; });
    const actions = element('div', 'demo-draft-actions');
    const cancel = button('', '取消演示编辑', null, () => { editing = null; render(); announce('编辑已取消。'); }); cancel.textContent = '取消';
    const save = button('', '保存演示编辑', null, () => { const text = input.value.trim(); if (!text) return; task.text = text; editing = null; render(); announce('已更新演示任务。'); }); save.textContent = '保存';
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancel.click(); } if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save.click(); } });
    actions.append(cancel, save); fields.append(input, actions); return fields;
  }
  function taskRow(task, tree) {
    const row = element('div', 'demo-task' + (task.status === 'done' ? ' done' : '') + (task.isDraft ? ' demo-draft' : ''));
    guides(row, tree);
    if (task.isDraft) { const mark = element('span', 'demo-check'); mark.style.color = '#6f875a'; mark.append(icon('plus')); row.append(mark, draftFields()); return row; }
    row.dataset.taskId = task.id;
    const check = button('demo-check', (task.status === 'done' ? '恢复演示任务：' : '完成演示任务：') + task.text, task.status === 'done' ? 'check' : null, () => {
      if (inputBusy()) return;
      task.status = task.status === 'done' ? 'todo' : 'done'; render();
      announce(task.status === 'done' ? '完成啦。任务已移到下方「已结束」，子任务保持各自状态。' : '这条任务已回到待办中。');
    }); check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', String(task.status === 'done')); row.append(check);
    if (editing?.id === task.id) row.append(editFields(task));
    else {
      const text = element('div', 'demo-text', task.text); text.tabIndex = 0; text.setAttribute('role', 'button'); text.setAttribute('aria-label', '编辑演示任务：' + task.text); text.title = '双击编辑；键盘按 Enter 编辑';
      text.addEventListener('dblclick', () => beginEdit(task)); text.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); beginEdit(task); } }); row.append(text);
    }
    if (tree.children && !tree.completed) {
      const fold = button('demo-fold', (folded.has(task.id) ? '展开' : '折叠') + '演示子任务', 'chevron', () => { if (inputBusy()) return; if (folded.has(task.id)) folded.delete(task.id); else folded.add(task.id); render(); announce('层级可以随时收起，也可以再展开。'); });
      fold.setAttribute('aria-expanded', String(!folded.has(task.id))); row.append(fold);
    }
    row.append(button('demo-task-child-add', '在“' + task.text + '”下新增子任务', 'plus', () => beginAdd(task.id)));
    return row;
  }
  function render() {
    const list = $('demoTasks'); list.replaceChildren();
    const active = tasks.filter(task => task.status !== 'done'), done = tasks.filter(task => task.status === 'done');
    if (active.length) { const head = element('div', 'demo-group-head', '待办事项'); head.append(element('span', '', String(active.length))); list.append(head); forest(active, false).forEach(({task, tree}) => list.append(taskRow(task, tree))); }
    if (done.length) { const head = element('div', 'demo-group-head finished', '已结束'); head.append(element('span', '', String(done.length))); list.append(head); forest(done, true).forEach(({task, tree}) => list.append(taskRow(task, tree))); }
    const root = $('demoRootComposer'); root.replaceChildren();
    if (draft && !draft.parentId) root.append(draftFields());
    else { const add = button('demo-root-add', '演示：新增顶级待办', 'plus', () => beginAdd()); add.append(element('span', '', '添加一件事'), element('span', '', '⌘ N')); root.append(add); }
    $('demoProgress').style.width = (tasks.length ? done.length / tasks.length * 100 : 0) + '%';
    $('demoProgressLabel').textContent = done.length + ' / ' + tasks.length + ' 已完成';
  }
  $('demoOpacity').addEventListener('input', event => {
    const value = Number(event.target.value);
    $('glassWindow').style.setProperty('--panel-opacity', value / 100);
    $('opacityValue').textContent = value + '%';
  });
  $('collapseDemo').addEventListener('click', () => {
    collapsed = !collapsed; $('glassWindow').classList.toggle('is-collapsed', collapsed);
    $('collapseDemo').setAttribute('aria-expanded', String(!collapsed));
    $('collapseDemo').setAttribute('aria-label', collapsed ? '展开演示浮窗' : '收起演示浮窗');
    announce(collapsed ? '收成一小条。需要时，再展开。' : '今日待办已展开。');
  });
  $('resetDemo').addEventListener('click', () => {
    tasks = initial.map(task => ({...task})); draft = null; editing = null; folded.clear(); serial = 0;
    collapsed = false; $('glassWindow').classList.remove('is-collapsed'); $('collapseDemo').setAttribute('aria-expanded', 'true'); $('collapseDemo').setAttribute('aria-label', '收起演示浮窗');
    $('demoOpacity').value = '12'; $('opacityValue').textContent = '12%'; $('glassWindow').style.setProperty('--panel-opacity', '.12');
    render(); announce('演示已重置。所有内容都是合成示例。');
  });
  render();
})();
