import { afterEach, describe, expect, it, vi } from "vitest";
import { HoverIntent } from "./HoverIntent";
afterEach(() => {
  vi.useRealTimers();
});
describe("Mac capsule hover intent", () => {
  it("does not read/render a preview when the pointer only crosses a capsule", async () => {
    vi.useFakeTimers();
    const present = vi.fn();
    const intent = new HoverIntent();
    intent.enter(() => Promise.resolve(1), present);
    await vi.advanceTimersByTimeAsync(200);
    intent.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(present).not.toHaveBeenCalled();
  });
  it("ignores a late native generation after entering another capsule", async () => {
    vi.useFakeTimers();
    let resolve!: (value: number) => void;
    const present = vi.fn();
    const intent = new HoverIntent();
    intent.enter(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
      present,
    );
    await vi.advanceTimersByTimeAsync(280);
    intent.enter(() => Promise.resolve(2), present);
    resolve(1);
    await vi.advanceTimersByTimeAsync(280);
    expect(present.mock.calls).toEqual([[2]]);
  });
  it("cancels even after the dwell elapsed while the native reply is pending", async () => {
    vi.useFakeTimers();
    let resolve!: (value: number) => void;
    const present = vi.fn();
    const intent = new HoverIntent();
    intent.enter(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
      present,
    );
    await vi.advanceTimersByTimeAsync(280);
    intent.cancel();
    resolve(9);
    await vi.advanceTimersByTimeAsync(1);
    expect(present).not.toHaveBeenCalled();
  });
});
