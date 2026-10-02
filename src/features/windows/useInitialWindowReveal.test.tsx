// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useInitialWindowReveal } from "./useInitialWindowReveal";

let root: Root;
let host: HTMLDivElement;
const reveal = vi.fn<(cancelled: () => boolean) => Promise<void>>();
const onError = vi.fn();
function Harness({ ready = true, standby = false }) {
  useInitialWindowReveal(ready, standby, reveal, onError);
  return null;
}
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  reveal.mockResolvedValue();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 模拟隐藏 WebKit：任何动画帧请求均不会执行回调。
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
test("reveals a hidden initialized window without animation frames and only once", async () => {
  await act(async () => root.render(<Harness />));
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness />));
  expect(reveal).toHaveBeenCalledTimes(1);
});
test("waits for initialization and leaves standby windows hidden", async () => {
  await act(async () => root.render(<Harness ready={false} />));
  expect(reveal).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness standby />));
  expect(reveal).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness />));
  expect(reveal).toHaveBeenCalledTimes(1);
});
test("cancels pending initialization work when unmounted", async () => {
  let finish!: () => void;
  reveal.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<Harness />));
  const cancelled = reveal.mock.calls[0][0];
  expect(cancelled()).toBe(false);
  await act(async () => root.unmount());
  expect(cancelled()).toBe(true);
  await act(async () => finish());
  // 使用新的空 root，供清理钩子执行卸载。
  root = createRoot(host);
});
test("reports native reveal failures instead of swallowing them", async () => {
  const error = new Error("native show failed");
  reveal.mockRejectedValue(error);
  await act(async () => root.render(<Harness />));
  expect(onError).toHaveBeenCalledWith(error);
});
