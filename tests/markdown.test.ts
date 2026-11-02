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

test("a new root branch uses one real Tab and preserves each original line ending", () => {
  for (const eol of ["\n", "\r\n"]) {
    const source = `## TODO${eol}- [ ] parent${eol}${eol}## Notes${eol}untouched`;
    const parent = parseTodoDocument(source).tasks[0];
    assert.equal(applyTodoAction(source, { type: "add", parent, text: "first child" }), `## TODO${eol}- [ ] parent${eol}\t- [ ] first child${eol}${eol}## Notes${eol}untouched`);
  }
  const source = "## TODO\r\n- [ ] parent\n\n## Notes\r\nkeep\n";
  const result = applyTodoAction(source, { type: "add", parent: parseTodoDocument(source).tasks[0], text: "child" });
  assert.equal(result, "## TODO\r\n- [ ] parent\n\t- [ ] child\r\n\n## Notes\r\nkeep\n");
  const noFinalNewline = "## TODO\n- [ ] parent";
  assert.equal(applyTodoAction(noFinalNewline, { type: "add", parent: parseTodoDocument(noFinalNewline).tasks[0], text: "child" }), "## TODO\n- [ ] parent\n\t- [ ] child\n");
});

test("successive Tab children, siblings and deep descendants keep their intended parent", () => {
  let source = "## TODO\n- [ ] P\n- [ ] other\n";
  for (const [parentText, text] of [["P", "A"], ["P", "B"], ["A", "G"], ["A", "H"], ["G", "deep"], ["P", "C"]]) {
    const parent = parseTodoDocument(source).tasks.find(task => task.text === parentText)!;
    source = applyTodoAction(source, { type: "add", parent, text });
  }
  assert.equal(source, "## TODO\n- [ ] P\n\t- [ ] A\n\t\t- [ ] G\n\t\t\t- [ ] deep\n\t\t- [ ] H\n\t- [ ] B\n\t- [ ] C\n- [ ] other\n");
  const tasks = parseTodoDocument(source).tasks;
  const byId = new Map(tasks.map(task => [task.id, task.text]));
  assert.deepEqual(tasks.map(task => [task.text, task.parentId ? byId.get(task.parentId) : null]), [["P", null], ["A", "P"], ["G", "A"], ["deep", "G"], ["H", "A"], ["B", "P"], ["C", "P"], ["other", null]]);
});

test("existing two- and four-space branches preserve their child style, including a new level below a leaf", () => {
  for (const unit of ["  ", "    "]) {
    const original = `## TODO\n- [ ] P\n${unit}- [ ] A\n${unit}${unit}- [ ] leaf\n- [ ] other\n`;
    let source = applyTodoAction(original, { type: "add", parent: parseTodoDocument(original).tasks[0], text: "B" });
    const leaf = parseTodoDocument(source).tasks.find(task => task.text === "leaf")!;
    source = applyTodoAction(source, { type: "add", parent: leaf, text: "deep" });
    assert.equal(source, `## TODO\n- [ ] P\n${unit}- [ ] A\n${unit}${unit}- [ ] leaf\n${unit}${unit}${unit}- [ ] deep\n${unit}- [ ] B\n- [ ] other\n`);
    const tasks = parseTodoDocument(source).tasks;
    assert.equal(tasks.find(task => task.text === "B")!.parentId, tasks[0].id);
    assert.equal(tasks.find(task => task.text === "deep")!.parentId, tasks.find(task => task.text === "leaf")!.id);
  }
});

test("mixed child indents choose the shallowest real list level instead of nesting under the last sibling", () => {
  for (const original of [
    "## TODO\n- [ ] P\n\t- [ ] wide\n\t\t- [ ] wide child\n  - [ ] shallow\n    - [ ] shallow child\n- [ ] other\n",
    "## TODO\n- [ ] P\n  - [ ] shallow\n\t- [ ] deeper under shallow\n- [ ] other\n",
  ]) {
    const source = applyTodoAction(original, { type: "add", parent: parseTodoDocument(original).tasks[0], text: "new sibling" });
    assert.equal(source, original.replace("- [ ] other\n", "  - [ ] new sibling\n- [ ] other\n"));
    const tasks = parseTodoDocument(source).tasks;
    assert.equal(tasks.find(task => task.text === "new sibling")!.parentId, tasks[0].id);
  }
  const original = "## TODO\n- [ ] top\n\t- [ ] P\n\t\t- [ ] wide\n\t  - [ ] shallow\n- [ ] other\n";
  const parent = parseTodoDocument(original).tasks.find(task => task.text === "P")!;
  const source = applyTodoAction(original, { type: "add", parent, text: "new sibling" });
  assert.equal(source, original.replace("- [ ] other\n", "\t  - [ ] new sibling\n- [ ] other\n"));
  const tasks = parseTodoDocument(source).tasks;
  assert.equal(tasks.find(task => task.text === "new sibling")!.parentId, tasks.find(task => task.text === "P")!.id);
});

