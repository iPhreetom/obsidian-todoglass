/** Markdown remains the source of truth. All line numbers are zero-based. */
export type TaskStatus = "todo" | "doing" | "done" | "cancelled" | "deferred" | "custom";

export interface TodoOptions {
  /** An exact title (case/space/wrapper insensitive). Omit to accept the built-in aliases. */
  sectionTitle?: string;
}

export interface TaskRef {
  id: string;
  line: number;
  raw: string;
  /** Makes duplicate lines safe when the document has changed since rendering. */
  documentHash?: string;
}

export interface TodoTask extends TaskRef {
  text: string;
  marker: string;
  status: TaskStatus;
  indent: string;
  depth: number;
  parentId: string | null;
  childrenIds: string[];
}

export interface TodoSection {
  /** Heading/label line, inclusive. */
  startLine: number;
  /** First line outside the section, exclusive. */
  endLine: number;
  /** ATX heading level; standalone labels use 0. */
  level: number;
  title: string;
}

export interface TodoDocument {
  tasks: TodoTask[];
  section: TodoSection | null;
  eol: "\n" | "\r\n";
  documentHash: string;
}

export type TodoAction =
  | { type: "update"; task: TaskRef; text?: string; status?: TaskStatus | string }
  | { type: "add"; text: string; parent?: TaskRef };

export class TodoConflictError extends Error {
  constructor(message = "日记中的这条任务已改变，请刷新后重试。") {
    super(message);
    this.name = "TodoConflictError";
  }
}

const aliases = new Set(["todo", "待办", "待办事项"]);
const markers: Record<string, string> = {
  todo: " ", doing: "/", done: "x", cancelled: "-", deferred: ">",
};
const taskPattern = /^(\s*)([-+*]|\d+[.)])(\s+)\[([^\]])\](\s*)(.*)$/;

function hash(text: string): string {
  // A compact identity checksum, not a security primitive.
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+#+\s*$/, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .replace(/^[【\[（(]|[】\]）)]$/g, "")
    .replace(/[\s_-]/g, "").toLowerCase();
}

function isWanted(title: string, options: TodoOptions): boolean {
  const value = normalizeTitle(title);
  return options.sectionTitle?.trim()
    ? value === normalizeTitle(options.sectionTitle)
    : aliases.has(value);
}

function heading(line: string): { level: number; title: string } | null {
  const match = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/.exec(line);
  return match ? { level: match[1].length, title: match[2].replace(/\s+#+\s*$/, "") } : null;
}

function standaloneLabel(line: string, options: TodoOptions = {}): string | null {
  const text = line.trim().replace(/^(\*\*|__)(.*?)\1$/, "$2");
  // Bracketed labels are also boundaries, e.g. 【复盘】 after 【TODO】.
  if (/^(?:【[^】]+】|\[[^\]]+\])$/.test(text)) return text;
  return !/^[-+*]\s/.test(text) && isWanted(text, options) ? text : null;
}

interface HiddenBlock { start: number; end: number; closed: boolean }

/** Ignore source examples, including fences/comments nested inside a list. */
function visibleLines(lines: string[], blocks = new Map<number, HiddenBlock>()): boolean[] {
  let fence: { char: string; length: number; block: HiddenBlock } | null = null;
  let comment: { close: string; block: HiddenBlock } | null = null;
  const lists: Array<{ width: number; content: number }> = [];
  let frontmatter = lines[0]?.trim() === "---";
  const yaml: HiddenBlock = { start: 0, end: lines.length, closed: false };
  return lines.map((line, index) => {
    if (frontmatter) {
      blocks.set(index, yaml);
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) { frontmatter = false; yaml.end = index + 1; yaml.closed = true; }
      return false;
    }
    const match = /^([\t ]*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      blocks.set(index, fence.block);
      if (match && match[2][0] === fence.char && match[2].length >= fence.length && !match[3].trim()) {
        fence.block.end = index + 1; fence.block.closed = true; fence = null;
      }
      return false;
    }
    if (comment) {
      blocks.set(index, comment.block);
      if (line.includes(comment.close)) { comment.block.end = index + 1; comment.block.closed = true; comment = null; }
      return false;
    }
    const leading = /^[\t ]*/.exec(line)![0];
    const width = indentation(leading);
    if (heading(line) || (line.trim() && index > 0 && !lines[index - 1].trim() && width <= (lists[0]?.width ?? -1))) lists.length = 0;
    // Four-space root code is literal, while an equally indented fence inside
    // an established list can delimit a real nested source example.
    const inListContent = lists.some(list => width >= list.content && width <= list.content + 3);
    const canOpenBlock = width <= 3 || inListContent;
    // Standalone comment blocks only; inline task metadata remains untouched.
    const trimmed = line.trimStart();
    const opener = canOpenBlock && trimmed.startsWith("<!--") ? { open: "<!--", close: "-->" }
      : canOpenBlock && trimmed.startsWith("%%") ? { open: "%%", close: "%%" } : null;
    if (opener) {
      const closed = trimmed.includes(opener.close, opener.open.length);
      const block: HiddenBlock = { start: index, end: closed ? index + 1 : lines.length, closed };
      blocks.set(index, block);
      if (!closed) comment = { close: opener.close, block };
      return false;
    }
    if (canOpenBlock && match && !(match[2][0] === "`" && match[3].includes("`"))) {
      const block: HiddenBlock = { start: index, end: lines.length, closed: false };
      blocks.set(index, block);
      fence = { char: match[2][0], length: match[2].length, block };
      return false;
    }
    const list = /^([\t ]*)([-+*]|\d+[.)])([\t ]+)/.exec(line);
    if (list) {
      while (lists.length && lists[lists.length - 1].width >= width) lists.pop();
      if (width <= 3 || inListContent) lists.push({ width, content: indentation(list[1] + list[2] + list[3]) });
    }
    return true;
  });
}

