// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { liveDecorations } from "./livePresentation";
import { mathSyntax } from "./sourceDocument";

function decorations(
  doc: string,
  anchor: number,
  head = anchor,
  showSyntax = false,
  readOnly = false,
) {
  let state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [
      markdown({ base: markdownLanguage, extensions: mathSyntax }),
      EditorState.readOnly.of(readOnly),
    ],
  });
  expect(ensureSyntaxTree(state, doc.length, 1000)).not.toBeNull();
  // Publish the completed parse into the state before reading decorations.
  state = state.update({}).state;
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

it("混合模式保留文字标记，同时渲染表格、图片和公式", () => {
  const doc =
    "---\ntitle: test\n---\n\n# Heading\n\n**bold** *em* ~~strike~~ `code`\n\n> quote\n\n- [x] task\n\n[link](https://example.com)\n\n```js\nlet x = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![alt](test.png)\n\n$$x^2$$\n";
  const items = decorations(doc, doc.length, doc.length, true);
  expect(items.filter((item) => item.widget)).toEqual([
    {
      from: doc.indexOf("[x]"),
      to: doc.indexOf("[x]") + 3,
      widget: "TaskWidget",
      class: undefined,
    },
    {
      from: doc.indexOf("| a | b |"),
      to: doc.indexOf("| 1 | 2 |") + "| 1 | 2 |".length,
      widget: "MarkdownWidget",
      class: undefined,
    },
    {
      from: doc.indexOf("![alt]"),
      to: doc.indexOf("![alt]") + "![alt](test.png)".length,
      widget: "MarkdownWidget",
      class: undefined,
    },
    {
      from: doc.indexOf("$$x^2$$"),
      to: doc.indexOf("$$x^2$$") + "$$x^2$$".length,
      widget: "MarkdownWidget",
      class: undefined,
    },
  ]);
  expect(items.filter((item) => !item.widget && !item.class)).toEqual([
    { from: doc.indexOf("- [x]"), to: doc.indexOf("[x]"), widget: undefined, class: undefined },
  ]);
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

it.each([
  "$x^2$",
  "$$\nx^2\n$$",
  "---",
  "***",
  "~~~mermaid\nflowchart LR\nA-->B\n~~~",
  "```mermaid\nflowchart LR\nA-->B\n```",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "> [!TIP]\n> 提示内容",
])("混合复杂内容 %s：只读始终渲染，编辑活动范围展开，离开恢复", (block) => {
  const doc = block + "\n\n末尾";
  const widgets = (anchor: number, readOnly = false, head = anchor) =>
    decorations(doc, anchor, head, true, readOnly).filter((item) => item.widget);
  expect(widgets(0, true)).toHaveLength(1);
  expect(widgets(0)).toHaveLength(0);
  expect(widgets(doc.length)).toHaveLength(1);
  expect(widgets(0, false, doc.length)).toHaveLength(0);
});

it("混合模式不把普通代码中的公式、图表或任务语法当作控件", () => {
  const doc = "```text\n$x^2$\n---\n- [ ] task\n```\n\n    $$x$$\n\n末尾";
  expect(decorations(doc, doc.length, doc.length, true).filter((item) => item.widget)).toEqual([]);
});

it("Frontmatter 在混合和活动编辑范围保持原文，不误套用标题或强调样式", () => {
  const doc = "---\ntitle: **metadata**\nqa: test\n---\n\n# 正文\n\n末尾";
  const body = doc.indexOf("# 正文");
  for (const showSyntax of [false, true]) {
    const items = decorations(doc, doc.indexOf("metadata"), undefined, showSyntax);
    const metadata = items.filter((item) => item.from < body);
    expect(metadata).toHaveLength(4);
    expect(metadata.every((item) => item.class === "cm-live-metadata")).toBe(true);
    expect(items.some((item) => item.from === body && item.class?.includes("heading"))).toBe(true);
  }
});

it("混合阅读态首行图片可见；编辑图片源码时展开，离开后恢复图片", () => {
  const doc = "![截图](images/note/photo.png)\n\n**末尾**";
  const widgets = (anchor: number, readOnly: boolean) =>
    decorations(doc, anchor, anchor, true, readOnly).filter((item) => item.widget);
  expect(widgets(0, true)).toHaveLength(1);
  expect(widgets(3, false)).toHaveLength(0);
  expect(widgets(doc.length, false)).toHaveLength(1);
});

it("混合模式中任务使用复选框且隐藏列表前缀，普通列表保留标记，选中任务仍可勾选", () => {
  const doc = "- [ ] first\n- [x] done\n- normal\n  - [ ] nested\n\n1. [X] numbered";
  const items = decorations(doc, doc.indexOf("[ ]") + 1, doc.indexOf("[ ]") + 1, true);
  expect(items.filter((item) => item.widget === "TaskWidget")).toHaveLength(4);
  expect(
    items.some((item) => item.class === "cm-live-marker" && item.from === doc.indexOf("- normal")),
  ).toBe(true);
  for (const token of ["- [ ] first", "- [x] done", "- [ ] nested", "1. [X]"]) {
    const from = doc.indexOf(token);
    expect(items.some((item) => item.from === from && item.to === from + token.indexOf("["))).toBe(
      true,
    );
  }
});

it("预览编辑态非活动引用式链接隐藏引用标签，波浪线 Mermaid 使用图表 widget", () => {
  const doc =
    "[引用链接][id] 与 [折叠链接][]\n\n[id]: https://example.com\n[折叠链接]: https://example.com/fold\n\n~~~mermaid\nflowchart LR\n A-->B\n~~~\n\n末尾";
  const items = decorations(doc, doc.length);
  const label = doc.indexOf("[id]");
  expect(
    items.some(
      (item) => item.from === label && item.to === label + 4 && !item.class && !item.widget,
    ),
  ).toBe(true);
  expect(items.filter((item) => item.widget === "MarkdownWidget")).toHaveLength(1);
});
