// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CapsuleRail } from "./Rail";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }));
vi.mock("./useMaterial", () => ({ useMaterial: () => true }));
let cleanup: () => Promise<void>;
async function mount() {
  vi.useFakeTimers();
  mocks.invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === "surface_capsule_group"
        ? {
            revision: 1,
            side: "right",
            slotCss: 48,
            gripCss: 0,
            members: ["a", "b"].map((key) => ({ key, title: key, expanded: false, colorKey: 0 })),
          }
        : command === "surface_capsule_hover"
          ? 7
          : undefined,
    ),
  );
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<CapsuleRail />));
  cleanup = async () => {
    await act(async () => root.unmount());
    node.remove();
  };
  return Array.from(node.querySelectorAll("button"));
}
async function enter(button: HTMLButtonElement) {
  await act(async () => button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
}
afterEach(async () => {
  await cleanup?.();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("pointer plus focus keeps the first hover generation and presents once", async () => {
  const [a] = await mount();
  await enter(a);
  await act(async () => a.focus());
  await act(async () => vi.advanceTimersByTime(280));
  expect(
    mocks.invoke.mock.calls.filter(([cmd, args]) => cmd === "surface_capsule_hover" && args.inside),
  ).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenCalledWith(
    "surface_capsule_preview",
    expect.objectContaining({ key: "a", generation: 7 }),
  );
});
it("blurring the former focused capsule cannot cancel a newer pointer hover", async () => {
  const [a, b] = await mount();
  await act(async () => a.focus());
  await enter(b);
  await act(async () => a.blur());
  await act(async () => vi.advanceTimersByTime(280));
  const shown = mocks.invoke.mock.calls.filter(([cmd]) => cmd === "surface_capsule_preview");
  expect(shown).toHaveLength(1);
  expect(shown[0][1]).toMatchObject({ key: "b", generation: 7 });
});
