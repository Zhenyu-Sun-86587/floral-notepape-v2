import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, type EditorView } from "@codemirror/view";

export interface ContainerPrefix {
  lineFrom: number;
  bodyFrom: number;
  markers: {
    from: number;
    to: number;
    kind: "bullet" | "ordered" | "quote" | "task";
    checked?: boolean;
  }[];
}

// 结构只来自 Lezer；这里只读取已解析 marker 后的空白，不另建 Markdown parser。
export function containerPrefixes(state: EditorState): ContainerPrefix[] {
  const lines = new Map<number, ContainerPrefix>();
  syntaxTree(state).iterate({
    enter(node) {
      if (!["ListMark", "TaskMarker", "QuoteMark"].includes(node.name)) return;
      const line = state.doc.lineAt(node.from);
      let prefix = lines.get(line.from);
      if (!prefix)
        lines.set(line.from, (prefix = { lineFrom: line.from, bodyFrom: node.to, markers: [] }));
      const source = state.sliceDoc(node.from, node.to);
      const kind =
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
        checked: kind === "task" ? source[1].toLowerCase() === "x" : undefined,
      });
      let end = node.to;
      while (end < line.to && /[\t ]/.test(state.sliceDoc(end, end + 1))) end++;
      prefix.bodyFrom = Math.max(prefix.bodyFrom, end);
    },
  });
  return [...lines.values()];
}

export function prefixDecorations(
  state: EditorState,
  active: boolean,
  head: number,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const activeStart = state.doc.lineAt(head).from;
  for (const prefix of containerPrefixes(state)) {
    ranges.push(
      Decoration.line({
        class: "source-container-line",
        attributes: {
          "data-prefix-end": String(prefix.bodyFrom),
        },
      }).range(prefix.lineFrom),
    );
    ranges.push(
      Decoration.mark({ class: "source-container-prefix" }).range(prefix.lineFrom, prefix.bodyFrom),
    );
    const revealed = active && prefix.lineFrom === activeStart;
    const task = prefix.markers.find((marker) => marker.kind === "task");
    const taskOwner =
      task &&
      prefix.markers
        .filter((marker) => marker.kind === "bullet" && marker.to <= task.from)
        .slice(-1)[0];
    for (const marker of prefix.markers) {
      const attributes: Record<string, string> = {};
      if (marker.kind === "task" && !revealed) {
        attributes["data-task-offset"] = String(marker.from);
        attributes["data-task-checked"] = String(marker.checked);
        attributes["aria-label"] = "切换任务状态";
      }
      // mark 始终保留每个真实字符；伪元素绝对定位，不进入文本流。
      ranges.push(
        Decoration.mark({
          class: `source-prefix-slot ${revealed ? "" : `source-prefix-${marker === taskOwner ? "silent" : marker.kind}`}`,
          attributes,
        }).range(marker.from, marker.to),
      );
    }
  }
  return ranges;
}

// 使用实际字体的原生字符宽度设置悬挂缩进；首行原点不变，续行对齐正文。
// 只测量可见行，不派发 presentation transaction，也不干涉 composition DOM。
export const containerWrapping = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure();
    }
    update() {
      this.measure();
    }
    measure() {
      if (this.view.composing) return;
      this.view.requestMeasure({
        key: this,
        read: () =>
          Array.from(
            this.view.contentDOM.querySelectorAll<HTMLElement>(".source-container-line"),
          ).map((line) => {
            const from = this.view.state.doc.lineAt(this.view.posAtDOM(line)).from;
            const end = Number(line.dataset.prefixEnd);
            const first = this.view.domAtPos(from);
            const last = this.view.domAtPos(end);
            const range = document.createRange();
            range.setStart(first.node, first.offset);
            range.setEnd(last.node, last.offset);
            // 用源码边界测量整个 prefix，避免 CM 嵌套 mark 分片时重复计宽或只算最后一片。
            return { line, width: range.getBoundingClientRect().width };
          }),
        write: (rows) => {
          if (this.view.composing) return;
          for (const { line, width } of rows)
            line?.style.setProperty("--container-indent", `${width}px`);
        },
      });
    }
  },
);
