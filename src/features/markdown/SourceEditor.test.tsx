// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inlineEditingCases } from "./inlineEditingCases.testdata";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let source: string;
const editor = createRef<SourceEditorHandle>();
function render(markdown = true) {
  root.render(
    <SourceEditor
      content={source}
      editing
      markdown={markdown}
      fontSize={14}
      editorRef={editor}
      onChange={(value) => {
        source = value;
      }}
    />,
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  source = "# Long note\n" + "中文连续输入 **Markdown** 内容\n".repeat(2000);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("长文连续输入回传不重复拆分全文，外部更新仍最小写入且保留撤销历史", async () => {
  await act(async () => render());
  const view = editor.current!.view!;
  const normalize = vi.spyOn(EditorState.prototype, "toText");
  normalize.mockClear();
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: "字" }, userEvent: "input" });
      render();
    });
  }
  expect(normalize).not.toHaveBeenCalled();
  expect(editor.current!.value).toBe(source);
  source += "\n外部更新\r\n末行";
  await act(async () => render());
  expect(normalize).toHaveBeenCalled();
  expect(editor.current!.value.endsWith("外部更新\n末行")).toBe(true);
  expect(editor.current!.view).toBe(view);
  await act(async () => {
    expect(undo(view)).toBe(true);
  });
  expect(editor.current!.value.endsWith("外部更新\n末行")).toBe(true);
  expect(editor.current!.value.match(/^字+/)?.[0].length ?? 0).toBeLessThan(20);
});

it("未改变语言开关的重渲染不派发配置事务，真正切换开关仍生效", async () => {
  await act(async () => render());
  const view = editor.current!.view!;
  const dispatch = vi.spyOn(view, "dispatch");
  await act(async () => render());
  expect(dispatch).not.toHaveBeenCalled();
  await act(async () => render(false));
  expect(dispatch).toHaveBeenCalledTimes(1);
  await act(async () => render(false));
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("live 呈现保留原文、撤销和异步图片的事务映射位置", async () => {
  source = "# 标题\n\n前文 **粗体**\n\n- [ ] task\n";
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="live"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  const original = source;
  await act(async () =>
    editor.current!.setSelectionRange(source.indexOf("前文") + 2, source.indexOf("前文") + 2),
  );
  const pending = editor.current!.prepareInsertion!();
  await act(async () => view.dispatch({ changes: { from: 0, insert: "新" }, userEvent: "input" }));
  await act(async () => pending.insert("图片"));
  expect(source).toBe("新" + original.replace("前文", "前文图片"));
  const offset = source.indexOf("[ ]");
  await act(async () => editor.current!.toggleTask(offset, true));
  expect(source).toContain("[x]");
  await act(async () => {
    undo(view);
  });
  expect(source).toContain("[ ]");
  expect(editor.current!.view).toBe(view);
});

it("拖选期间不会重排语法，松开后按新选区展开", async () => {
  source = "开头\n\n**粗体**\n\n末尾";
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="live"
        fontSize={14}
        editorRef={editor}
      />,
    ),
  );
  const view = editor.current!.view!;
  expect(view.contentDOM.textContent).not.toContain("**");
  await act(async () => {
    view.dom.dispatchEvent(new Event("pointerdown"));
    view.dispatch({ selection: { anchor: source.indexOf("粗体") } });
  });
  expect(view.contentDOM.textContent).not.toContain("**");
  await act(async () => window.dispatchEvent(new Event("pointerup")));
  expect(view.contentDOM.textContent).toContain("**粗体**");
});

it("任务 widget 使用当前源码位置，前面的编辑不会使勾选写错位置", async () => {
  source = "前言\n\n- [ ] task\n";
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="live"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  await act(async () =>
    view.dispatch({ changes: { from: 0, insert: "追加" }, userEvent: "input" }),
  );
  const task = host.querySelector<HTMLInputElement>(".cm-live-task")!;
  await act(async () => {
    task.checked = true;
    task.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(source).toBe("追加前言\n\n- [x] task\n");
  await act(async () => {
    undo(view);
  });
  expect(source).toBe("追加前言\n\n- [ ] task\n");
});

it.each(Object.entries(inlineEditingCases))(
  "%s 呈现、切换开关与撤销不改写 Markdown 原文",
  async (_name, original) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    source = original;
    const show = (presentation: "source" | "live") =>
      root.render(
        <SourceEditor
          content={source}
          editing
          markdown
          presentation={presentation}
          fontSize={16}
          editorRef={editor}
          onChange={(value) => {
            source = value;
          }}
        />,
      );
    await act(async () => show("live"));
    const view = editor.current!.view!;
    await act(async () => {
      editor.current!.setSelectionRange(source.length, source.length);
      editor.current!.insertText("\n测试新增");
    });
    expect(source).toBe(original + "\n测试新增");
    await act(async () => show("source"));
    expect(editor.current!.view).toBe(view);
    await act(async () => {
      expect(undo(view)).toBe(true);
    });
    expect(source).toBe(original);
    await act(async () => show("live"));
    expect(editor.current!.value).toBe(original);
    vi.unstubAllGlobals();
  },
);