function indentation(text: string): number {
  let width = 0;
  for (const char of text) width += char === "\t" ? 4 - width % 4 : 1;
  return width;
}

export function statusForMarker(marker: string): TaskStatus {
  if (marker === " " ) return "todo";
  if (marker === "x" || marker === "X") return "done";
  if (marker === "/") return "doing";
  if (marker === "-") return "cancelled";
  if (marker === ">") return "deferred";
  return "custom";
}

export function parseTodoDocument(markdown: string, options: TodoOptions = {}): TodoDocument {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const visible = visibleLines(lines);
  const documentHash = hash(markdown);
  let section: TodoSection | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!visible[i]) continue;
    const h = heading(lines[i]);
    const title = h?.title ?? standaloneLabel(lines[i], options);
    if (title === null || !isWanted(title, options)) continue;
    section = { startLine: i, endLine: lines.length, level: h?.level ?? 0, title };
    for (let j = i + 1; j < lines.length; j++) {
      if (!visible[j]) continue;
      const nextHeading = heading(lines[j]);
      if ((nextHeading && (!section.level || nextHeading.level <= section.level)) ||
        (!section.level && standaloneLabel(lines[j], options) !== null)) {
        section.endLine = j;
        break;
      }
    }
    break;
  }
  const tasks: TodoTask[] = [];
  const stack: Array<{ width: number; task: TodoTask }> = [];
  if (section) {
    for (let i = section.startLine + 1; i < section.endLine; i++) {
      if (!visible[i]) continue;
      if (heading(lines[i])) stack.length = 0;
      const match = taskPattern.exec(lines[i]);
      if (!match) {
        // A normal sibling list item ends the preceding task's subtree.
        const bullet = /^(\s*)(?:[-+*]|\d+[.)])\s+/.exec(lines[i]);
        if (bullet) {
          const width = indentation(bullet[1]);
          while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
        }
        continue;
      }
      const width = indentation(match[1]);
      while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
      const parent = stack.at(-1)?.task;
      const task: TodoTask = {
        id: `${i}:${hash(lines[i])}`, line: i, raw: lines[i], documentHash,
        text: match[6], marker: match[4], status: statusForMarker(match[4]),
        indent: match[1], depth: stack.length, parentId: parent?.id ?? null, childrenIds: [],
      };
      parent?.childrenIds.push(task.id);
      tasks.push(task);
      stack.push({ width, task });
    }
  }
  return { tasks, section, eol, documentHash };
}

function resolveTask(document: TodoDocument, reference: TaskRef): TodoTask {
  if (!reference || typeof reference.raw !== "string" || !Number.isInteger(reference.line)) throw new TodoConflictError();
  const candidates = document.tasks.filter(task => task.raw === reference.raw);
  if (reference.documentHash === document.documentHash) {
    const task = candidates.find(task => task.line === reference.line && task.id === reference.id);
    if (task) return task;
    // No text moved in this exact document: a different scope/settings must not
    // silently retarget an identically worded task in another section.
    throw new TodoConflictError();
  }
  // Once anything changes, relocation must be unambiguous, including at the old line.
  if (candidates.length === 1) return candidates[0];
  throw new TodoConflictError(candidates.length > 1
    ? "日记发生变化，且有多条相同任务。请刷新后重试。"
    : undefined);
}

function validateText(text: string): void {
  if (typeof text !== "string" || !text.trim() || /[\r\n\0]/.test(text)) {
    throw new Error("任务内容不能为空，也不能包含换行。");
  }
}

function markerForStatus(status: string): string {
  if (Object.hasOwn(markers, status)) return markers[status];
  if (status.length === 1 && !/[\r\n\0\[\]]/.test(status)) return status;
  throw new Error("不支持的任务状态。");
}

