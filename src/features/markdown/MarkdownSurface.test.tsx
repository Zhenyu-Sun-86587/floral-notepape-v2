// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { MarkdownSurface } from "./MarkdownSurface";
import type { SourceEditorHandle } from "./SourceEditor";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
const ref = createRef<SourceEditorHandle>();
const activate = vi.fn();
const deactivate = vi.fn();
const changed = vi.fn();
let source: string;
function render(editing: boolean) {
  root.render(
    <MarkdownSurface
      content={source}
      editing={editing}
      markdown
      fontSize={14}
      editorRef={ref}
      onActivate={activate}
      onDeactivate={deactivate}
      onChange={(value) => {
        source = value;
        changed(value);
      }}
    />,
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom 没有排版引擎；这里只验证生命周期/事件/源码，不把几何桩视为 GUI 验收。
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  host = document.createElement("div");
  host.className = "overflow-y-auto";
  document.body.append(host);
  root = createRoot(host);
  source = "hello **world**\n\n- [ ] A\n\n[link](https://example.com)";
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("常驻 MarkdownSurface", () => {
  it("空白便签进入编辑从正文首行开始，组合输入不经过普通键入通道", async () => {
    source = "";
    await act(async () => render(false));
    host.scrollTop = 120;
    await act(async () => render(true));
    expect(host.scrollTop).toBe(0);
    expect(ref.current!.selectionStart).toBe(0);
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "中文",
      isComposing: true,
    });
    await act(async () => ref.current!.view!.contentDOM.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(source).toBe("");
  });

  it("跨读写切换保留 EditorView、选区、撤销历史；阅读缓存来自 doc", async () => {
    await act(async () => render(true));
    const view = ref.current!.view!;
    await act(async () => {
      view.dispatch({
        changes: { from: 5, insert: "!" },
        selection: { anchor: 1, head: 4 },
        userEvent: "input",
      });
      render(true);
    });
    expect(host.querySelector(".markdown-read-layer")?.textContent).not.toContain("hello!");
    await act(async () => render(false));
    expect(ref.current!.view).toBe(view);
    expect(view.state.selection.main.from).toBe(1);
    expect(view.state.selection.main.to).toBe(4);
    expect(host.querySelector(".markdown-read-layer")?.textContent).toContain("hello!");
    expect(host.querySelector(".markdown-edit-layer")?.hasAttribute("inert")).toBe(true);
    await act(async () => render(true));
    expect(ref.current!.view).toBe(view);
    await act(async () => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).not.toContain("hello!");
  });

  it("任务写回一次源码且不进入编辑，链接优先打开", async () => {
    await act(async () => render(false));
    const original = source;
    const view = ref.current!.view!;
    await act(async () =>
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    expect(view.state.doc.toString()).toBe(original.replace("[ ]", "[x]"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
    await act(async () => (host.querySelector("a") as HTMLAnchorElement).click());
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(activate).not.toHaveBeenCalled();
    expect(ref.current!.view).toBe(view);
  });

  it("点击新词覆盖旧选区，工具栏返回保留新光标", async () => {
    await act(async () => render(false));
    const leaf = host.querySelector("strong span")!;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: leaf.firstChild, offset: 3 }),
    });
    await act(async () => (leaf as HTMLElement).click());
    expect(activate).toHaveBeenCalledTimes(1);
    await act(async () => render(true));
    expect(ref.current!.selectionStart).toBe(source.indexOf("world") + 3);
    await act(async () => render(false));
    await act(async () => render(true));
    expect(ref.current!.selectionStart).toBe(source.indexOf("world") + 3);
    Reflect.deleteProperty(document, "caretPositionFromPoint");
  });

  it("组合输入期间不隐藏编辑器或应用外部更新", async () => {
    await act(async () => render(true));
    const view = ref.current!.view!;
    await act(async () =>
      view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    source = "外部更新";
    await act(async () => render(false));
    expect(view.state.doc.toString()).not.toBe(source);
    expect(host.querySelector(".markdown-edit-layer")?.hasAttribute("inert")).toBe(false);
    expect(ref.current!.view).toBe(view);
  });
});
