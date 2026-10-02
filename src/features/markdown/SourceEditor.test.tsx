// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
