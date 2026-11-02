import test from "node:test";
import assert from "node:assert/strict";
import { applyTodoAction, parseTodoDocument, TodoConflictError } from "../src/markdown.ts";

test("matches aliases and heading depth without leaking adjacent sections", () => {
  for (const title of ["【TODO】", "TODO", "To-do", "待办", "待办事项", "**【TODO】**"]) {
    const source = `# 日记\n## ${title}\n- [ ] 根任务\n### 工作\n- [X] 已完成\n## 复盘\n- [ ] 不展示\n`;
    const doc = parseTodoDocument(source);
    assert.deepEqual(doc.tasks.map(t => t.text), ["根任务", "已完成"]);
    assert.deepEqual(doc.tasks.map(t => t.status), ["todo", "done"]);
  }
});

test("supports standalone labels and configured titles", () => {
  const source = "【TODO】\n- [ ] A\n**【记录】**\n- [ ] B\n";
  assert.deepEqual(parseTodoDocument(source).tasks.map(t => t.text), ["A"]);
  assert.equal(parseTodoDocument("**行动清单**\n- [ ] C", { sectionTitle: "行动清单" }).tasks[0].text, "C");
  assert.equal(parseTodoDocument("## TODO\n- [ ] X", { sectionTitle: "工作" }).tasks.length, 0);
});

test("ignores frontmatter and fenced snippets, including heading-shaped text", () => {
  const source = "---\nTODO: true\n- [ ] YAML\n---\n```md\n## TODO\n- [ ] fenced\n```\n## TODO\n- [ ] real\n~~~~md\n## Other\n- [ ] hidden\n~~~~\n- [ ] real2\n";
  assert.deepEqual(parseTodoDocument(source).tasks.map(t => t.text), ["real", "real2"]);
});

test("keeps nested hierarchy, ordered bullets, tabs and custom markers", () => {
  const source = "## TODO\n- [ ] parent\n  1. [/] child\n    * [-] cancelled\n\t+ [>] deferred\n- [?] custom\n";
  const tasks = parseTodoDocument(source).tasks;
  assert.deepEqual(tasks.map(t => t.status), ["todo", "doing", "cancelled", "deferred", "custom"]);
  assert.deepEqual(tasks.map(t => t.depth), [0, 1, 2, 2, 0]);
  assert.equal(tasks[2].parentId, tasks[1].id);
  assert.deepEqual(tasks[0].childrenIds, [tasks[1].id]);
});

test("normal sibling bullets and new headings end prior task ancestry", () => {
  const tasks = parseTodoDocument("## TODO\n- [ ] A\n- note\n  - [ ] B\n### group\n  - [ ] C").tasks;
  assert.deepEqual(tasks.map(t => t.parentId), [null, null, null]);
});

test("updates exactly one line and preserves mixed line endings and all metadata", () => {
  const source = "# 2026-11-02\r\n## TODO\r\n  + [ ] Ship [[Project]] 📅 2026-11-03 ^task-a\n## Notes\r\nkeep me\n";
  const task = parseTodoDocument(source).tasks[0];
  const result = applyTodoAction(source, { type: "update", task, status: "done" });
  assert.equal(result, source.replace("[ ] Ship", "[x] Ship"));
  const edited = applyTodoAction(source, { type: "update", task, text: "重命名 [[Project]] 📅 2026-11-03 ^task-a" });
  assert.equal(edited, source.replace("Ship", "重命名"));
});

test("relocates an unchanged task when an unrelated line is inserted", () => {
  const source = "## TODO\n- [ ] A\n- [ ] B\n";
  const task = parseTodoDocument(source).tasks[1];
  const changed = "前言\n\n" + source;
  assert.equal(applyTodoAction(changed, { type: "update", task, status: "doing" }), changed.replace("[ ] B", "[/] B"));
});

test("rejects edits to changed or removed tasks instead of applying by line number", () => {
  const source = "## TODO\n- [ ] A\n- [ ] B\n";
  const task = parseTodoDocument(source).tasks[0];
  assert.throws(() => applyTodoAction(source.replace("[ ] A", "[x] A"), { type: "update", task, text: "C" }), TodoConflictError);
  assert.throws(() => applyTodoAction(source.replace("- [ ] A\n", ""), { type: "update", task, status: "done" }), TodoConflictError);
});

test("duplicate task lines remain editable in their snapshot, but conflict after any change", () => {
  const source = "## TODO\n- [ ] duplicate\n- [ ] duplicate\n";
  const task = parseTodoDocument(source).tasks[1];
  assert.equal(applyTodoAction(source, { type: "update", task, status: "done" }), "## TODO\n- [ ] duplicate\n- [x] duplicate\n");
  assert.throws(() => applyTodoAction(source + "\n", { type: "update", task, status: "done" }), TodoConflictError);
});

test("does not relocate a task outside the TODO section", () => {
  const source = "## TODO\n- [ ] A\n## Notes\n";
  const task = parseTodoDocument(source).tasks[0];
  const changed = "## TODO\n## Notes\n- [ ] A\n";
  assert.throws(() => applyTodoAction(changed, { type: "update", task, status: "done" }), TodoConflictError);
});

test("a changed section setting cannot retarget an identical task in the same document", () => {
  const source = "## TODO\n- [ ] A\n## Work\n- [ ] A\n";
  const task = parseTodoDocument(source).tasks[0];
  assert.throws(() => applyTodoAction(source, { type: "update", task, status: "done" }, { sectionTitle: "Work" }), TodoConflictError);
});

test("adds to an existing section before the separator, preserving the rest", () => {
  const source = "## TODO\r\n- [ ] A\r\n\r\n## Notes\r\nunchanged";
  assert.equal(applyTodoAction(source, { type: "add", text: "B" }), "## TODO\r\n- [ ] A\r\n- [ ] B\r\n\r\n## Notes\r\nunchanged");
});

test("creates a missing section, or appends after a non-terminated final task", () => {
  assert.equal(applyTodoAction("# 日记\r\n正文", { type: "add", text: "A" }), "# 日记\r\n正文\r\n\r\n## 【TODO】\r\n\r\n- [ ] A\r\n");
  assert.equal(applyTodoAction("", { type: "add", text: "A" }, { sectionTitle: "工作" }), "## 工作\n\n- [ ] A\n");
  assert.equal(applyTodoAction("## TODO\n- [ ] A", { type: "add", text: "B" }), "## TODO\n- [ ] A\n- [ ] B\n");
});

test("adds a child after its complete subtree but before the sibling", () => {
  const source = "## TODO\n- [ ] parent\n  - [ ] child\n    continuation\n\n- [ ] sibling\n";
  const parent = parseTodoDocument(source).tasks[0];
  assert.equal(applyTodoAction(source, { type: "add", parent, text: "new child" }), "## TODO\n- [ ] parent\n  - [ ] child\n    continuation\n  - [ ] new child\n\n- [ ] sibling\n");
});

test("rejects multiline and empty input so actions cannot inject adjacent sections", () => {
  const source = "## TODO\n- [ ] A\n";
  const task = parseTodoDocument(source).tasks[0];
  for (const text of ["", "   ", "a\n## Notes", "a\rB", "a\0b"]) {
    assert.throws(() => applyTodoAction(source, { type: "add", text }));
    assert.throws(() => applyTodoAction(source, { type: "update", task, text }));
  }
  assert.throws(() => applyTodoAction(source, { type: "update", task, status: "unknown" }));
});
