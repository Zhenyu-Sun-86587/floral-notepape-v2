// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useShortcutRecorder, type ShortcutRecorderHandle } from "./useShortcutRecorder";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
let recorder: ShortcutRecorderHandle;
let cleanup: () => Promise<void>;
async function mount() {
  const onRecord = vi.fn();
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  function Component() {
    recorder = useShortcutRecorder({ onRecord });
    return null;
  }
  await act(async () => root.render(<Component />));
  cleanup = async () => {
    await act(async () => root.unmount());
    node.remove();
  };
  return onRecord;
}
afterEach(async () => {
  await cleanup?.();
  vi.clearAllMocks();
});
it("normalizes Option dead keys, waits for restoration and commits only one repeated chord", async () => {
  let restore!: () => void;
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.invoke.mockImplementation((command: string) =>
    command === "stop_shortcut_recording"
      ? new Promise<void>((resolve) => {
          restore = resolve;
        })
      : Promise.resolve(),
  );
  const save = await mount();
  await act(async () => recorder.startRecording());
  await act(async () => {
    for (let i = 0; i < 2; i++)
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Dead", code: "KeyN", metaKey: true, altKey: true }),
      );
  });
  expect(save).not.toHaveBeenCalled();
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "stop_shortcut_recording"),
  ).toHaveLength(1);
  await act(async () => restore());
  expect(save).toHaveBeenCalledExactlyOnceWith("Alt+Meta+N");
});
it("waits for a pending native start before stopping and cancelling", async () => {
  let started!: () => void;
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.invoke.mockImplementation((command: string) =>
    command === "start_shortcut_recording"
      ? new Promise<void>((resolve) => {
          started = resolve;
        })
      : Promise.resolve(),
  );
  const save = await mount();
  await act(async () => recorder.startRecording());
  await act(async () => recorder.cancelRecording());
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["start_shortcut_recording"]);
  await act(async () => started());
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
    "start_shortcut_recording",
    "stop_shortcut_recording",
  ]);
  expect(save).not.toHaveBeenCalled();
});
