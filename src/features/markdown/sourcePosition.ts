import { textSourceMap, codeSourceMap } from "./textSourceMap";
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
        if ((child.tagName === "code" || child.tagName === "pre") && start != null && end != null) {
          const text = (node: RootContent): string =>
            node.type === "text"
              ? node.value
              : node.type === "element"
                ? node.children.map(text).join("")
                : "";
          const map = codeSourceMap(
            source.slice(start, end),
            text(child),
            base + start,
            child.tagName === "pre",
          );
          if (map) child.properties.dataSourceTextMap = JSON.stringify(map);
        }
        if (!opaque.has(child.tagName)) walk(child);
      } else if (child.type === "text" && start != null && end != null) {
        // 实体、转义或容器续行可能改变文本长度；无法一一对应时明确回退到语义范围。
        const exact = source.slice(start, end) === child.value;
        const map = exact
          ? null
          : textSourceMap(source.slice(start, end), child.value, base + start);
        return {
          type: "element",
          tagName: "span",
          properties: {
            dataSourceStart: base + start,
            dataSourceEnd: base + end,
            ...(exact ? { dataSourceTextStart: base + start, dataSourceTextEnd: base + end } : {}),
            ...(map ? { dataSourceTextMap: JSON.stringify(map) } : {}),
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

export function textSourceAttributes(node?: { properties?: Record<string, unknown> }) {
  const map = node?.properties?.dataSourceTextMap;
  return typeof map === "string" ? { "data-source-text-map": map } : {};
}

export function textSourceOffset(start: number, end: number, domOffset: number) {
  return Math.max(start, Math.min(end, start + domOffset));
}

export function domSourceOffset(root: HTMLElement, node: Node, offset: number): number | null {
  const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  if (!element || !root.contains(element)) return null;
  const leaf = element.closest<HTMLElement>("[data-source-text-start],[data-source-text-map]");
  if (leaf && root.contains(leaf)) {
    const range = root.ownerDocument.createRange();
    range.setStart(leaf, 0);
    range.setEnd(node, offset);
    if (leaf.dataset.sourceTextMap) {
      const map: number[] = JSON.parse(leaf.dataset.sourceTextMap);
      return map[Math.min(range.toString().length, map.length - 1)] ?? null;
    }
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
  if (target.closest("svg,math,.katex,[data-source-opaque]"))
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
  if (anchor.dataset.sourceTextStart != null || anchor.dataset.sourceTextMap) {
    const map: number[] | null = anchor.dataset.sourceTextMap
      ? JSON.parse(anchor.dataset.sourceTextMap)
      : null;
    let index = map
      ? map.findIndex((value) => value >= offset)
      : offset - Number(anchor.dataset.sourceTextStart);
    if (index < 0) index = map ? map.length - 1 : 0;
    const walker = root.ownerDocument.createTreeWalker(anchor, 4);
    let text = walker.nextNode();
    while (text) {
      const length = text.textContent?.length ?? 0;
      if (index <= length) {
        const range = root.ownerDocument.createRange();
        range.setStart(text, index);
        range.collapse(true);
        const rect = range.getClientRects()[0];
        if (rect) return rect.top;
        break;
      }
      index -= length;
      text = walker.nextNode();
    }
  }
  return anchor.getBoundingClientRect().top;
}
