// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { domSourceOffset, findSourceAnchor, sourceOffsetAtPoint } from "./sourcePosition";
import fixture from "../../../Docs/fixtures/markdown-presentation-1.7.4.md?raw";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

function render(source: string) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<MarkdownPreview content={source} sourceMapping />);
  return root;
}

describe("AST 源码位置桥接", () => {
  it("固定 1.7.4 fixture 直接使用 MarkdownPreview 完整管线", () => {
    const root = render(fixture);
    for (const selector of [
      "strong",
      "em",
      "del",
      "code",
      "a",
      "hr",
      "ul",
      "ol",
      "blockquote",
      "table",
      ".hljs-keyword",
      ".katex",
      ".katex-display",
      "[role=img]",
      "[data-source-opaque]",
    ])
      expect(root.querySelector(selector), selector).not.toBeNull();
    expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect(root.textContent).toContain("远程图片加载已关闭");
    expect(root.textContent).toContain("**不应变粗**");
    expect(root.querySelector(".katex")?.closest("[data-source-start]")).not.toBeNull();
  });
  it.each([
    ["hello world", "hello world", 6, 6],
    ["**hello**", "hello", 3, 5],
    ["[hello](https://example.com)", "hello", 3, 4],
    ["- [ ] hello", "hello", 3, 9],
    ["> - [ ] **桌面便签推送闭环**", "桌面便签推送闭环", 5, 15],
    ["---\ntitle: demo\n---\n\n**hello**", "hello", 3, 26],
  ])("%s 的可见文本精确映射", (source, text, index, expected) => {
    const root = render(source);
    const leaf = [...root.querySelectorAll<HTMLElement>("[data-source-text-start]")].find(
      (node) => node.textContent === text,
    )!;
    expect(leaf).toBeDefined();
    expect(domSourceOffset(root, leaf.firstChild!, index)).toBe(expected);
    expect(findSourceAnchor(root, expected)).toBe(leaf);
  });

  it("实体和转义通过逐字符映射恢复源码偏移", () => {
    const root = render("**a &amp; b**");
    const strong = root.querySelector("strong")!;
    expect(strong.querySelector("[data-source-text-start]")).toBeNull();
    expect(domSourceOffset(root, strong.firstChild!.firstChild!, 3)).toBe(9);
  });

  it("复杂块保留源码范围，内部不插入文本包装", () => {
    const source = "```mermaid\ngraph LR\nA-->B\n```\n\n---\n\n$$\nx^2\n$$\n\n`code`";
    const root = render(source);
    expect(
      root.querySelectorAll(
        "pre [data-source-text-start],code [data-source-text-start],.katex [data-source-text-start]",
      ),
    ).toHaveLength(0);
    expect(root.querySelector("[data-source-opaque]")?.getAttribute("data-source-start")).toBe("0");
    expect(root.querySelector("hr")?.getAttribute("data-source-end")).toBe(
      String(source.indexOf("---") + 3),
    );
    const code = root.querySelector("code") as HTMLElement;
    expect(sourceOffsetAtPoint(root, 0, 0, code)).toBe(source.lastIndexOf("`code`"));
  });

  it("浏览器文本命中与语义块回退不会落入其他段落", () => {
    const root = render("hello world\n\nsecond");
    const leaf = root.querySelector("[data-source-text-start]")!;
    const second = root.querySelectorAll("p")[1];
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: leaf.firstChild, offset: 6 }),
    });
    expect(sourceOffsetAtPoint(root, 0, 0, leaf as HTMLElement)).toBe(6);
    expect(sourceOffsetAtPoint(root, 0, 0, second)).toBe(13);
    Reflect.deleteProperty(document, "caretPositionFromPoint");
  });
});

function expectTextOffset(root: HTMLElement, source: string, token: string, offset: number) {
  const walker = document.createTreeWalker(root, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(token) ?? -1;
    if (index < 0) continue;
    expect(domSourceOffset(root, node, index + offset), token).toBe(source.indexOf(token) + offset);
    return;
  }
  throw new Error(`未渲染测试文字 ${token}`);
}

it("引用续行、提示块、实体与转义的可见文字映射回原文", () => {
  const source =
    "> 引用文字\n> 第二行\n\n> [!NOTE]\n> 提示文字\n\n实体 &amp; 后文 😀，转义 \\*星号\\* 尾文";
  const root = render(source);
  expectTextOffset(root, source, "第二行", 1);
  expectTextOffset(root, source, "提示文字", 2);
  expectTextOffset(root, source, "后文 😀", 5);
  expectTextOffset(root, source, "尾文", 1);
});

it("代码不解码实体，表格单元格保持精确源码落点", () => {
  const source =
    "行内 `a &amp; literal`\n\n```js\nconst value = 1;\nconsole.log(value);\n```\n\n    indented code\n\n| 姓名 |\n| --- |\n| 张三 |";
  const root = render(source);
  expectTextOffset(root, source, "&amp; literal", 6);
  expectTextOffset(root, source, "console", 2);
  expectTextOffset(root, source, "indented", 2);
  expectTextOffset(root, source, "张三", 1);
});