test("ordinary child list items establish a safe shallow level while outside siblings do not", () => {
  const original = "## TODO\n- [ ] P\n  - ordinary item\n    - [ ] nested under ordinary\n- [ ] other\n";
  const source = applyTodoAction(original, { type: "add", parent: parseTodoDocument(original).tasks[0], text: "direct child" });
  assert.equal(source, original.replace("- [ ] other\n", "  - [ ] direct child\n- [ ] other\n"));
  const tasks = parseTodoDocument(source).tasks;
  assert.equal(tasks.find(task => task.text === "direct child")!.parentId, tasks[0].id);
  const siblingList = "## TODO\n- [ ] P\n- ordinary sibling\n  - [ ] belongs elsewhere\n";
  assert.equal(applyTodoAction(siblingList, { type: "add", parent: parseTodoDocument(siblingList).tasks[0], text: "first child" }), siblingList.replace("- ordinary sibling", "\t- [ ] first child\n- ordinary sibling"));
});

test("space-style inheritance uses the actual nearest list edge rather than skipping an ordinary wrapper", () => {
  const original = "## TODO\n- [ ] P\n  - ordinary wrapper\n      - [ ] leaf\n- [ ] other\n";
  const leaf = parseTodoDocument(original).tasks.find(task => task.text === "leaf")!;
  const source = applyTodoAction(original, { type: "add", parent: leaf, text: "new child" });
  assert.equal(source, original.replace("- [ ] other\n", "          - [ ] new child\n- [ ] other\n"));
  const tasks = parseTodoDocument(source).tasks;
  assert.equal(tasks.find(task => task.text === "new child")!.parentId, tasks.find(task => task.text === "leaf")!.id);
  const irregular = "## TODO\n- [ ] P\n - [ ] shallow left margin\n- [ ] other\n";
  const parent = parseTodoDocument(irregular).tasks.find(task => task.text === "shallow left margin")!;
  assert.equal(applyTodoAction(irregular, { type: "add", parent, text: "child" }), irregular.replace("- [ ] other\n", " \t- [ ] child\n- [ ] other\n"));
});

test("nested fenced examples and standalone comments neither determine child style nor receive the insertion", () => {
  const hidden = "    ```md\n  - [ ] code sample\n - ordinary code line\n    ```\n  <!--\n- [ ] comment sample\n  -->\n\t%%\n  - [ ] Obsidian comment sample\n\t%%\n";
  const original = `## TODO\n- [ ] P\n${hidden}- [ ] other\n`;
  const before = parseTodoDocument(original);
  assert.deepEqual(before.tasks.map(task => task.text), ["P", "other"]);
  const source = applyTodoAction(original, { type: "add", parent: before.tasks[0], text: "first child" });
  assert.equal(source, original.replace("- [ ] other\n", "\t- [ ] first child\n- [ ] other\n"));
  const tasks = parseTodoDocument(source).tasks;
  assert.deepEqual(tasks.map(task => task.text), ["P", "first child", "other"]);
  assert.equal(tasks[1].parentId, tasks[0].id);
  const outsideFence = "## TODO\n- [ ] P\n```md\n  - [ ] example\n```\n";
  assert.equal(applyTodoAction(outsideFence, { type: "add", parent: parseTodoDocument(outsideFence).tasks[0], text: "child" }), outsideFence.replace("- [ ] P\n", "- [ ] P\n\t- [ ] child\n"));
});

test("literal block delimiters in root indented code cannot hide the following TODO section", () => {
  for (const literal of ["    ```literal", "\t~~~literal", "    <!--literal"]) {
    for (const prefix of ["", "- an earlier list\n\nA separate paragraph\n\n"]) {
      const source = `${prefix}${literal}\n\n## TODO\n- [ ] real\n`;
      assert.deepEqual(parseTodoDocument(source).tasks.map(task => task.text), ["real"]);
      const result = applyTodoAction(source, { type: "add", parent: parseTodoDocument(source).tasks[0], text: "child" });
      assert.equal(result, source + "\t- [ ] child\n");
    }
  }
  for (const literal of ["        ```literal", "\t\t~~~literal", "        <!--literal"]) {
    const source = `- previous list\n${literal}\n\n## TODO\n- [ ] real\n`;
    assert.deepEqual(parseTodoDocument(source).tasks.map(task => task.text), ["real"]);
  }
  const fakeContext = "- previous list\n        - ordinary code example\n          ```literal\n\n## TODO\n- [ ] real\n";
  assert.deepEqual(parseTodoDocument(fakeContext).tasks.map(task => task.text), ["real"]);
});

test("an unfinished nested fence or comment is rejected instead of adding an invisible task inside it", () => {
  for (const block of ["\t```md\n\t- [ ] example", "  <!--\n  - [ ] example", "\t%%\n\t- [ ] example"]) {
    const original = `## TODO\n- [ ] P\n${block}`;
    assert.throws(() => applyTodoAction(original, { type: "add", parent: parseTodoDocument(original).tasks[0], text: "child" }), /尚未闭合/);
  }
});

test("status and text updates never normalize existing mixed indentation", () => {
  const original = "## TODO\r\n- [ ] P\r\n\t  + [/] child [[Project]] ^task\n";
  const child = parseTodoDocument(original).tasks[1];
  assert.equal(applyTodoAction(original, { type: "update", task: child, status: "done", text: "edited [[Project]] ^task" }), original.replace("[/] child", "[x] edited"));
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
