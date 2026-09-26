// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { CapsulePreview } from "./CapsulePreview";

const mock = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    mock.listeners.set(name, callback);
    return () => mock.listeners.delete(name);
  }),
}));
vi.mock("../features/markdown/MarkdownPreviewLazy", () => ({
  MarkdownPreviewLazy: ({ content }: { content: string }) => <p>{content}</p>,
}));

const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
async function emit(name: string, payload: unknown) {
  await act(async () => mock.listeners.get(name)?.({ payload }));
}
const preview = (generation: number) => ({
  generation,
  side: "left",
  entry: { key: "note:test", title: "测试便签", preview: "完整正文", colorKey: 0, expanded: false },
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
  mock.listeners.clear();
  mock.invoke.mockClear();
});

test("隐藏后停止正文刷新，拒绝迟到会话，旧关闭事件不影响新预览", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CapsulePreview />));
  await emit("capsule-preview-changed", preview(1));
  expect(container.textContent).toContain("完整正文");
  await emit("capsule-preview-hidden", 2);
  expect(container.textContent).toBe("");
  mock.invoke.mockClear();
  await emit("notes-changed", null);
  expect(mock.invoke).not.toHaveBeenCalledWith("surface_capsule_entry", expect.anything());
  await emit("capsule-preview-changed", preview(1));
  expect(container.textContent).toBe("");
  await emit("capsule-preview-changed", preview(3));
  await emit("capsule-preview-hidden", 2);
  expect(container.textContent).toContain("完整正文");
});
