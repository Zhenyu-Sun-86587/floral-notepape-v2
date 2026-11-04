// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, type WidgetType } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { Tile } from "../../components/Tile";
import type { SourceEditorHandle } from "./SourceEditor";
import type { MarkdownDisplayMode } from "./displayMode";
import fixture from "../../../Docs/fixtures/mac-markdown-acceptance.md?raw";

vi.mock("#platform-note-shell", async () => vi.importActual("../../platform/macos/noteShell"));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
// jsdom cannot measure SVG or real caret geometry; the same fixture is available in browser QA.
vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <pre data-mermaid>{source}</pre>,
}));
let host: HTMLDivElement;
let root: Root;
let source: string;
const ref = createRef<SourceEditorHandle>();
let detachedWidgets: { widget: WidgetType; dom: HTMLElement }[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  source = fixture;
  detachedWidgets = [];
});
afterEach(async () => {
  await act(async () => {
    for (const { widget, dom } of detachedWidgets) widget.destroy(dom);
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});
const show = (mode: MarkdownDisplayMode, editing = false) =>
  root.render(
    <Tile
      content={source}
      displayMode={mode}
      renderMarkdown={mode !== "source"}
      inlineEditing
      editing={editing}
      contentEditorRef={ref}
      imageBaseDir="/qa"
      onContentChange={(value) => {
        source = value;
      }}
    />,
  );

it("同一综合 Markdown 完成三模式呈现、编辑、切换和撤销，保留同一份原文", async () => {
  await act(async () => {
    show("source");
    await import("./MarkdownSurface");
  });
  const view = ref.current!.view!;
  expect(view.state.readOnly).toBe(true);
  expect(host.querySelector(".markdown-edit-layer:not(.is-inactive)")).not.toBeNull();
  expect(host.querySelector(".markdown-edit-layer img, .markdown-edit-layer table")).toBeNull();
  expect(ref.current!.value).toBe(fixture);

  await act(async () => show("hybrid"));
  await act(async () => {
    expect(ensureSyntaxTree(view.state, source.length, 1000)).not.toBeNull();
    view.dispatch({ selection: { anchor: source.length } });
  });
  expect(view.state.readOnly).toBe(true);
  const widgets = document.createElement("div");
  host.append(widgets);
  let headings = 0;
  let metadataHeading = false;
  await act(async () => {
    // CodeMirror virtualizes long text. Inspect the complete decoration set once,
    // rather than repeating every format in each host and display mode.
    for (const provider of view.state.facet(EditorView.decorations)) {
      const set = typeof provider === "function" ? provider(view) : provider;
      set.between(0, fixture.length, (from, _to, decoration) => {
        if (decoration.spec.class?.includes("cm-live-heading")) {
          headings++;
          if (from < fixture.indexOf("# Markdown")) metadataHeading = true;
        }
        const widget = decoration.spec.widget as WidgetType | undefined;
        if (widget) {
          const dom = widget.toDOM(view);
          widgets.append(dom);
          detachedWidgets.push({ widget, dom });
        }
      });
    }
  });
  expect(headings).toBeGreaterThanOrEqual(20);
  expect(metadataHeading).toBe(false);
  expect(widgets.querySelectorAll(".cm-live-task")).toHaveLength(9);
  expect(widgets.querySelectorAll("table")).toHaveLength(1);
  expect(widgets.querySelectorAll(".katex")).toHaveLength(3);
  expect(widgets.querySelector(".katex-error")).toBeNull();
  expect(widgets.querySelectorAll("[data-mermaid]")).toHaveLength(2);
  expect(widgets.querySelectorAll('[role="note"]')).toHaveLength(5);
  expect(widgets.querySelectorAll("hr")).toHaveLength(2);
  for (const alt of ["本地综合样例", "行内综合样例", "引用图片", "表格引用图片"])
    expect(widgets.querySelector(`img[alt="${alt}"]`)?.getAttribute("src"), alt).toBe(
      "asset://localhost/qa/images/markdown-qa.svg",
    );
  expect(widgets.querySelector('table a[href="https://example.com"]')).not.toBeNull();

  await act(async () => show("preview"));
  const preview = host.querySelector<HTMLElement>(".markdown-read-layer:not(.is-inactive)")!;
  expect(preview.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(22);
  expect(preview.querySelectorAll('input[type="checkbox"]')).toHaveLength(9);
  expect(preview.querySelectorAll("table")).toHaveLength(1);
  expect(preview.querySelectorAll('[role="note"]')).toHaveLength(5);
  expect(preview.querySelectorAll(".katex")).toHaveLength(3);
  expect(preview.querySelectorAll("[data-mermaid]")).toHaveLength(2);
  expect(preview.querySelectorAll("[data-footnotes]")).toHaveLength(1);
  expect(preview.querySelector('a[href="https://example.com/folded"]')).not.toBeNull();
  expect(preview.textContent).not.toContain("qa: macOS");
  expect(preview.textContent).toContain("远程图片加载已关闭");
  expect(preview.textContent).toContain("QA-END");
  expect(ref.current!.view).toBe(view);
  expect(ref.current!.value).toBe(fixture);

  await act(async () => show("hybrid", true));
  await act(async () => {
    ref.current!.setSelectionRange(source.length, source.length);
    ref.current!.insertText("\nQA-APPEND");
  });
  const offset = ref.current!.selectionStart;
  for (const mode of ["preview", "source", "hybrid"] as const) {
    await act(async () => show(mode, true));
    expect(ref.current!.view).toBe(view);
    expect(ref.current!.value).toBe(fixture + "\nQA-APPEND");
    expect(ref.current!.selectionStart).toBe(offset);
  }
  await act(async () => {
    expect(undo(view)).toBe(true);
  });
  expect(source).toBe(fixture);
});
