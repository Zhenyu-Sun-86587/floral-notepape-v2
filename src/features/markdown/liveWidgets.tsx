import { createRoot, type Root } from "react-dom/client";
import { EditorView, WidgetType } from "@codemirror/view";
import { sourceOffsetAtPoint } from "./sourcePosition";
import { MarkdownPreview } from "./MarkdownPreview";

export interface LiveOptions {
  fontSize: number;
  imageBaseDir?: string;
  imageRootDir?: string;
  allowRemoteImages?: boolean;
}

export class TextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: TextWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.className = "cm-live-prefix";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

export class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.tabIndex = -1;
    input.setAttribute("aria-label", "任务完成状态");
    input.className = "cm-live-task";
    input.onmousedown = (event) => event.preventDefault();
    input.onchange = () => {
      if (view.state.readOnly) {
        input.checked = this.checked;
        return;
      }
      const from = view.posAtDOM(input);
      // Resolve the current document position, including edits before this widget.
      if (!/^\[[ xX]\]/.test(view.state.sliceDoc(from, from + 3))) return;
      view.dispatch({
        changes: { from: from + 1, to: from + 2, insert: input.checked ? "x" : " " },
        userEvent: "input.task",
      });
    };
    return input;
  }
}

/** Complex content uses the existing sanitized renderer; only its source range is replaced. */
const renderedWidgets = new WeakMap<HTMLElement, { root: Root; observer: ResizeObserver }>();
export class MarkdownWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly options: LiveOptions,
    readonly block: boolean,
  ) {
    super();
  }
  eq(other: MarkdownWidget) {
    return (
      other.source === this.source &&
      other.block === this.block &&
      JSON.stringify(other.options) === JSON.stringify(this.options)
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement(this.block ? "div" : "span");
    dom.className = this.block ? "cm-live-block" : "cm-live-inline";
    dom.contentEditable = "false";
    dom.onmousedown = (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button,a,input")) return;
      event.preventDefault();
      const local =
        sourceOffsetAtPoint(dom, event.clientX, event.clientY, event.target as HTMLElement) ?? 0;
      const position = view.posAtDOM(dom) + Math.min(local, this.source.length);
      view.dispatch({ selection: { anchor: position } });
      view.focus();
    };
    const root = createRoot(dom);
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(dom);
    renderedWidgets.set(dom, { root, observer });
    queueMicrotask(() => {
      if (!renderedWidgets.has(dom)) return;
      root.render(<MarkdownPreview content={this.source} sourceMapping {...this.options} />);
    });
    const measure = () => view.requestMeasure();
    dom.addEventListener("load", measure, true);
    return dom;
  }
  destroy(dom: HTMLElement) {
    const rendered = renderedWidgets.get(dom);
    renderedWidgets.delete(dom);
    rendered?.observer.disconnect();
    queueMicrotask(() => rendered?.root.unmount());
  }
}
