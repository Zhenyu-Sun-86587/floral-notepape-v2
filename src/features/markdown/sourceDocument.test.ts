import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { mathSyntax, sourceChange } from "./sourceDocument";

describe("常驻 Markdown 源文档", () => {
  const content = "# 标题\n\nHello **world**\n\n- [ ] task\n\n`**literal**`\n\n$$\nx^2\n$$";
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ base: markdownLanguage, extensions: mathSyntax }), history()],
  });
  it("源码语法树保留 Markdown 与数学标记", () => {
    expect(state.doc.toString()).toBe(content);
    expect(syntaxTree(state).toString()).toContain("DisplayMath");
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
