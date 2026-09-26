import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { decorate } from "./SourceEditor";
import { mathSyntax, sourceChange } from "./sourceDocument";

describe("常驻 Markdown 源文档", () => {
  const content = "# 标题\n\nHello **world**\n\n- [ ] task\n\n`**literal**`\n\n$$\nx^2\n$$";
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ base: markdownLanguage, extensions: mathSyntax }), history()],
  });
  const props = { content, editing: false, markdown: true, fontSize: 14 };
  it("隐藏语法只生成装饰，保留源码和任务偏移", () => {
    const decorations = decorate(state, false, 0, content.length, props);
    const hidden: string[] = [];
    const tasks: number[] = [];
    decorations.between(0, content.length, (from, to, value) => {
      if (!value.spec.widget && !value.spec.class && from < to)
        hidden.push(content.slice(from, to));
      if (value.spec.attributes?.["data-task-offset"] != null)
        tasks.push(Number(value.spec.attributes["data-task-offset"]));
    });
    expect(hidden).toContain("**");
    expect(tasks).toEqual([content.indexOf("[ ]")]);
    expect(state.doc.toString()).toBe(content);
    expect(syntaxTree(state).toString()).toContain("DisplayMath");
  });
  it("当前行显露粗体标记，其他行仍保持格式", () => {
    const focused = state.update({ selection: { anchor: content.indexOf("world") + 3 } }).state;
    const decorations = decorate(focused, true, 0, content.length, { ...props, editing: true });
    const hidden: string[] = [];
    decorations.between(0, content.length, (from, to, value) => {
      if (!value.spec.widget && !value.spec.class && from < to)
        hidden.push(content.slice(from, to));
    });
    expect(hidden).not.toContain("**");
    expect(hidden).toContain("#");
    expect(focused.selection.main.head).toBe(content.indexOf("world") + 3);
  });
  it("外部局部更新映射光标，普通输入仍可撤销", () => {
    let current = state.update({ selection: { anchor: content.indexOf("world") + 2 } }).state;
    current = current.update({
      changes: sourceChange(content, "前言\n" + content),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(current.selection.main.head).toBe(content.indexOf("world") + 5);
    current = current.update({
      changes: { from: current.selection.main.head, insert: "新" },
      userEvent: "input",
    }).state;
    const undone = undo({
      state: current,
      dispatch: (tr) => {
        current = tr.state;
      },
    });
    expect(undone).toBe(true);
    expect(current.doc.toString()).toBe("前言\n" + content);
  });
});
