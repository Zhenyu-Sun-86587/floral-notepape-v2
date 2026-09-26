import { createRoot, type Root } from "react-dom/client";
import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { MarkdownPreviewLazy } from "./MarkdownPreviewLazy";
import { hideLeadingFrontmatter } from "./frontmatter";
import { prefixDecorations } from "./containerPrefix";
import type { Props } from "./SourceEditor";

// 复杂块使用已有只读渲染器；只有源码变化才更新该块，不持有第二份可编辑文档。
const richRoots = new WeakMap<HTMLElement, Root>();
class RichBlock extends WidgetType {
  constructor(
    readonly source: string,
    readonly props: Props,
    readonly inline: boolean,
  ) {
    super();
  }
  eq(other: RichBlock) {
    return (
      this.source === other.source &&
      this.inline === other.inline &&
      this.props.fontSize === other.props.fontSize &&
      this.props.imageBaseDir === other.props.imageBaseDir &&
      this.props.imageRootDir === other.props.imageRootDir &&
      this.props.allowRemoteImages === other.props.allowRemoteImages
    );
  }
  toDOM() {
    const element = document.createElement(this.inline ? "span" : "div");
    element.className = `source-rich-block ${this.inline ? "source-rich-inline" : ""}`;
    const root = createRoot(element);
    richRoots.set(element, root);
    root.render(
      <MarkdownPreviewLazy
        content={this.source}
        fontSize={this.props.fontSize}
        imageBaseDir={this.props.imageBaseDir}
        imageRootDir={this.props.imageRootDir}
        allowRemoteImages={this.props.allowRemoteImages}
      />,
    );
    return element;
  }
  destroy(element: HTMLElement) {
    const root = richRoots.get(element);
    richRoots.delete(element);
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent(event: Event) {
    return (event.target as HTMLElement)?.closest("a,button,input") != null;
  }
}

export function decorate(
  state: EditorState,
  active: boolean,
  from: number,
  to: number,
  props: Props,
  revealHead = state.selection.main.head,
): DecorationSet {
  if (!props.markdown) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const activeLine = state.doc.lineAt(Math.min(revealHead, state.doc.length));
  const reveal = (a: number, b: number) => active && a <= activeLine.to && b >= activeLine.from;
  const hide = (a: number, b: number) => {
    if (b > a) ranges.push(Decoration.replace({}).range(a, b));
  };
  const mark = (a: number, b: number, cls: string, attributes?: Record<string, string>) => {
    if (b > a) ranges.push(Decoration.mark({ class: cls, attributes }).range(a, b));
  };
  const source = state.doc.toString();
  const frontmatterEnd = source.length - hideLeadingFrontmatter(source).length;
  if (frontmatterEnd > 0 && !reveal(0, frontmatterEnd - 1))
    ranges.push(Decoration.replace({ block: true }).range(0, frontmatterEnd));
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const { name, from: a, to: b } = node;
      if (
        frontmatterEnd > 0 &&
        !reveal(0, frontmatterEnd - 1) &&
        a < frontmatterEnd &&
        name !== "Document"
      )
        return false;
      const line = state.doc.lineAt(a);
      const source = () => state.sliceDoc(a, b);
      const rich =
        name === "Table" ||
        name === "Image" ||
        name === "InlineMath" ||
        name === "DisplayMath" ||
        (name === "FencedCode" && /^```+mermaid\b/.test(source()));
      if (rich && !reveal(a, b)) {
        ranges.push(
          Decoration.replace({
            widget: new RichBlock(source(), props, name === "Image" || name === "InlineMath"),
            block: name !== "Image" && name !== "InlineMath",
          }).range(a, b),
        );
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(name) || /^SetextHeading[12]$/.test(name)) {
        ranges.push(
          Decoration.line({ class: `source-heading source-h${name.slice(-1)}` }).range(line.from),
        );
        if (name.startsWith("SetextHeading") && !reveal(a, b)) {
          const underline = state.doc.lineAt(b - 1);
          ranges.push(Decoration.line({ class: "source-setext-underline" }).range(underline.from));
        }
      }
      const styles: Record<string, string> = {
        StrongEmphasis: "source-strong",
        Emphasis: "source-em",
        Strikethrough: "source-strike",
        InlineCode: "source-code",
      };
      if (styles[name]) mark(a, b, styles[name]);
      if (name === "FencedCode" || name === "CodeBlock") {
        for (let i = line.number; i <= state.doc.lineAt(b).number; i++)
          ranges.push(Decoration.line({ class: "source-fence" }).range(state.doc.line(i).from));
      }
      if (name === "Link" || name === "Autolink") {
        const urlNode = node.node.getChild("URL");
        if (urlNode)
          mark(a, b, "source-link", {
            "data-source-url": state.sliceDoc(urlNode.from, urlNode.to),
          });
      }
      // 裸 URL 是 Paragraph 下的 URL 节点；Link 内的 URL 是要隐藏的目标地址。
      if (
        name === "URL" &&
        node.node.parent?.name !== "Link" &&
        node.node.parent?.name !== "Autolink"
      )
        mark(a, b, "source-link", { "data-source-url": source() });
      if (name === "HorizontalRule" && !reveal(a, b)) {
        ranges.push(Decoration.line({ class: "source-horizontal-rule" }).range(line.from));
        mark(a, b, "source-horizontal-rule-source");
        return false;
      }
      if (!reveal(a, b)) {
        if (
          ["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark"].includes(name)
        )
          hide(a, b);
        if ((name === "URL" || name === "LinkTitle") && node.node.parent?.name === "Link")
          hide(a, b);
        if (name === "CodeInfo") hide(a, b);
      }
    },
  });
  ranges.push(
    ...prefixDecorations(state, active, revealHead).filter(
      (range) =>
        frontmatterEnd === 0 || reveal(0, frontmatterEnd - 1) || range.from >= frontmatterEnd,
    ),
  );
  return Decoration.set(ranges, true);
}
