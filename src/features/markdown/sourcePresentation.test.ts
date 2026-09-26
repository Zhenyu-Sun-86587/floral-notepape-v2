import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { decorate } from "./sourcePresentation";
import { mathSyntax } from "./sourceDocument";
import { codeLanguages } from "./codeLanguages";

const props = { content: "", editing: false, markdown: true, fontSize: 14 };

function decorations(doc: string, active = false, head = 0) {
  const state = EditorState.create({
    doc,
    extensions: markdown({ base: markdownLanguage, extensions: mathSyntax }),
  });
  const result: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  decorate(state, active, 0, doc.length, props, head).between(0, doc.length, (from, to, value) => {
    result.push({ from, to, spec: value.spec });
  });
  return { state, result };
}

describe("Markdown source presentation", () => {
  it("水平线为整行 divider，活动行显露原文", () => {
    const inactive = decorations("---");
    expect(inactive.result.some(({ spec }) => spec.class === "source-horizontal-rule")).toBe(true);
    expect(inactive.result.some(({ spec }) => spec.class === "source-horizontal-rule-source")).toBe(
      true,
    );
    expect(inactive.result.some(({ spec }) => spec.widget != null)).toBe(false);
    const active = decorations("---", true);
    expect(active.result.some(({ spec }) => spec.class === "source-horizontal-rule")).toBe(false);
    expect(active.state.doc.toString()).toBe(inactive.state.doc.toString());
  });

  it("裸 URL 和普通链接都带可打开目标，普通链接的目标文字在阅读态隐藏", () => {
    const doc = "https://example.com\n\n[示例](https://example.com)";
    const { result } = decorations(doc);
    const links = result.filter(({ spec }) => spec.class === "source-link");
    expect(links).toHaveLength(2);
    expect(
      links.every(
        ({ spec }) =>
          (spec.attributes as Record<string, string>)["data-source-url"] === "https://example.com",
      ),
    ).toBe(true);
    expect(
      result.some(
        ({ from, spec }) =>
          from > doc.indexOf("[示例]") && spec.widget == null && spec.class == null,
      ),
    ).toBe(true);
  });

  it("Setext 标题使用标题行的语义样式，下划线不产生水平线", () => {
    const { result } = decorations("Title\n=====");
    expect(result.some(({ spec }) => spec.class === "source-heading source-h1")).toBe(true);
    expect(result.some(({ spec }) => spec.class === "source-setext-underline")).toBe(true);
    expect(result.some(({ spec }) => spec.class === "source-horizontal-rule")).toBe(false);
  });

  it("代码语言配置与现有数学扩展可同时解析", () => {
    const { state } = decorations(
      "$E = mc^2$\n\n$$\n\\frac{1}{3}\n$$\n\n```text\n- [ ] literal\n```",
    );
    const names: string[] = [];
    syntaxTree(state).iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names).toContain("InlineMath");
    expect(names).toContain("DisplayMath");
    expect(names).not.toContain("TaskMarker");
  });

  it("TypeScript fence 使用嵌套语法树，text fence 保持字面文本", async () => {
    await codeLanguages[0].load();
    const doc = "```ts\nconst value = 1;\n```\n\n```text\nconst value = 1;\n```";
    const state = EditorState.create({
      doc,
      extensions: markdown({ base: markdownLanguage, extensions: mathSyntax, codeLanguages }),
    });
    expect(syntaxTree(state).resolveInner(doc.indexOf("value") + 2).name).toBe(
      "VariableDefinition",
    );
    expect(syntaxTree(state).resolveInner(doc.lastIndexOf("value") + 2).name).toBe("CodeText");
  });
});
