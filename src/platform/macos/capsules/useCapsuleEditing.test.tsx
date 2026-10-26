// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useCapsuleEditing } from "./useCapsuleEditing";
import { SourceEditor, type SourceEditorHandle } from "../../../features/markdown/SourceEditor";

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
let renderEditor = false;
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
  return renderEditor ? (
    <SourceEditor
      content={api.snapshot?.content ?? ""}
      editing={api.phase === "editing" || api.phase === "leaving"}
      locked={api.inputBlocked || api.phase === "loading" || api.phase === "leaving"}
      markdown={false}
      fontSize={14}
      onChange={api.change}
      editorRef={editor}
    />
  ) : null;
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
  renderEditor = false;
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
  vi.useRealTimers();
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

it.each(["note:test", "linked:file"])(
  "%s 编辑期间关闭自动保存立即生效，重新开启后保存草稿",
  async (noteKey) => {
    key = noteKey;
    await act(async () => root.render(<Harness />));
    await begin();
    vi.useFakeTimers();
    await act(async () => api.change("保留手动草稿"));
    await act(async () =>
      mocks.listeners.get("config-changed")!({
        payload: {
          inlineEditing: true,
          noteSurfaceAutoSave: false,
          externalFileAutoSave: false,
        },
      }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(
      mocks.invoke.mock.calls.some(([command]) =>
        ["notes_update", "linked_save"].includes(command),
      ),
    ).toBe(false);
    await act(async () => api.finish(undefined, true));
    expect(api.phase).toBe("editing");
    await act(async () =>
      mocks.listeners.get("config-changed")!({
        payload: {
          inlineEditing: true,
          noteSurfaceAutoSave: true,
          externalFileAutoSave: true,
        },
      }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === (noteKey.startsWith("note:") ? "notes_update" : "linked_save"),
      ),
    ).toBe(true);
    expect(api.status).toBe("clean");
  },
);

it("自动保存遇到组合输入会等候，候选结束且无后续键入也会保存", async () => {
  await begin();
  vi.useFakeTimers();
  editor.current = { composing: true } as SourceEditorHandle;
  await act(async () => api.change("中文候选"));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(mocks.invoke.mock.calls.some(([command]) => command === "notes_update")).toBe(false);
  editor.current = { composing: false } as SourceEditorHandle;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(mocks.invoke).toHaveBeenCalledWith(
    "notes_update",
    expect.objectContaining({ request: expect.objectContaining({ content: "中文候选" }) }),
  );
  expect(api.status).toBe("clean");
});

it("重新加载清理草稿失败时保留原正文和冲突版本，重试加载成功才切换版本", async () => {
  key = "linked:file";
  await act(async () => root.render(<Harness />));
  await begin();
  await act(async () => api.change("旧本地草稿"));
  mocks.message.mockResolvedValue("重新加载");
  const fallback = mocks.invoke.getMockImplementation()!;
  let cleanupFails = true;
  mocks.invoke.mockImplementation((command, args) => {
    if (command === "linked_read")
      return Promise.resolve({
        binding: { id: "file", path: "/tmp/file.md" },
        content: "外部新版本",
        revision: "r-new",
        imageRoot: "/tmp",
      });
    if (command === "linked_write_draft" && args.content === null && cleanupFails)
      return Promise.reject(new Error("草稿清理失败"));
    if (command === "linked_save" && args.expectedRevision !== "r-new")
      return Promise.reject(new Error("外部文件冲突"));
    return fallback(command, args);
  });
  await act(async () => api.reload());
  expect(api.error).toContain("草稿清理失败");
  expect(api.snapshot?.content).toBe("旧本地草稿");
  await act(async () => api.save());
  expect(mocks.invoke).toHaveBeenCalledWith(
    "linked_save",
    expect.objectContaining({ content: "旧本地草稿", expectedRevision: "r1" }),
  );
  expect(api.error).toContain("外部文件冲突");
  expect(api.snapshot?.content).toBe("旧本地草稿");
  cleanupFails = false;
  await act(async () => api.reload());
  expect(api.snapshot?.content).toBe("外部新版本");
  expect(api.status).toBe("clean");
  expect(api.error).toBe("");
  await act(async () => api.change("新版本上的修改"));
  await act(async () => api.save());
  expect(mocks.invoke).toHaveBeenCalledWith(
    "linked_save",
    expect.objectContaining({ content: "新版本上的修改", expectedRevision: "r-new" }),
  );
  expect(api.status).toBe("clean");
});

it("等待图片时取消退出，图片完成后不重新冻结输入或报告过期结果", async () => {
  await begin();
  const images = deferred<void>();
  pendingImages.current = images.promise;
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "cancelled" } });
  });
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => {
    images.resolve();
    await images.promise;
  });
  expect(api.inputBlocked).toBe(false);
  expect(mocks.invoke.mock.calls.some(([c]) => c === "update_install_prepare_report")).toBe(false);
  await act(async () => api.change("取消后继续输入"));
  expect(api.snapshot?.content).toBe("取消后继续输入");
});

