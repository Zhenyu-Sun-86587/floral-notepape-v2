// @vitest-environment jsdom
import { act, useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotePad } from "./NotePad";
import { SettingsPanel } from "./SettingsPanel";
import { syncLanguage } from "../locales";
import { defaultDisplayMode } from "../features/markdown/displayMode";
import type { AppConfig } from "../features/settings/types";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  tile: null as any,
  listeners: new Map<string, (event: any) => void>(),
}));
// Exercise the macOS host on every CI platform, including its production shell hook.
vi.mock("#platform-note-shell", async () => vi.importActual("../platform/macos/noteShell"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, callback: any) => {
    mocks.listeners.set(name, callback);
    return Promise.resolve(() => mocks.listeners.delete(name));
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "tile-linked-binding-test",
    listen: () => Promise.resolve(() => {}),
    onMoved: () => Promise.resolve(() => {}),
    onResized: () => Promise.resolve(() => {}),
    onCloseRequested: () => Promise.resolve(() => {}),
  }),
}));
vi.mock("../features/windows/useInitialWindowReveal", () => ({ useInitialWindowReveal: () => {} }));
vi.mock("#platform-material", () => ({ applyNativeMaterial: () => Promise.resolve() }));
vi.mock("../features/settings/theme", () => ({
  applyAppearance: () => {},
  applyTheme: () => {},
  watchSystemTheme: () => () => {},
  resolveAppearance: () => ({
    radius: 12,
    background: "#1a1b26",
    foreground: "#c0caf5",
    muted: "#9aa5ce",
  }),
}));
vi.mock("#platform-settings", () => ({ PlatformSettings: () => null }));
vi.mock("./AppearanceSection", () => ({ AppearanceSection: () => null }));
vi.mock("./Toast", () => ({ showToast: mocks.toast }));
vi.mock("./Tile", () => ({
  tileTextColors: () => ({ titleColor: "#c0caf5", emptyColor: "#c0caf5" }),
  Tile: (props: any) => {
    mocks.tile = props;
    const latest = useRef(props);
    latest.current = props;
    useImperativeHandle(
      props.contentEditorRef,
      () => ({
        get value() {
          return latest.current.content;
        },
        selectionStart: 0,
        selectionEnd: 0,
        focus() {},
        insertText: vi.fn(),
        composing: false,
      }),
      [],
    );
    return (
      <div data-test-tile>
        {props.content}
        {props.notice}
      </div>
    );
  },
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const config = {
  locale: "zh-CN",
  theme: "light",
  tileColor: "#ffffff",
  tileColorMode: "system",
  tileRenderMarkdown: true,
  surfaceDisplayMode: null,
  noteSurfaceAutoSave: false,
  externalFileAutoSave: false,
  fontSize: 14,
  surfaceFontSize: 14,
  defaultViewMode: "edit",
} as AppConfig;
beforeEach(() => {
  mocks.listeners.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.invoke.mockImplementation(async (command: string, _args: any, options: any) => {
    if (command === "config_get") return config;
    if (command === "notes_list") return [];
    if (command === "linked_read")
      return {
        binding: { id: "binding-test", path: "/test/document.md" },
        content: "external text",
        revision: "r1",
        imageRoot: "/test",
      };
    if (command === "linked_save") return "r2";
    if (command === "images_get_base_dir") return "/test/internal";
    if (command === "surface_session_get")
      return { key: _args.key, locked: false, displayMode: null };
    if (command === "images_save") {
      if (options.headers["x-note-id"]) throw new Error("noteNotFound: binding-test");
      return "floral-image-test.png";
    }
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  await syncLanguage("zh-CN");
});
it("绑定文件图片使用外部接口，原生模式提示遵循语言设置", async () => {
  await syncLanguage("en-US");
  await act(async () =>
    root.render(
      <NotePad initialBindingId="binding-test" initialSurfaceMode="tile" initialAutoSave={false} />,
    ),
  );
  expect(host.textContent).toContain("external text");
  const native = mocks.invoke.mock.calls
    .filter(([command]) => command === "surface_native_note_state")
    .slice(-1)[0]!;
  expect(native[1].state.displayModeLabel).toBe("Display mode: Preview. Click to switch to Source");
  expect(native[1].state.colors).toEqual({
    background: expect.any(String),
    foreground: "#c0caf5",
    muted: "#c0caf5",
  });
  const file = {
    type: "image/png",
    size: 8,
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
  };
  await act(async () => {
    mocks.tile.onEditorPaste({
      preventDefault: vi.fn(),
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
  });
  const call = mocks.invoke.mock.calls.find(([cmd]) => cmd === "images_save")!;
  expect(call).toBeDefined();
  expect(call[2].headers).toEqual({ "x-linked-id": "binding-test", "x-image-ext": "png" });
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.tile.contentEditorRef.current.insertText).toHaveBeenCalledWith(
    "![](floral-image-test.png)\n",
  );
  expect(mocks.invoke.mock.calls.some(([command]) => command === "linked_save")).toBe(false);
});

it("桌面冲突提供解决入口，关闭失败可见；载入失败不提前推进磁盘版本", async () => {
  const originalInvoke = mocks.invoke.getMockImplementation()!;
  let failClear = true;
  mocks.invoke.mockImplementation(async (command, args, options) => {
    if (command === "linked_read_draft") return { content: "local draft", baseRevision: "r0" };
    if (command === "linked_save" && !args.overwrite)
      throw { code: "externalConflict", message: "conflict" };
    if (command === "linked_write_draft" && args.content === null && failClear)
      throw new Error("draft clear failed");
    return originalInvoke(command, args, options);
  });
  await act(async () =>
    root.render(<NotePad initialBindingId="binding-test" initialSurfaceMode="tile" />),
  );
  const button = (name: string) =>
    Array.from(host.querySelectorAll("button")).find((item) => item.textContent === name)!;
  expect(host.textContent).toContain("local draft");
  expect(button("载入磁盘")).toBeDefined();
  await act(async () => mocks.listeners.get("native-note-action")!({ payload: "close" }));
  expect(mocks.toast).toHaveBeenCalledWith("conflict");
  expect(
    mocks.invoke.mock.calls.some(([command]) => command === "surface_session_close_current"),
  ).toBe(false);
  await act(async () => button("载入磁盘").click());
  expect(mocks.toast).toHaveBeenCalledWith("draft clear failed");
  expect(mocks.tile.content).toBe("local draft");
  await act(async () => mocks.listeners.get("native-note-action")!({ payload: "close" }));
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "linked_save").slice(-1)[0]![1]
      .expectedRevision,
  ).toBe("r0");
  failClear = false;
  await act(async () => button("载入磁盘").click());
  expect(mocks.tile.content).toBe("external text");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => mocks.listeners.get("native-note-action")!({ payload: "edit" }));
  await act(async () => mocks.tile.onContentChange("after reload"));
  await act(async () => mocks.listeners.get("native-note-action")!({ payload: "close" }));
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "linked_save").slice(-1)[0]![1]
      .expectedRevision,
  ).toBe("r1");
});

it("桌面冲突仅在明确选择时覆盖，保留草稿可直接关闭而不覆盖原文件", async () => {
  const originalInvoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command, args, options) => {
    if (command === "linked_read_draft") return { content: "local draft", baseRevision: "r0" };
    return originalInvoke(command, args, options);
  });
  await act(async () =>
    root.render(<NotePad initialBindingId="binding-test" initialSurfaceMode="tile" />),
  );
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((item) => item.textContent === "覆盖原文件")!
      .click(),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("linked_save", {
    id: "binding-test",
    content: "local draft",
    expectedRevision: "r0",
    overwrite: true,
  });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.unmount());
  root = createRoot(host);
  mocks.invoke.mockClear();
  await act(async () =>
    root.render(<NotePad initialBindingId="binding-test" initialSurfaceMode="tile" />),
  );
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((item) => item.textContent === "保留草稿并关闭")!
      .click(),
  );
  expect(mocks.invoke.mock.calls.some(([command]) => command === "linked_save")).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "linked_write_draft",
    expect.objectContaining({ id: "binding-test", content: "local draft", baseRevision: "r0" }),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("surface_session_close_current");
});

it("macOS 设置仅保留有效的全局显示方式，切换后保留旧兼容字段", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <SettingsPanel
        config={config}
        onChange={onChange}
        onMigrateDataDir={() => {}}
        onClose={() => {}}
      />,
    ),
  );
  expect(host.textContent).not.toContain("列表磁贴渲染 Markdown");
  expect(host.textContent).not.toContain("磁贴渲染 Markdown");
  const group = host.querySelector('[role="group"][aria-label="Markdown 显示方式"]')!;
  const hybrid = Array.from(group.querySelectorAll("button")).find(
    (button) => button.textContent === "混合",
  )!;
  await act(async () => hybrid.click());
  const next = onChange.mock.calls.slice(-1)[0]![0];
  expect(next.tileRenderMarkdown).toBe(config.tileRenderMarkdown);
  expect(defaultDisplayMode(next)).toBe("hybrid");
});
