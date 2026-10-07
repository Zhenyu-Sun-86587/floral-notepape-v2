// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useCapsuleEditing } from "./useCapsuleEditing";
import type { SourceEditorHandle } from "../../../features/markdown/SourceEditor";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  message: vi.fn(),
  listeners: new Map<string, (e: { payload: any }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, fn: (e: { payload: any }) => void) => {
    mocks.listeners.set(name, fn);
    return Promise.resolve(() => mocks.listeners.delete(name));
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message }));
const note = { id: "test", content: "old", title: "Title", category: "Inbox", updatedAt: "v1" };
const occupied = { current: false };
const editor = { current: null as SourceEditorHandle | null };
const pendingImages = { current: null as Promise<void> | null };
let api: ReturnType<typeof useCapsuleEditing>;
let root: Root;
let host: HTMLElement;
let key: string;
let autoSave: boolean;
function Harness() {
  api = useCapsuleEditing(
    {
      generation: 1,
      side: "left",
      entry: { key, title: "Title", preview: "stale preview", colorKey: 0, expanded: false },
    },
    occupied,
    editor,
    pendingImages,
  );
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  occupied.current = false;
  editor.current = null;
  pendingImages.current = null;
  key = "note:test";
  autoSave = true;
  mocks.message.mockResolvedValue("保存");
  mocks.invoke.mockImplementation(async (command: string, args: any) => {
    switch (command) {
      case "config_get":
        return {
          inlineEditing: true,
          noteSurfaceAutoSave: autoSave,
          externalFileAutoSave: autoSave,
        };
      case "notes_get":
        return { ...note };
      case "notes_update":
        return { ...note, ...args.request, updatedAt: "v2" };
      case "surface_capsule_finish_edit":
        return args.ready;
      case "linked_read":
        return {
          binding: { id: "file", path: "/tmp/file.md" },
          content: "old",
          revision: "r1",
          imageRoot: "/tmp",
        };
      case "linked_save":
        return "r2";
      default:
        return undefined;
    }
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  mocks.listeners.clear();
});
async function begin() {
  await act(async () => {
    api.begin();
  });
}
it("先获取原生占用，再加载带版本的正式正文", async () => {
  await begin();
  expect(api.snapshot?.content).toBe("old");
  expect(api.phase).toBe("editing");
  expect(occupied.current).toBe(true);
  const calls = mocks.invoke.mock.calls.map(([command]) => command);
  expect(calls.indexOf("surface_capsule_begin_edit")).toBeLessThan(calls.indexOf("notes_get"));
  await act(async () => {
    api.change("edited");
    await api.save();
  });
  expect(mocks.invoke).toHaveBeenCalledWith("notes_update", {
    id: "test",
    request: { title: "Title", category: "Inbox", content: "edited" },
    expectedUpdatedAt: "v1",
  });
});
it("连续保存串行使用新版本，旧保存不能清除新输入", async () => {
  await begin();
  const first = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  let saves = 0;
  mocks.invoke.mockImplementation((command, args) =>
    command === "notes_update" && ++saves === 1 ? first.promise : fallback(command, args),
  );
  let one!: Promise<void>;
  let two!: Promise<void>;
  await act(async () => {
    api.change("first");
    one = api.save();
  });
  await act(async () => {
    api.change("second");
    two = api.save();
  });
  expect(mocks.invoke.mock.calls.filter(([c]) => c === "notes_update")).toHaveLength(1);
  await act(async () => {
    first.resolve({ ...note, content: "first", updatedAt: "v2" });
    await one;
    await two;
  });
  const calls = mocks.invoke.mock.calls.filter(([c]) => c === "notes_update");
  expect(calls[1][1].expectedUpdatedAt).toBe("v2");
  expect(calls[1][1].request.content).toBe("second");
  expect(api.snapshot?.content).toBe("second");
  expect(api.status).toBe("clean");
});
it("保存失败保留会话并拒绝原生离开，重试成功后才释放", async () => {
  await begin();
  await act(async () => api.change("draft"));
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "notes_update" ? Promise.reject(new Error("冲突")) : fallback(command, args),
  );
  await act(async () => api.finish({ key, generation: 1, requestId: 9 }));
  expect(api.snapshot?.content).toBe("draft");
  expect(api.phase).toBe("editing");
  expect(occupied.current).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith("surface_capsule_finish_edit", {
    key,
    generation: 1,
    requestId: 9,
    ready: false,
  });
  mocks.invoke.mockImplementation(fallback);
  await act(async () => api.finish());
  expect(occupied.current).toBe(false);
  expect(api.phase).toBe("reading");
});
it("关闭自动保存时失焦保留草稿，显式关闭允许取消", async () => {
  autoSave = false;
  await begin();
  await act(async () => api.change("draft"));
  await act(async () => api.finish(undefined, true));
  expect(mocks.message).not.toHaveBeenCalled();
  mocks.message.mockResolvedValue("取消");
  await act(async () => api.finish({ key, generation: 1, requestId: 2 }));
  expect(api.snapshot?.content).toBe("draft");
  expect(occupied.current).toBe(true);
});
it("外部文件先保留草稿，保存完成只清除已保存版本", async () => {
  key = "linked:file";
  await act(async () => root.render(<Harness />));
  await begin();
  const first = deferred<string>();
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "linked_save" ? first.promise : fallback(command, args),
  );
  let save!: Promise<void>;
  await act(async () => {
    api.change("first");
    save = api.save();
  });
  await act(async () => api.change("second"));
  await act(async () => {
    first.resolve("r2");
    await save;
  });
  const drafts = mocks.invoke.mock.calls.filter(([c]) => c === "linked_write_draft");
  expect(drafts[drafts.length - 1]?.[1]).toMatchObject({ content: "second", baseRevision: "r2" });
  expect(api.status).toBe("dirty");
});
it("退出等待图片操作，保存失败向既有准备协议报告失败", async () => {
  await begin();
  const images = deferred<void>();
  pendingImages.current = images.promise;
  await act(async () => {
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "exit" } });
  });
  expect(mocks.invoke.mock.calls.some(([c]) => c === "update_install_prepare_report")).toBe(false);
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "notes_update" ? Promise.reject(new Error("写入失败")) : fallback(command, args),
  );
  await act(async () => {
    api.change("with image");
    images.resolve();
    await images.promise;
  });
  expect(mocks.invoke).toHaveBeenCalledWith(
    "update_install_prepare_report",
    expect.objectContaining({ requestId: "exit", status: "failed" }),
  );
  expect(api.snapshot?.content).toBe("with image");
});

