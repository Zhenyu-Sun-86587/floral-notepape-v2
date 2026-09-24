import { beforeEach, describe, expect, test, vi } from "vitest";
import { markdownImageDirectory, markdownImageRoot, resolveMarkdownImageSrc } from "./imageSrc";

describe("resolveMarkdownImageSrc", () => {
  const convertFileSrc = vi.fn((path: string) => `asset://${path}`);

  beforeEach(() => {
    convertFileSrc.mockClear();
  });

  test("resolves note image paths under the images directory", () => {
    expect(resolveMarkdownImageSrc("images/photo.png", "/notes/note-1", convertFileSrc)).toBe(
      "asset:///notes/note-1/images/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("/notes/note-1/images/photo.png");
  });

  test("normalizes Windows-style separators before resolving note images", () => {
    expect(resolveMarkdownImageSrc("images\\photo.png", "C:/notes/note-1", convertFileSrc)).toBe(
      "asset://C:/notes/note-1/images/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("C:/notes/note-1/images/photo.png");
  });

  test("resolves local relative images and rejects remote images by default", () => {
    expect(
      resolveMarkdownImageSrc("https://example.com/photo.png", "/notes/note-1", convertFileSrc),
    ).toBe("");
    expect(resolveMarkdownImageSrc("./photo.png", "/notes/note-1", convertFileSrc)).toBe(
      "asset:///notes/note-1/photo.png",
    );
  });

  test("loads HTTPS images only after the explicit setting is enabled", () => {
    expect(
      resolveMarkdownImageSrc(
        "https://example.com/a.png",
        undefined,
        convertFileSrc,
        undefined,
        true,
      ),
    ).toBe("https://example.com/a.png");
    expect(
      resolveMarkdownImageSrc(
        "http://example.com/a.png",
        undefined,
        convertFileSrc,
        undefined,
        true,
      ),
    ).toBe("");
  });

  test("allows parent assets within the bound root and blocks traversal outside it", () => {
    const base = "C:/vault/docs";
    const root = "C:/vault";
    expect(resolveMarkdownImageSrc("../assets/a.png", base, convertFileSrc, root)).toBe(
      "asset://C:/vault/assets/a.png",
    );
    expect(resolveMarkdownImageSrc("../../private/a.png", base, convertFileSrc, root)).toBe("");
    expect(resolveMarkdownImageSrc("%2e%2e/%2e%2e/private/a.png", base, convertFileSrc, root)).toBe(
      "",
    );
  });

  test("uses the longest bound directory and handles canonical Windows paths", () => {
    const path = "\\\\?\\C:\\vault\\docs\\note.md";
    expect(markdownImageDirectory(path)).toBe("C:/vault/docs");
    expect(markdownImageRoot(path, ["C:/vault", "C:/vault/docs"])).toBe("C:/vault/docs");
  });

  test("blocks unresolved paths", () => {
    expect(resolveMarkdownImageSrc("images/photo.png", undefined, convertFileSrc)).toBe("");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  test("returns an empty string for missing sources", () => {
    expect(resolveMarkdownImageSrc(undefined, "/notes/note-1", convertFileSrc)).toBe("");
  });
});