it("旧准备请求等待图片期间取消，新请求仍可正常保存和解冻", async () => {
  await begin();
  const images = deferred<void>();
  pendingImages.current = images.promise;
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "old" } });
  });
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => {
    api.change("新请求的草稿");
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "new" } });
    images.resolve();
    await images.promise;
  });
  const reports = mocks.invoke.mock.calls.filter(([c]) => c === "update_install_prepare_report");
  expect(reports).toHaveLength(1);
  expect(reports[0][1]).toMatchObject({ requestId: "new", status: "ready" });
  expect(api.inputBlocked).toBe(true);
  expect(api.status).toBe("clean");
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => api.change("再次继续输入"));
  expect(api.inputBlocked).toBe(false);
  expect(api.snapshot?.content).toBe("再次继续输入");
});

it("取消退出后等待中的图片失败，不显示过期准备错误", async () => {
  await begin();
  const images = deferred<void>();
  pendingImages.current = images.promise;
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "cancelled" } });
  });
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => {
    images.reject(new Error("过期图片操作失败"));
    await images.promise.catch(() => undefined);
  });
  expect(api.inputBlocked).toBe(false);
  expect(api.error).toBe("");
  expect(mocks.invoke.mock.calls.some(([c]) => c === "update_install_prepare_report")).toBe(false);
});

it("载入编辑会话期间取消退出，载入完成后可以继续输入", async () => {
  const loaded = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "notes_get" ? loaded.promise : fallback(command, args),
  );
  await begin();
  expect(api.phase).toBe("loading");
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "cancelled" } });
  });
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => {
    loaded.resolve({ ...note });
    await loaded.promise;
  });
  expect(api.inputBlocked).toBe(false);
  expect(api.phase).toBe("editing");
  expect(mocks.invoke.mock.calls.some(([c]) => c === "update_install_prepare_report")).toBe(false);
  await act(async () => api.change("载入后继续输入"));
  expect(api.snapshot?.content).toBe("载入后继续输入");
});

it("等待已有保存期间取消退出，不再保存取消后输入的内容或报告过期结果", async () => {
  await begin();
  const saved = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command, args) =>
    command === "notes_update" ? saved.promise : fallback(command, args),
  );
  let saving!: Promise<void>;
  await act(async () => {
    api.change("已提交保存的草稿");
    saving = api.save();
  });
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "cancelled" } });
  });
  expect(api.inputBlocked).toBe(true);
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  await act(async () => api.change("取消后新输入"));
  await act(async () => {
    saved.resolve({ ...note, content: "已提交保存的草稿", updatedAt: "v2" });
    await saving;
  });
  expect(api.inputBlocked).toBe(false);
  expect(api.snapshot?.content).toBe("取消后新输入");
  expect(api.status).toBe("dirty");
  expect(mocks.invoke.mock.calls.filter(([c]) => c === "notes_update")).toHaveLength(1);
  expect(mocks.invoke.mock.calls.some(([c]) => c === "update_install_prepare_report")).toBe(false);
});

it.each(["note:test", "linked:file"])(
  "%s 的旧刷新结果不能覆盖较新的正文和版本",
  async (selectedKey) => {
    key = selectedKey;
    await act(async () => root.render(<Harness />));
    await begin();
    const stale = deferred<any>();
    const fallback = mocks.invoke.getMockImplementation()!;
    const linked = key.startsWith("linked:");
    const command = linked ? "linked_read" : "notes_get";
    const target = linked ? api.snapshot!.target : note;
    let reads = 0;
    mocks.invoke.mockImplementation((cmd, args) => {
      if (cmd === command)
        return ++reads === 1
          ? stale.promise
          : Promise.resolve({ ...target, content: "newest", updatedAt: "v3", revision: "r3" });
      return fallback(cmd, args);
    });
    const changed = () =>
      mocks.listeners.get(linked ? "linked-content-changed" : "notes-changed")!({
        payload: { bindingId: "file" },
      });
    await act(async () => changed());
    await act(async () => changed());
    expect(api.snapshot?.content).toBe("newest");
    await act(async () =>
      stale.resolve({ ...target, content: "stale", updatedAt: "v2", revision: "r2" }),
    );
    expect(api.snapshot?.content).toBe("newest");
    await act(async () => {
      api.change("edited newest");
      await api.save();
    });
    const saved = mocks.invoke.mock.calls.find(
      ([cmd]) => cmd === (linked ? "linked_save" : "notes_update"),
    )![1];
    expect(linked ? saved.expectedRevision : saved.expectedUpdatedAt).toBe(linked ? "r3" : "v3");
  },
);

