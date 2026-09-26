import type { Element, Root, RootContent } from "hast";
import type { Plugin } from "unified";

const opaque = new Set(["pre", "code", "svg", "math", "textarea", "button", "input"]);

/** 在渲染器加工 KaTeX/代码之前登记 AST 位置；不推算 Markdown 标记或视觉宽度。 */
export const rehypeSourcePosition: Plugin<[string, number], Root> = (source, base) => (tree) => {
  function walk(parent: Root | Element) {
    parent.children = parent.children.map((child): RootContent => {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (child.type === "element") {
        if (start != null && end != null) {
          child.properties.dataSourceStart = base + start;
          child.properties.dataSourceEnd = base + end;
        }
        if (!opaque.has(child.tagName)) walk(child);
      } else if (child.type === "text" && start != null && end != null) {
        // 实体、转义或容器续行可能改变文本长度；无法一一对应时明确回退到语义范围。
        const exact = source.slice(start, end) === child.value;
        return {
          type: "element",
          tagName: "span",
          properties: {
            dataSourceStart: base + start,
            dataSourceEnd: base + end,
            ...(exact ? { dataSourceTextStart: base + start, dataSourceTextEnd: base + end } : {}),
          },
          children: [child],
        };
      }
      return child;
    });
  }
  walk(tree);
};

export function sourceAttributes(node?: { properties?: Record<string, unknown> }) {
  const start = node?.properties?.dataSourceStart;
  const end = node?.properties?.dataSourceEnd;
  return typeof start === "number" && typeof end === "number"
    ? { "data-source-start": start, "data-source-end": end }
    : {};
}

export function textSourceOffset(start: number, end: number, domOffset: number) {
  return Math.max(start, Math.min(end, start + domOffset));
}

export function domSourceOffset(root: HTMLElement, node: Node, offset: number): number | null {
  const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  if (!element || !root.contains(element)) return null;
  const leaf = element.closest<HTMLElement>("[data-source-text-start]");
  if (leaf && root.contains(leaf)) {
    const range = root.ownerDocument.createRange();
    range.setStart(leaf, 0);
    range.setEnd(node, offset);
    return textSourceOffset(
      Number(leaf.dataset.sourceTextStart),
      Number(leaf.dataset.sourceTextEnd),
      range.toString().length,
    );
  }
  const semantic = element.closest<HTMLElement>("[data-source-start]");
  return semantic && root.contains(semantic) ? Number(semantic.dataset.sourceStart) : null;
}

export function sourceOffsetAtPoint(root: HTMLElement, x: number, y: number, target: HTMLElement) {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const semantic = target.closest<HTMLElement>("[data-source-start]");
  // 复杂块不使用浏览器在相邻正文找到的插入点。
  if (target.closest("pre,code,svg,math,.katex,.markdown-code-block,[data-source-opaque]"))
    return semantic ? Number(semantic.dataset.sourceStart) : null;
  const hit = doc.caretPositionFromPoint?.(x, y);
  const range = hit ? null : doc.caretRangeFromPoint?.(x, y);
  const node = hit?.offsetNode ?? range?.startContainer;
  const offset = hit?.offset ?? range?.startOffset ?? 0;
  // 命中必须属于点击的语义块，空白点击不能跳到远处段落。
  if (node && (!semantic || semantic.contains(node))) {
    const mapped = domSourceOffset(root, node, offset);
    if (mapped != null) return mapped;
  }
  return semantic && root.contains(semantic) ? Number(semantic.dataset.sourceStart) : null;
}

export function findSourceAnchor(root: HTMLElement, offset: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let distance = Infinity;
  let width = Infinity;
  for (const node of root.querySelectorAll<HTMLElement>("[data-source-start][data-source-end]")) {
    const start = Number(node.dataset.sourceStart),
      end = Number(node.dataset.sourceEnd);
    const gap = Math.max(start - offset, offset - end, 0);
    if (gap < distance || (gap === distance && end - start <= width)) {
      best = node;
      distance = gap;
      width = end - start;
    }
  }
  return best;
}

export function renderedAnchorY(root: HTMLElement, offset: number): number | null {
  const anchor = findSourceAnchor(root, offset);
  if (!anchor) return null;
  if (anchor.dataset.sourceTextStart != null && anchor.firstChild?.nodeType === 3) {
    const text = anchor.firstChild;
    const index = Math.max(
      0,
      Math.min(text.textContent?.length ?? 0, offset - Number(anchor.dataset.sourceTextStart)),
    );
    const range = root.ownerDocument.createRange();
    range.setStart(text, index);
    range.collapse(true);
    const rect = range.getClientRects()[0];
    if (rect) return rect.top;
  }
  return anchor.getBoundingClientRect().top;
}
