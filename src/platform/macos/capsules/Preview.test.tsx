// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CapsulePreview } from "./Preview";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, callback);
    return Promise.resolve(vi.fn());
  }),
}));
vi.mock("../../../features/markdown/MarkdownPreview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <p data-testid="markdown">{content}</p>,
}));
let cleanup: () => Promise<void>;
const preview = (generation: number, title = "Glass note") => ({
  generation,
  side: "right",
  entry: { key: "note:test", title, preview: "# Markdown", colorKey: 0, expanded: false },
});
async function mount() {
  mocks.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === "surface_capsule_material"
        ? { kind: "glass", opacity: 0.25 }
        : command === "surface_capsule_preview_state"
          ? preview(1)
          : undefined,
    ),
  );
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<CapsulePreview />));
  cleanup = async () => {
    await act(async () => root.unmount());
    node.remove();
  };
  return node;
}
afterEach(async () => {
  await cleanup?.();
  mocks.listeners.clear();
  vi.clearAllMocks();
});
it("presents committed Markdown without waiting for a hidden WebView animation frame", async () => {
  const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  const node = await mount();
  expect(node.querySelector('[data-testid="markdown"]')?.textContent).toBe("# Markdown");
  expect(mocks.invoke).toHaveBeenCalledWith("surface_capsule_present", { generation: 1 });
  expect(frame).not.toHaveBeenCalled();
  frame.mockRestore();
});
it("retains one hidden DOM, ignores late sessions and skips hidden note refreshes", async () => {
  const node = await mount();
  const body = node.querySelector('[data-testid="markdown"]');
  await act(async () => mocks.listeners.get("capsule-preview-hidden")?.({ payload: 2 }));
  expect(node.querySelector("article")?.getAttribute("data-visible")).toBe("false");
  expect(node.querySelector('[data-testid="markdown"]')).toBe(body);
  await act(async () => {
    mocks.listeners.get("notes-changed")?.({ payload: null });
    mocks.listeners.get("capsule-preview-changed")?.({ payload: preview(1, "stale") });
  });
  expect(mocks.invoke.mock.calls.some(([command]) => command === "surface_capsule_entry")).toBe(
    false,
  );
  expect(node.textContent).not.toContain("stale");
  await act(async () =>
    mocks.listeners.get("capsule-preview-changed")?.({ payload: preview(3, "latest") }),
  );
  expect(node.querySelector("article")?.getAttribute("data-visible")).toBe("true");
  expect(mocks.invoke).toHaveBeenCalledWith("surface_capsule_present", { generation: 3 });
});
