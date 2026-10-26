// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, type WidgetType } from "@codemirror/view";
import { Tile } from "../../components/Tile";
import { CapsulePreview } from "../../platform/macos/capsules/Preview";
import { MarkdownPreview } from "./MarkdownPreview";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";
import { undo } from "@codemirror/commands";
import type { MarkdownDisplayMode } from "./displayMode";
import fixture from "../../../Docs/fixtures/mac-markdown-acceptance.md?raw";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
// SVG layout is verified in the browser. jsdom cannot measure Mermaid text.
vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => (
    <pre data-testid="mermaid-source">{source}</pre>
  ),
}));
let host: HTMLDivElement;
let root: Root;
let source: string;
let detachedWidgets: { widget: WidgetType; dom: HTMLElement }[] = [];
const ref = createRef<SourceEditorHandle>();
beforeEach(() => {
  detachedWidgets = [];
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
});
afterEach(async () => {
  await act(async () => {
    for (const { widget, dom } of detachedWidgets) widget.destroy(dom);
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount(panel: string, mode: MarkdownDisplayMode) {
  const entry = {
    key: "note:qa",
    title: "综合",
    colorKey: 0,
    expanded: false,
    preview: source,
    imageBaseDir: null,
    imageRootDir: null,
  };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "surface_capsule_preview_state") return { generation: 1, side: "right", entry };
    if (command === "surface_capsule_material") return { kind: "opaque", opacity: 1 };
    if (command === "surface_session_get") return { key: entry.key, displayMode: mode };
    if (command === "images_get_base_dir") return "/qa";
    if (command === "config_get") return { surfaceDisplayMode: mode, inlineEditing: true };
  });
  await act(async () =>
    root.render(
      panel === "capsule" ? (
        <CapsulePreview />
      ) : (
        <Tile
          content={source}
          displayMode={mode}
          renderMarkdown={mode !== "source"}
          inlineEditing
          contentEditorRef={ref}
          imageBaseDir="/qa"
          onContentChange={(value) => {
            source = value;
          }}
        />
      ),
    ),
  );
  const cm = host.querySelector<HTMLElement>(".cm-editor")!;
  const view = EditorView.findFromDOM(cm)!;
  await act(async () => {
    ensureSyntaxTree(view.state, source.length, 1000);
    view.dispatch({ selection: { anchor: source.length } });
  });
  const layer = host.querySelector<HTMLElement>(
    mode === "preview"
      ? ".markdown-read-layer:not(.is-inactive)"
      : ".markdown-edit-layer:not(.is-inactive)",
  )!;
  return { view, layer };
}
for (const panel of ["desktop", "capsule"])
  for (const mode of ["source", "hybrid", "preview"] as const) {
    it(`${panel}/${mode}: 综合文档的可见层、源码及所有主要 Markdown 类型`, async () => {
      const { view, layer } = await mount(panel, mode);
      expect(view.state.doc.toString()).toBe(fixture);
      if (mode === "preview") expect(layer.textContent).toContain("QA-END");
      if (mode === "source") {
        expect(view.state.doc.toString()).toContain("![引用图片][qa-image]");
        expect(layer.querySelector("input[type=checkbox],img[alt],table,.katex")).toBeNull();
      } else if (mode === "hybrid") {
        // CodeMirror virtualizes long documents. Verify its complete production
        // decoration set separately from viewport-only DOM; browser QA checks scroll/layout.
        const widgets = document.createElement("div");
        host.append(widgets);
        let headingCount = 0;
        await act(async () => {
          for (const provider of view.state.facet(EditorView.decorations)) {
            const set = typeof provider === "function" ? provider(view) : provider;
            set.between(0, fixture.length, (_from, _to, decoration) => {
              if (decoration.spec.class?.includes("cm-live-heading")) headingCount++;
              const widget = decoration.spec.widget as WidgetType | undefined;
              if (widget) {
                const dom = widget.toDOM(view);
                widgets.append(dom);
                detachedWidgets.push({ widget, dom });
              }
            });
          }
        });
        expect(widgets.querySelectorAll(".cm-live-task")).toHaveLength(9);
        expect(headingCount).toBeGreaterThanOrEqual(20);
        expect(layer.querySelector(".cm-live-strong")).not.toBeNull();
        for (const alt of ["本地综合样例", "行内综合样例", "引用图片"])
          expect(widgets.querySelector(`img[alt="${alt}"]`)?.getAttribute("src"), alt).toBe(
            "asset://localhost/qa/images/markdown-qa.svg",
          );
        expect(view.state.doc.toString()).toContain("| 左对齐 |");
        expect(view.state.doc.toString()).toContain("flowchart LR");
        expect(widgets.querySelectorAll("table")).toHaveLength(1);
        expect(widgets.querySelectorAll(".katex")).toHaveLength(3);
        expect(widgets.querySelector(".katex-error")).toBeNull();
        expect(widgets.querySelectorAll('[data-testid="mermaid-source"]')).toHaveLength(2);
        expect(widgets.querySelectorAll('[role="note"]')).toHaveLength(5);
        expect(widgets.querySelectorAll("hr")).toHaveLength(2);
      } else {
        expect(layer.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(22);
        expect(layer.querySelectorAll('input[type="checkbox"]')).toHaveLength(9);
        expect(layer.querySelectorAll("table")).toHaveLength(1);
        expect(layer.querySelectorAll('[role="note"]')).toHaveLength(5);
        expect(layer.querySelectorAll(".katex")).toHaveLength(3);
        expect(layer.querySelector(".katex-error")).toBeNull();
        expect(layer.querySelector('[data-testid="mermaid-source"]')?.textContent).toContain(
          "flowchart LR",
        );
        expect(layer.querySelectorAll("[data-footnotes]")).toHaveLength(1);
        expect(layer.querySelector('a[href="https://example.com/folded"]')).not.toBeNull();
        expect(layer.textContent).not.toContain("qa: macOS");
        expect(layer.textContent).toContain("远程图片加载已关闭");
      }
    });
  }
it("主预览渲染器检查 HTML 设置、图片和表格语义", async () => {
  await act(async () =>
    root.render(<MarkdownPreview content={fixture} imageBaseDir="/qa" renderHtml />),
  );
  expect(host.querySelector("details summary")?.textContent).toBe("折叠 HTML 标题");
  expect(host.querySelector('img[alt="引用图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/qa/images/markdown-qa.svg",
  );
  expect([...host.querySelectorAll("th")].map((e) => e.style.textAlign)).toEqual([
    "left",
    "center",
    "right",
  ]);
  expect(host.querySelector(".katex-error")).toBeNull();
});

it("综合长文循环显示模式保留文档、选区和撤销记录", async () => {
  const show = (presentation: "source" | "hybrid" | "live") =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown={presentation !== "source"}
        presentation={presentation}
        imageBaseDir="/qa"
        fontSize={14}
        editorRef={ref}
        onChange={(value) => {
          source = value;
        }}
      />,
    );
  await act(async () => show("hybrid"));
  const view = ref.current!.view!;
  await act(async () => {
    ref.current!.setSelectionRange(source.length, source.length);
    ref.current!.insertText("\nQA-APPEND");
  });
  const offset = ref.current!.selectionStart;
  for (const mode of ["source", "live", "hybrid", "source", "hybrid", "live"] as const) {
    await act(async () => show(mode));
    expect(ref.current!.view).toBe(view);
    expect(ref.current!.value).toBe(fixture + "\nQA-APPEND");
    expect(ref.current!.selectionStart).toBe(offset);
  }
  await act(async () => {
    expect(undo(view)).toBe(true);
  });
  expect(source).toBe(fixture);
});