function childIndent(document: TodoDocument, parent: TodoTask, lines: string[], visible: boolean[], end: number): string {
  const parentWidth = indentation(parent.indent);
  let shallowest: string | undefined;
  for (let line = parent.line + 1; line < end; line++) {
    if (!visible[line]) continue;
    // Ordinary list items also establish a real child level. Skipping them can
    // make an appended checkbox accidentally nest under the last ordinary item.
    const list = /^([\t ]*)(?:[-+*]|\d+[.)])[\t ]+/.exec(lines[line]);
    if (!list) continue;
    const width = indentation(list[1]);
    if (width > parentWidth && (shallowest === undefined || width < indentation(shallowest))) shallowest = list[1];
  }
  if (shallowest !== undefined) return shallowest;
  // Keep established all-space branches consistent even when this leaf has no
  // children yet. A new branch without such an edge defaults to one real Tab.
  // Use the nearest shallower source list item, not only the displayed task
  // parent: ordinary list wrappers are deliberately absent from the task tree.
  let ancestorIndent: string | undefined;
  for (let line = parent.line - 1; line > document.section!.startLine; line--) {
    if (!visible[line]) continue;
    if (heading(lines[line])) break;
    const list = /^([\t ]*)(?:[-+*]|\d+[.)])[\t ]+/.exec(lines[line]);
    if (list && indentation(list[1]) < parentWidth) { ancestorIndent = list[1]; break; }
  }
  if (/^ +$/.test(parent.indent) && ancestorIndent !== undefined && /^ *$/.test(ancestorIndent)) {
    const unit = parent.indent.length - ancestorIndent.length;
    if (unit >= 2 && unit <= 4) return parent.indent + " ".repeat(unit);
  }
  return parent.indent + "\t";
}

/** Apply inside Vault.process so reads and writes cannot race with the editor. */
export function applyTodoAction(markdown: string, action: TodoAction, options: TodoOptions = {}): string {
  const document = parseTodoDocument(markdown, options);
  const lines = markdown.split(/\r?\n/);
  const endings = Array.from(markdown.matchAll(/\r?\n/g), match => match[0]);
  const { eol } = document;
  const render = () => lines.map((line, index) => line + (endings[index] ?? "")).join("");
  const insertLine = (index: number, text: string) => {
    // A former last line needs a separator when a new line follows it.
    if (index > 0 && endings[index - 1] === undefined) endings[index - 1] = eol;
    lines.splice(index, 0, text);
    endings.splice(index, 0, eol);
  };
  if (action.type === "update") {
    const task = resolveTask(document, action.task);
    const match = taskPattern.exec(task.raw)!;
    if (action.text !== undefined) validateText(action.text);
    const marker = action.status === undefined ? task.marker : markerForStatus(action.status);
    const separator = action.text !== undefined && !match[5] ? " " : match[5];
    lines[task.line] = `${match[1]}${match[2]}${match[3]}[${marker}]${separator}${action.text ?? task.text}`;
    return render();
  }
  if (action.type !== "add") throw new Error("不支持的操作。");
  validateText(action.text);
  if (action.parent) {
    const parent = resolveTask(document, action.parent);
    const blocks = new Map<number, HiddenBlock>();
    const visible = visibleLines(lines, blocks);
    let insert = parent.line + 1;
    const parentWidth = indentation(parent.indent);
    // Insert after the complete indented subtree, including continuation paragraphs.
    while (insert < document.section!.endLine) {
      const block = blocks.get(insert);
      if (block) {
        if (indentation(/^[\t ]*/.exec(lines[block.start])![0]) <= parentWidth) break;
        if (!block.closed) throw new Error("父任务下的代码块或注释尚未闭合，请先在日记中补全后重试。");
        insert = block.end;
        continue;
      }
      const line = lines[insert];
      if (line.trim() && indentation(/^\s*/.exec(line)![0]) <= parentWidth) break;
      insert++;
    }
    // Keep section separator blank lines after the new task.
    while (insert > parent.line + 1 && !lines[insert - 1].trim()) insert--;
    insertLine(insert, `${childIndent(document, parent, lines, visible, insert)}- [ ] ${action.text}`);
    return render();
  }
  if (!document.section) {
    const title = options.sectionTitle?.trim() || "【TODO】";
    if (/[\r\n\0]/.test(title)) throw new Error("TODO 标题不能包含换行。");
    const base = markdown.replace(/(?:\r?\n)*$/, "");
    return `${base}${base ? eol + eol : ""}## ${title}${eol}${eol}- [ ] ${action.text}${eol}`;
  }
  let insert = document.section.endLine;
  while (insert > document.section.startLine + 1 && !lines[insert - 1].trim()) insert--;
  insertLine(insert, `- [ ] ${action.text}`);
  return render();
}
