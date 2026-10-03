// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WidgetSettings } from "./WidgetSettings";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

it("assigns a same-title external note by stable ID to only the chosen slot", async () => {
  const internal = "note:40a88de0-7176-4be4-b4ea-c9155cae5ce4";
  const external = "linked:54d86ff1-4b0f-4890-a7f8-f083e678d659";
  const displays = Array.from({ length: 4 }, (_, index) => ({
    noteKey: index === 0 ? internal : null,
    textSize: "standard",
  }));
  const status = {
    available: true,
    selected: [internal, external],
    displays,
    choices: [
      { key: internal, title: "Inbox" },
      { key: external, title: "Inbox" },
      { key: "linked:unshared", title: "Private" },
    ],
  };
  mocks.invoke.mockImplementation(async (command, args) =>
    command === "macos_widgets_status"
      ? status
      : {
          ...status,
          displays: displays.map((display, index) =>
            index === args.slot - 1 ? args.display : display,
          ),
        },
  );
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(<WidgetSettings />));
    const select = node.querySelector<HTMLSelectElement>('select[aria-label="便签 2 内容"]')!;
    expect(Array.from(select.options).some((option) => option.value === "linked:unshared")).toBe(
      false,
    );
    await act(async () => {
      select.value = external;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("macos_widgets_configure", {
      slot: 2,
      display: { noteKey: external, textSize: "standard" },
    });
    expect(node.querySelector<HTMLSelectElement>('select[aria-label="便签 1 内容"]')!.value).toBe(
      internal,
    );
    expect(select.value).toBe(external);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.clearAllMocks();
  }
});
