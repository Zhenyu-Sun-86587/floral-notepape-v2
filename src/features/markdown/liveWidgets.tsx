import { createRoot, type Root } from "react-dom/client";
import { EditorView, WidgetType } from "@codemirror/view";
import { sourceOffsetAtPoint } from "./sourcePosition";
import { MarkdownPreview } from "./MarkdownPreview";

export interface LiveOptions {
  showSyntax?: boolean;
  tasksLocked?: boolean;
  onReadTaskToggle?: (offset: number, checked: boolean) => void;
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
  constructor(
    readonly checked: boolean,
    readonly disabled = false,
    readonly onReadTaskToggle?: (offset: number, checked: boolean) => void,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return (
      other.checked === this.checked &&
      other.disabled === this.disabled &&
      other.onReadTaskToggle === this.onReadTaskToggle
    );
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = this.disabled;
    input.tabIndex = -1;
    input.setAttribute("aria-label", "任务完成状态");
    input.className = "cm-live-task";
    input.onmousedown = (event) => event.preventDefault();
    input.onchange = () => {
      if (this.disabled || view.composing || (view.state.readOnly && !this.onReadTaskToggle)) {
        input.checked = this.checked;
        return;
      }
      const from = view.posAtDOM(input);
      // Resolve the current document position, including edits before this widget.
      if (!/^\[[ xX]\]/.test(view.state.sliceDoc(from, from + 3))) return;
      if (view.state.readOnly) {
        this.onReadTaskToggle?.(from, input.checked);
        return;
      }
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
    readonly referenceDefinitions = "",
    readonly readOnly = false,
  ) {
    super();
  }
  eq(other: MarkdownWidget) {
    return (
      other.source === this.source &&
      other.block === this.block &&
      other.readOnly === this.readOnly &&
      other.referenceDefinitions === this.referenceDefinitions &&
      other.options.onReadTaskToggle === this.options.onReadTaskToggle &&
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
    const onTaskToggle = (offset: number, checked: boolean) => {
      if (!renderedWidgets.has(dom) || this.options.tasksLocked || view.composing) return;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + 3 > this.source.length) return;
      const start = view.posAtDOM(dom);
      // Async renders and preceding edits must never toggle a stale source range.
      if (view.state.sliceDoc(start, start + this.source.length) !== this.source) return;
      const from = start + offset;
      if (!/^\[[ xX]\]/.test(view.state.sliceDoc(from, from + 3))) return;
      if (view.state.readOnly) {
        this.options.onReadTaskToggle?.(from, checked);
        return;
      }
      view.dispatch({
        changes: { from: from + 1, to: from + 2, insert: checked ? "x" : " " },
        userEvent: "input.task",
      });
    };
    queueMicrotask(() => {
      if (!renderedWidgets.has(dom)) return;
      root.render(
        <MarkdownPreview
          content={
            this.source + (this.referenceDefinitions ? `\n\n${this.referenceDefinitions}` : "")
          }
          sourceMapping
          {...this.options}
          onTaskToggle={
            !this.options.tasksLocked && (!this.readOnly || this.options.onReadTaskToggle)
              ? onTaskToggle
              : undefined
          }
        />,
      );
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