it.each([false, true])("重新加载期间禁止输入，完成或失败后恢复会话（失败：%s）", async (failed) => {
  renderEditor = true;
  await act(async () => root.render(<Harness />));
  await begin();
  const read = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.message.mockResolvedValue("重新加载");
  mocks.invoke.mockImplementation((cmd, args) =>
    cmd === "notes_get" ? read.promise : fallback(cmd, args),
  );
  let reload!: Promise<void>;
  await act(async () => {
    reload = api.reload();
  });
  const view = editor.current!.view!;
  expect(view.state.readOnly).toBe(true);
  await act(async () => {
    if (failed) read.reject(new Error("read failed"));
    else read.resolve({ ...note, content: "external", updatedAt: "v2" });
    await reload;
  });
  expect(view.state.readOnly).toBe(false);
  await act(async () =>
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " new input" },
      userEvent: "input",
    }),
  );
  expect(api.snapshot?.content).toBe((failed ? "old" : "external") + " new input");
});

it("重新加载期间的离开请求等待读取完成；重复重新加载不会重复读盘", async () => {
  await begin();
  const read = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.message.mockResolvedValue("重新加载");
  mocks.invoke.mockImplementation((cmd, args) =>
    cmd === "notes_get" ? read.promise : fallback(cmd, args),
  );
  let reload!: Promise<void>;
  await act(async () => {
    reload = api.reload();
  });
  let leaving!: Promise<void>;
  await act(async () => {
    void api.reload();
    leaving = api.finish({ key, generation: 1, requestId: 4 });
  });
  expect(mocks.message).toHaveBeenCalledTimes(1);
  expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === "surface_capsule_finish_edit")).toBe(
    false,
  );
  await act(async () => {
    read.resolve({ ...note, content: "reloaded", updatedAt: "v2" });
    await reload;
    await leaving;
  });
  expect(api.phase).toBe("reading");
  expect(occupied.current).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("surface_capsule_finish_edit", {
    key,
    generation: 1,
    requestId: 4,
    ready: true,
  });
  expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === "notes_update")).toBe(false);
});

it("重新加载取代在途刷新；旧刷新迟到时不能恢复旧正文", async () => {
  await begin();
  const old = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  let reads = 0;
  mocks.message.mockResolvedValue("重新加载");
  mocks.invoke.mockImplementation((cmd, args) => {
    if (cmd === "notes_get")
      return ++reads === 1
        ? old.promise
        : Promise.resolve({ ...note, content: "reloaded", updatedAt: "v3" });
    return fallback(cmd, args);
  });
  await act(async () => mocks.listeners.get("notes-changed")!({ payload: null }));
  await act(async () => api.reload());
  await act(async () => old.resolve({ ...note, content: "stale", updatedAt: "v2" }));
  expect(api.snapshot?.content).toBe("reloaded");
});

it("重新加载期间取消退出不会提前解除输入冻结，准备保存也等待读取完成", async () => {
  await begin();
  const read = deferred<typeof note>();
  const fallback = mocks.invoke.getMockImplementation()!;
  mocks.message.mockResolvedValue("重新加载");
  mocks.invoke.mockImplementation((cmd, args) =>
    cmd === "notes_get" ? read.promise : fallback(cmd, args),
  );
  let reload!: Promise<void>;
  await act(async () => {
    reload = api.reload();
  });
  await act(async () => {
    mocks.listeners.get("app://exit-freeze")!({ payload: true });
    mocks.listeners.get("update://prepare-install")!({ payload: { requestId: "reload-exit" } });
  });
  expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === "update_install_prepare_report")).toBe(
    false,
  );
  await act(async () => mocks.listeners.get("app://exit-freeze")!({ payload: false }));
  expect(api.inputBlocked).toBe(true);
  await act(async () => {
    read.resolve({ ...note, content: "reloaded", updatedAt: "v2" });
    await reload;
  });
  expect(api.inputBlocked).toBe(false);
  expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === "update_install_prepare_report")).toBe(
    false,
  );
  await act(async () => api.change("new input"));
  expect(api.snapshot?.content).toBe("new input");
});
