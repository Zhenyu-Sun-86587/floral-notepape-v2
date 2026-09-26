import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { containerPrefixes, prefixDecorations } from "./containerPrefix";
import { mathSyntax } from "./sourceDocument";

function state(doc: string) {
  return EditorState.create({
    doc,
    extensions: markdown({ base: markdownLanguage, extensions: mathSyntax }),
  });
}

describe("Lezer semantic container presentation", () => {
  it("普通列表与任务列表共享 marker 和正文列，任务替代所属 bullet", () => {
    const s = state("- A\n- [ ] A\n- [x] A");
    const rows = containerPrefixes(s);
    expect(rows.map((row) => row.visualSlots.map((slot) => slot.kind))).toEqual([
      ["bullet"],
      ["task"],
      ["task"],
    ]);
    expect(rows.map((row) => row.markerColumnEm)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.bodyIndentEm)).toEqual([1.8, 1.8, 1.8]);
    expect(rows.map((row) => row.visualSlots[0].text)).toEqual(["•", "☐", "☑"]);
    expect(s.sliceDoc(rows[1].task!.sourceFrom, rows[1].task!.sourceTo)).toBe("[ ]");
  });

  it("嵌套引用只保留 quote + task 两个语义槽", () => {
    const s = state("> - [ ] A\n- parent\n  - [x] child");
    const rows = containerPrefixes(s);
    expect(rows[0].visualSlots.map((slot) => slot.kind)).toEqual(["quote", "task"]);
    expect(rows[0].quoteDepth).toBe(1);
    expect(rows[2].bodyIndentEm).toBeGreaterThan(rows[1].bodyIndentEm);
    expect(rows[2].visualSlots.map((slot) => slot.kind)).toEqual(["task"]);
  });

  it("有序编号保持原始文本；active/reveal 不改变源码或行数", () => {
    const doc = "1. first\n10. tenth\n- [ ] task";
    const s = state(doc);
    const rows = containerPrefixes(s);
    expect(rows[1].visualSlots[0].text).toBe("10.");
    const inactive = prefixDecorations(s, false, 0);
    const active = prefixDecorations(s, true, rows[2].bodyFrom);
    expect(inactive.length).toBeGreaterThan(active.length);
    expect(s.doc.toString()).toBe(doc);
    expect(s.doc.lines).toBe(3);
    expect(rows[2].bodyFrom).toBe(doc.indexOf("task"));
  });

  it("纯文本 fence 中的标记不产生任务或强调语义", () => {
    const s = state("```text\n- [ ] literal\n**literal**\n```");
    expect(containerPrefixes(s)).toHaveLength(0);
    const names: string[] = [];
    syntaxTree(s).iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names).not.toContain("TaskMarker");
    expect(names).not.toContain("StrongEmphasis");
  });

  it("水平线由 Lezer 识别，不把 setext 下划线误作水平线", () => {
    const s = state("---\n\n***\n\n___\n\n____\n\nTitle\n-----");
    const names: string[] = [];
    syntaxTree(s).iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names.filter((name) => name === "HorizontalRule")).toHaveLength(4);
    expect(names).toContain("SetextHeading2");
  });

  it("裸 URL 与普通链接的 destination 有不同父节点", () => {
    const s = state("https://example.com\n\n[示例](https://example.com)");
    const urls: string[] = [];
    syntaxTree(s).iterate({
      enter(node) {
        if (node.name === "URL") urls.push(node.node.parent?.name ?? "");
      },
    });
    expect(urls).toEqual(["Paragraph", "Link"]);
  });
});
