// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CapsulePreview } from "./Preview";
import type { CapsuleEntry } from "./types";
import fixture from "../../../../Docs/fixtures/mac-markdown-acceptance.md?raw";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../../features/markdown/MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <pre data-mermaid>{source}</pre>,
}));
let cleanup: (() => Promise<void>) | undefined;
async function mount(entry: CapsuleEntry, mode: "preview" | "hybrid" = "preview") {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "surface_capsule_preview_state") return { generation: 1, side: "right", entry };
    if (command === "surface_session_get") return { key: entry.key, displayMode: mode };
    if (command === "surface_capsule_material") return { kind: "solid", opacity: 1 };
    if (command === "images_get_base_dir") return "/test-data";
    if (command === "config_get") return { surfaceDisplayMode: mode, inlineEditing: false };
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  await act(async () => root.render(<CapsulePreview />));
  return host;
}
afterEach(async () => {
  await cleanup?.();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("混合胶囊使用内部目录渲染粘贴图片，兼容原生 null 字段", async () => {
  const mode = "hybrid" as const;
  const host = await mount(
    {
      key: "note:test",
      title: "图片",
      colorKey: 0,
      expanded: false,
      imageBaseDir: null,
      imageRootDir: null,
      preview: fixture + "\n![粘贴截图](images/note-id/screenshot.png)",
    },
    mode,
  );
  expect(host.querySelector('.preview-body img[alt="粘贴截图"]')?.getAttribute("src")).toBe(
    "asset://localhost/test-data/images/note-id/screenshot.png",
  );
  expect(host.querySelector("h1")?.textContent).toBe("# Markdown 综合验收");
  expect(host.querySelector("strong")?.textContent).toBe("**粗体**");
  expect(host.textContent).toContain("title: Markdown 综合验收");
  expect(host.textContent).toContain("[^qa]");
  expect(host.textContent).toContain("***粗斜体***");
  expect(host.textContent).toContain("```ts");
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(9);
  expect(host.querySelectorAll("table")).toHaveLength(1);
  expect(host.querySelectorAll(".katex")).toHaveLength(3);
  expect(host.querySelectorAll("[data-mermaid]")).toHaveLength(2);
  expect(host.querySelectorAll('[role="note"]')).toHaveLength(5);
  expect(host.querySelector('table img[alt="表格引用图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/test-data/images/markdown-qa.svg",
  );
  expect(host.querySelector(".cm-editor,[contenteditable=true]")).toBeNull();
});

it("keeps linked images inside their bound root without using the internal note directory", async () => {
  const host = await mount({
    key: "linked:test",
    title: "外部图片",
    colorKey: 0,
    expanded: false,
    imageBaseDir: "/vault/docs",
    imageRootDir: "/vault",
    preview: "![合法图片](../assets/photo.png)\n\n![越界图片](../../private/photo.png)",
  });
  expect(host.querySelector('img[alt="合法图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/vault/assets/photo.png",
  );
  expect(host.querySelector('img[alt="越界图片"]')).toBeNull();
  expect(host.textContent).toContain("图片路径不可用");
});

it("hybrid task checkbox saves through the capsule read path and keeps the other task intact", async () => {
  const entry = {
    key: "note:test",
    title: "任务",
    colorKey: 0,
    expanded: false,
    preview: "- [ ] 测试任务\n- [x] 已完成任务",
  };
  const host = await mount(entry, "hybrid");
  const previous = mocks.invoke.getMockImplementation()!;
  let saved = entry.preview;
  mocks.invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command === "notes_get")
      return { id: "test", title: "任务", category: "", content: saved, updatedAt: "v1" };
    if (command === "notes_update") {
      saved = (args as { request: { content: string } }).request.content;
      return { id: "test", title: "任务", category: "", content: saved, updatedAt: "v2" };
    }
    if (command === "surface_capsule_entry") return { ...entry, preview: saved };
    return previous(command, args);
  });
  const tasks = host.querySelectorAll<HTMLInputElement>('.preview-body input[type="checkbox"]');
  expect([...tasks].map((task) => task.checked)).toEqual([false, true]);
  await act(async () => tasks[0].click());
  expect(saved).toBe("- [x] 测试任务\n- [x] 已完成任务");
  expect(mocks.invoke).toHaveBeenCalledWith("notes_update", {
    id: "test",
    expectedUpdatedAt: "v1",
    request: { title: "任务", category: "", content: saved },
  });
  expect(mocks.invoke.mock.calls.some(([command]) => command === "surface_restore_stored")).toBe(
    false,
  );
});

it("混合胶囊勾选 CRLF 外部文件任务，使用 LF 坐标和版本保存", async () => {
  const mode = "hybrid" as const;
  const original = "# 换行 😀\r\n\r\n- [ ] 第一项\r\n- [ ] 第二项\r\n末尾";
  const entry = {
    key: "linked:test",
    title: "换行",
    colorKey: 0,
    expanded: false,
    preview: original,
  };
  const host = await mount(entry, mode);
  const previous = mocks.invoke.getMockImplementation()!;
  let saved: string | undefined;
  mocks.invoke.mockImplementation(async (command: string, args: any) => {
    if (command === "linked_read")
      return {
        binding: { id: "test", path: "/vault/file.md" },
        content: original,
        revision: "r1",
        imageRoot: "/vault",
      };
    if (command === "linked_save") {
      saved = args.content;
      return "r2";
    }
    if (command === "surface_capsule_entry") return { ...entry, preview: saved ?? original };
    return previous(command, args);
  });
  const tasks = host.querySelectorAll<HTMLInputElement>('.preview-body input[type="checkbox"]');
  expect(tasks).toHaveLength(2);
  await act(async () => tasks[1].click());
  expect(saved).toBe(original.replace(/\r\n/g, "\n").replace("[ ] 第二项", "[x] 第二项"));
  expect(mocks.invoke).toHaveBeenCalledWith(
    "linked_save",
    expect.objectContaining({ expectedRevision: "r1", overwrite: false }),
  );
});