it("加载失败释放原生加载占用，正文不进入可写状态", async () => {
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "notes_get" ? Promise.reject(new Error("文件不可用")) : fallback(command, args),
  );
  await begin();
  expect(api.phase).toBe("reading");
  expect(api.snapshot).toBeNull();
  expect(occupied.current).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("surface_capsule_abort_edit", { key, generation: 1 });
});
it("退出取消后恢复输入，脏草稿不会被外部通知覆盖", async () => {
  await begin();
  await act(async () => api.change("保留草稿"));
  await act(async () => mocks.listeners.get("notes-changed")!({ payload: null }));
  expect(api.snapshot?.content).toBe("保留草稿");
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "quit" } });
  });
  expect(api.inputBlocked).toBe(true);
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => api.change("继续输入"));
  expect(api.snapshot?.content).toBe("继续输入");
});
it("设置关闭后不加载正文，释放占用；设置广播即时更新入口", async () => {
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "config_get" ? Promise.resolve({ inlineEditing: false }) : fallback(command, args),
  );
  await begin();
  expect(api.phase).toBe("reading");
  expect(occupied.current).toBe(false);
  expect(mocks.invoke).not.toHaveBeenCalledWith("notes_get", expect.anything());
  expect(mocks.invoke).toHaveBeenCalledWith("surface_capsule_abort_edit", {
    key: "note:test",
    generation: 1,
  });
  await act(async () =>
    mocks.listeners.get("config-changed")?.({ payload: { inlineEditing: true } }),
  );
  expect(api.config?.inlineEditing).toBe(true);
});
