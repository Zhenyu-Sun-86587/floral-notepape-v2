import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";

type Marker = {
  from: number;
  to: number;
  kind: "bullet" | "ordered" | "quote" | "task";
  text: string;
  checked?: boolean;
};

export interface ContainerPrefixLayout {
  lineFrom: number;
  sourceFrom: number;
  sourceTo: number;
  bodyFrom: number;
  quoteDepth: number;
  indentEm: number;
  markerColumnEm: number;
  bodyIndentEm: number;
  list?: { kind: "bullet" | "ordered"; sourceMarker: string; depth: number };
  task?: { checked: boolean; sourceFrom: number; sourceTo: number };
  visualSlots: { kind: "quote" | "bullet" | "ordered" | "task"; text: string }[];
  markers: Marker[];
}

const QUOTE_EM = 1.5;
const LIST_EM = 1.8;

// Lezer 决定哪些字符是容器标记；这里仅把同一行已解析的标记归并成一个视觉前缀。
export function containerPrefixes(state: EditorState): ContainerPrefixLayout[] {
  const lines = new Map<number, { bodyFrom: number; markers: Marker[] }>();
  syntaxTree(state).iterate({
    enter(node) {
      if (!["ListMark", "TaskMarker", "QuoteMark"].includes(node.name)) return;
      const line = state.doc.lineAt(node.from);
      let prefix = lines.get(line.from);
      if (!prefix) lines.set(line.from, (prefix = { bodyFrom: node.to, markers: [] }));
      const text = state.sliceDoc(node.from, node.to);
      const kind: Marker["kind"] =
        node.name === "TaskMarker"
          ? "task"
          : node.name === "QuoteMark"
            ? "quote"
            : node.node.parent?.parent?.name === "OrderedList"
              ? "ordered"
              : "bullet";
      prefix.markers.push({
        from: node.from,
        to: node.to,
        kind,
        text,
        checked: kind === "task" ? text[1]?.toLowerCase() === "x" : undefined,
      });
      let end = node.to;
      while (end < line.to && /[\t ]/.test(state.sliceDoc(end, end + 1))) end++;
      prefix.bodyFrom = Math.max(prefix.bodyFrom, end);
    },
  });
  return [...lines].map(([lineFrom, raw]) => {
    const markers = raw.markers.sort((a, b) => a.from - b.from);
    const first = markers[0];
    const leading = state.sliceDoc(lineFrom, first.from);
    const indentEm = [...leading].reduce((sum, char) => sum + (char === "\t" ? 2 : 0.5), 0);
    const quoteDepth = markers.filter((marker) => marker.kind === "quote").length;
    const listMarkers = markers.filter(
      (marker) => marker.kind === "bullet" || marker.kind === "ordered",
    );
    const owner = listMarkers[listMarkers.length - 1];
    const taskMarker = markers.find((marker) => marker.kind === "task");
    // task 取代最内层 list marker 的视觉槽；source 范围仍包含完整的 "- [ ] "。
    const visualSlots: ContainerPrefixLayout["visualSlots"] = [
      ...Array.from({ length: quoteDepth }, () => ({ kind: "quote" as const, text: "│" })),
      ...(owner
        ? [
            taskMarker
              ? { kind: "task" as const, text: taskMarker.checked ? "☑" : "☐" }
              : { kind: owner.kind, text: owner.kind === "ordered" ? owner.text : "•" },
          ]
        : []),
    ];
    const markerColumnEm = indentEm + quoteDepth * QUOTE_EM;
    return {
      lineFrom,
      sourceFrom: lineFrom,
      sourceTo: raw.bodyFrom,
      bodyFrom: raw.bodyFrom,
      quoteDepth,
      indentEm,
      markerColumnEm,
      bodyIndentEm: markerColumnEm + (owner ? LIST_EM : 0),
      list: owner
        ? {
            kind: owner.kind as "bullet" | "ordered",
            sourceMarker: owner.text,
            depth: indentEm / 0.5,
          }
        : undefined,
      task: taskMarker
        ? { checked: !!taskMarker.checked, sourceFrom: taskMarker.from, sourceTo: taskMarker.to }
        : undefined,
      visualSlots,
      markers,
    };
  });
}

class PrefixCell extends WidgetType {
  constructor(readonly layout: ContainerPrefixLayout) {
    super();
  }
  eq(other: PrefixCell) {
    return (
      this.layout.sourceFrom === other.layout.sourceFrom &&
      this.layout.sourceTo === other.layout.sourceTo &&
      this.layout.bodyIndentEm === other.layout.bodyIndentEm &&
      JSON.stringify(this.layout.visualSlots) === JSON.stringify(other.layout.visualSlots)
    );
  }
  toDOM() {
    const prefix = document.createElement("span");
    prefix.className = "source-prefix-visual";
    prefix.style.width = `${this.layout.bodyIndentEm}em`;
    prefix.style.paddingLeft = `${this.layout.indentEm}em`;
    for (const slot of this.layout.visualSlots) {
      const cell = document.createElement("span");
      cell.className = `source-prefix-cell source-prefix-${slot.kind}`;
      cell.textContent = slot.text;
      if (slot.kind === "task" && this.layout.task) {
        cell.dataset.taskOffset = String(this.layout.task.sourceFrom);
        cell.dataset.taskChecked = String(this.layout.task.checked);
        cell.setAttribute("aria-label", "切换任务状态");
      }
      prefix.append(cell);
    }
    return prefix;
  }
  ignoreEvent() {
    return false;
  }
}

export function prefixDecorations(
  state: EditorState,
  active: boolean,
  head: number,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const activeStart = state.doc.lineAt(head).from;
  for (const layout of containerPrefixes(state)) {
    const revealed = active && layout.lineFrom === activeStart;
    const indent = revealed ? (layout.sourceTo - layout.sourceFrom) * 0.55 : layout.bodyIndentEm;
    ranges.push(
      Decoration.line({
        class: "source-container-line",
        attributes: { style: `--container-indent:${indent}em` },
      }).range(layout.lineFrom),
    );
    if (!revealed && layout.sourceTo > layout.sourceFrom)
      ranges.push(
        Decoration.replace({ widget: new PrefixCell(layout) }).range(
          layout.sourceFrom,
          layout.sourceTo,
        ),
      );
  }
  return ranges;
}
