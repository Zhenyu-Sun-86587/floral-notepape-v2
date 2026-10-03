import { describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { writeLinkedDraft } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("external recovery drafts", () => {
  test("a pending edit finishes before its newer edit or save-completion clear", async () => {
    let finish!: () => void;
    const native = vi.mocked(invoke);
    native.mockReset();
    native.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    native.mockResolvedValue(undefined);
    const first = writeLinkedDraft("ordered", "old", "revision");
    const second = writeLinkedDraft("ordered", "new", "revision");
    const clear = writeLinkedDraft("ordered", null, "saved-revision");
    await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(1));
    finish();
    await Promise.all([first, second, clear]);
    for (const [index, content] of ["old", "new", null].entries()) {
      expect(native).toHaveBeenNthCalledWith(
        index + 1,
        "linked_write_draft",
        expect.objectContaining({ content }),
      );
    }
  });

  test("a failed draft reports failure without blocking the next recovery write", async () => {
    const native = vi.mocked(invoke);
    native.mockReset();
    native.mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
    const failed = writeLinkedDraft("retry", "old", "revision");
    const retry = writeLinkedDraft("retry", "new", "revision");
    await expect(failed).rejects.toThrow("disk unavailable");
    await expect(retry).resolves.toBeUndefined();
    expect(native).toHaveBeenCalledTimes(2);
  });
});
