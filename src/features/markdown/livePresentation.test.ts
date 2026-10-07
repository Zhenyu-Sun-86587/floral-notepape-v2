// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { liveDecorations } from "./livePresentation";
import { mathSyntax } from "./sourceDocument";

function decorations(doc: string, anchor: number, head = anchor, showSyntax = false) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: markdown({ base: markdownLanguage, extensions: mathSyntax }),
  });
  ensureSyntaxTree(state, doc.length, 1000);
  const items: { from: number; to: number; widget?: string; class?: string }[] = [];
  liveDecorations(state, { fontSize: 14, showSyntax }).between(0, doc.length, (from, to, value) => {
    items.push({ from, to, widget: value.spec.widget?.constructor.name, class: value.spec.class });
  });
  return items;
}

describe("局部 Markdown 呈现", () => {
  it("标题和行内强调只显示活动范围的标记，UTF-16 坐标保持原文", () => {
    const doc = "# 标题\n\n😀 **粗体** 与 *强调*\n\n末尾";
    const bold = doc.indexOf("**");
    const collapsed = decorations(doc, doc.length);
    expect(collapsed).toContainEqual({ from: 0, to: 2, widget: undefined, class: undefined });
    expect(collapsed.some((d) => d.from === bold && d.to === bold + 2)).toBe(true);
    const active = decorations(doc, bold + 3);
    expect(active.some((d) => d.from === bold && d.to === bold + 2)).toBe(false);
    expect(active.some((d) => d.class === "cm-live-strong")).toBe(true);
    expect(active.some((d) => d.from === doc.indexOf("*强调*") && !d.class)).toBe(true);
  });
  it("跨语法选择揭开所跨标记，不折叠选区内部", () => {
    const doc = "前文 **粗体** *斜体* 后文\n其他";
    const selected = decorations(doc, 4, 14);
    expect(selected.filter((d) => !d.class && !d.widget)).toEqual([]);
  });
  it("任务控件、图片、表格和公式替换均保持各自源范围", () => {
    const doc =
      "- [ ] task\n\n![alt](image.png)\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\nend";
    const inactive = decorations(doc, doc.length);
    expect(inactive.some((d) => d.widget === "TaskWidget" && d.from === 2 && d.to === 5)).toBe(
      true,
    );
    expect(inactive.filter((d) => d.widget === "MarkdownWidget")).toHaveLength(3);
    const active = decorations(doc, doc.indexOf("x^2"));
    expect(active.filter((d) => d.widget === "MarkdownWidget")).toHaveLength(2);
  });
});

it("混合模式保留所有语法，不隐藏元数据或替换复杂块，仍提供格式", () => {
  const doc =
    "---\ntitle: test\n---\n\n# Heading\n\n**bold** *em* ~~strike~~ `code`\n\n> quote\n\n- [x] task\n\n[link](https://example.com)\n\n```js\nlet x = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![alt](test.png)\n\n$$x^2$$\n";
  const items = decorations(doc, doc.length, doc.length, true);
  expect(items.every((item) => !!item.class && !item.widget)).toBe(true);
  for (const cls of [
    "cm-live-strong",
    "cm-live-em",
    "cm-live-strike",
    "cm-live-code",
    "cm-live-codeblock",
    "cm-live-quote",
    "cm-live-marker",
  ])
    expect(items.some((item) => item.class === cls)).toBe(true);
});
