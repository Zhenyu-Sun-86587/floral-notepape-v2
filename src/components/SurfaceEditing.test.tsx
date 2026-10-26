// @vitest-environment jsdom
import { act, useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotePad } from "./NotePad";
import { SettingsPanel } from "./SettingsPanel";
import { syncLanguage } from "../locales";
import { defaultDisplayMode } from "../features/markdown/displayMode";
import type { AppConfig } from "../features/settings/types";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), tile: null as any }));
// Exercise the macOS host on every CI platform, including its production shell hook.
vi.mock("#platform-note-shell", async () => vi.importActual("../platform/macos/noteShell"));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
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
  resolveAppearance: () => ({ radius: 12 }),
}));
vi.mock("#platform-settings", () => ({ PlatformSettings: () => null }));
vi.mock("./AppearanceSection", () => ({ AppearanceSection: () => null }));
vi.mock("./Toast", () => ({ showToast: mocks.toast }));
vi.mock("./Tile", () => ({
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
    return <div data-test-tile>{props.content}</div>;
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
it("绑定文件便签粘贴图片使用外部文件接口，不预先保存正文", async () => {
  await act(async () =>
    root.render(
      <NotePad initialBindingId="binding-test" initialSurfaceMode="tile" initialAutoSave={false} />,
    ),
  );
  expect(host.textContent).toContain("external text");
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

it.each([
  [
    "en-US",
    "Default display mode (desktop notes and capsules)",
    "Hybrid",
    "Display mode: Preview. Click to switch to Source",
  ],
  ["zh-HK", "預設顯示方式（桌面便箋與膠囊）", "混合", "顯示方式：預覽，按一下切換為原始碼"],
])("%s 的显示设置和原生模式按钮使用当前语言", async (locale, heading, label, nativeLabel) => {
  await syncLanguage(locale);
  await act(async () =>
    root.render(
      <SettingsPanel
        config={config}
        onChange={() => {}}
        onMigrateDataDir={() => {}}
        onClose={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain(heading);
  expect(host.querySelector(".display-mode-control")?.textContent).toContain(label);
  await act(async () =>
    root.render(
      <NotePad initialBindingId="binding-test" initialSurfaceMode="tile" initialAutoSave={false} />,
    ),
  );
  const native = mocks.invoke.mock.calls
    .filter(([cmd]) => cmd === "surface_native_note_state")
    .slice(-1)[0]!;
  expect(native[1].state.displayModeLabel).toBe(nativeLabel);
});
