// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useSurfaceDisplayMode } from "./useSurfaceDisplayMode";
import { defaultDisplayMode, type MarkdownDisplayMode } from "../markdown/displayMode";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: null as null | ((event: { payload: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name, callback) => {
    mocks.listener = callback;
    return Promise.resolve(vi.fn());
  }),
}));
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useSurfaceDisplayMode>;
function Harness({ noteKey, defaultMode }: { noteKey: string; defaultMode: MarkdownDisplayMode }) {
  current = useSurfaceDisplayMode(noteKey, defaultMode);
  return <span>{current.mode}</span>;
}
const render = (noteKey = "note:a", defaultMode: MarkdownDisplayMode = "preview") =>
  root.render(<Harness noteKey={noteKey} defaultMode={defaultMode} />);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command, args) =>
    Promise.resolve(
      command === "surface_session_get" ? { key: args.key, displayMode: null } : undefined,
    ),
  );
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("旧配置按原来的渲染开关迁移；显式默认值优先", () => {
  expect(defaultDisplayMode({ tileRenderMarkdown: false })).toBe("source");
  expect(defaultDisplayMode({ tileRenderMarkdown: true })).toBe("preview");
  expect(defaultDisplayMode({ tileRenderMarkdown: false, surfaceDisplayMode: "hybrid" })).toBe(
    "hybrid",
  );
});
it("无覆盖跟随默认；单张覆盖持久化并同步胶囊，重置恢复跟随", async () => {
  await act(async () => render());
  expect(current.mode).toBe("preview");
  await act(async () => render("note:a", "hybrid"));
  expect(current.mode).toBe("hybrid");
  await act(async () => current.change("source"));
  expect(mocks.invoke).toHaveBeenCalledWith("surface_display_mode_set", {
    key: "note:a",
    mode: "source",
  });
  await act(async () => render("note:a", "preview"));
  expect(current.mode).toBe("source");
  await act(async () => mocks.listener?.({ payload: { key: "note:a", displayMode: "hybrid" } }));
  expect(current.mode).toBe("hybrid");
  await act(async () => current.change(null));
  expect(current.mode).toBe("preview");
  expect(current.followingDefault).toBe(true);
});
it("过期读取不覆盖新事件，切换胶囊不沿用上一张的设置", async () => {
  let resolve!: (value: unknown) => void;
  mocks.invoke.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => render());
  await act(async () => mocks.listener?.({ payload: { key: "note:a", displayMode: "hybrid" } }));
  await act(async () => resolve({ key: "note:a", displayMode: "source" }));
  expect(current.mode).toBe("hybrid");
  await act(async () => render("note:b"));
  expect(current.mode).toBe("preview");
  await act(async () => mocks.listener?.({ payload: { key: "note:a", displayMode: "source" } }));
  expect(current.mode).toBe("preview");
});
it("保存失败保留旧显示并提示错误", async () => {
  await act(async () => render());
  mocks.invoke.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => current.change("hybrid"));
  expect(current.mode).toBe("preview");
  expect(current.error).toContain("保存失败");
});
