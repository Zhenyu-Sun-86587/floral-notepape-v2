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
    const caret = vi.spyOn(view, "coordsAtPos").mockReturnValue({
      top: 80,
      bottom: 100,
      left: 0,
      right: 0,
    });
    await act(async () => render(false));
    expect(ref.current!.view).toBe(view);
    expect(view.state.selection.main.from).toBe(1);
    expect(view.state.selection.main.to).toBe(4);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(host.querySelector(".markdown-read-layer")?.textContent).toContain("hello!");
    expect(host.querySelector(".markdown-edit-layer")?.hasAttribute("inert")).toBe(true);
    host.scrollTop = 100;
    caret.mockReturnValue({ top: 240, bottom: 260, left: 0, right: 0 });
    await act(async () => render(true));
    // Entering must restore the anchor during the commit, before any later frame.
    expect(host.scrollTop).toBe(260);
    caret.mockRestore();
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

it("混合阅读态点击表格沿用单元格精确位置，不重算成整块末尾", async () => {
  source = "前言 😀\n\n| 名称 | 状态 |\n| --- | --- |\n| 张三 | 完成 |\n\n末尾";
  const original = source;
  const show = (editing: boolean) =>
    root.render(
      <MarkdownSurface
        content={source}
        editing={editing}
        markdown
        displayMode="hybrid"
        fontSize={14}
        editorRef={ref}
        onActivate={activate}
        onChange={(value) => {
          source = value;
        }}
      />,
    );
  await act(async () => show(false));
  const view = ref.current!.view!;
  const target = host.querySelector<HTMLElement>(".cm-live-block td span[data-source-text-start]")!;
  const offset = source.indexOf("张三") + 1;
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => ({ offsetNode: target.firstChild, offset: 1 }),
  });
  // CodeMirror can only resolve a replaced block's coarse boundary; the widget
  // has already translated the clicked cell text to Markdown.
  const coarse = vi.spyOn(view, "posAtCoords").mockReturnValue(source.length - 4);
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
    );
    target.click();
  });
  expect(activate).toHaveBeenCalledTimes(1);
  expect(coarse).not.toHaveBeenCalled();
  await act(async () => show(true));
  expect(ref.current!.selectionStart).toBe(offset);
  await act(async () => ref.current!.insertText("新"));
  expect(source).toBe(original.slice(0, offset) + "新" + original.slice(offset));
  await act(async () => {
    undo(view);
  });
  expect(source).toBe(original);
  Reflect.deleteProperty(document, "caretPositionFromPoint");
});

it("混合阅读态只有启用原位编辑且未拖选文字时才响应点击", async () => {
  const show = (activationGesture: "none" | "click") =>
    root.render(
      <MarkdownSurface
        content={source}
        editing={false}
        markdown
        displayMode="hybrid"
        activationGesture={activationGesture}
        fontSize={14}
        editorRef={ref}
        onActivate={activate}
      />,
    );
  await act(async () => show("none"));
  await act(async () => ref.current!.view!.focus());
  expect(activate).not.toHaveBeenCalled();
  await act(async () => show("click"));
  await act(async () => ref.current!.setSelectionRange(0, 5));
  await act(async () => host.querySelector<HTMLElement>(".markdown-edit-layer")!.click());
  expect(activate).not.toHaveBeenCalled();
  expect(ref.current!.selectionEnd).toBe(5);
  await act(async () => ref.current!.setSelectionRange(0, 0));
  await act(async () => host.querySelector<HTMLElement>(".markdown-edit-layer")!.click());
  expect(activate).toHaveBeenCalledTimes(1);
  const view = ref.current!.view!;
  await act(async () =>
    root.render(
      <MarkdownSurface
        content={source}
        editing
        markdown
        displayMode="source"
        fontSize={14}
        editorRef={ref}
      />,
    ),
  );
  await act(async () => view.focus());
  expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");
  host.scrollTop = 150;
  await act(async () =>
    root.render(
      <MarkdownSurface
        content={source}
        editing={false}
        markdown
        displayMode="source"
        fontSize={14}
        editorRef={ref}
      />,
    ),
  );
  expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
  expect(document.activeElement).not.toBe(view.contentDOM);
  expect(host.scrollTop).toBe(150);
});

it("混合阅读态显示可勾选任务，不显示列表前缀，勾选仅写入对应标记且可撤销", async () => {
  source = "- [ ] 测试任务\n- [x] 已完成任务\n- 普通列表\n  - [ ] 嵌套任务";
  const original = source;
  const show = (locked = false, editing = false) =>
    root.render(
      <MarkdownSurface
        content={source}
        editing={editing}
        markdown
        displayMode="hybrid"
        fontSize={14}
        locked={locked}
        editorRef={ref}
        onActivate={activate}
        onChange={(value) => {
          source = value;
        }}
      />,
    );
  await act(async () => show());
  const view = ref.current!.view!;
  const tasks = () => host.querySelectorAll<HTMLInputElement>(".markdown-edit-layer .cm-live-task");
  expect(tasks()).toHaveLength(3);
  expect([...tasks()].map((task) => task.checked)).toEqual([false, true, false]);
  expect(view.contentDOM.textContent).not.toContain("[ ]");
  expect(view.contentDOM.textContent).not.toContain("[x]");
  expect(view.contentDOM.textContent).toContain("- 普通列表");
  await act(async () => tasks()[0].click());
  expect(source).toBe(original.replace("[ ]", "[x]"));
  expect(activate).not.toHaveBeenCalled();
  expect(view.state.readOnly).toBe(true);
  // Undo uses the normal editing session, as it does for preview task writes.
  await act(async () => show(false, true));
  await act(async () => {
    expect(undo(view)).toBe(true);
  });
  expect(source).toBe(original);
  await act(async () => show(true));
  expect([...tasks()].every((task) => task.disabled)).toBe(true);
  await act(async () => tasks()[0].click());
  expect(source).toBe(original);
});
