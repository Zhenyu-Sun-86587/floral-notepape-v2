import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AboutPanel } from "./AboutPanel";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.0.4")),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("AboutPanel", () => {
  test("renders fork identity and upstream attribution", () => {
    const markup = renderToStaticMarkup(<AboutPanel onClose={vi.fn()} />);

    expect(markup).toContain("关于");
    expect(markup).toContain("Hermes Surface Dev");
    expect(markup).toContain("轻量、优雅、现代化的本地便签工具");
    expect(markup).toContain("Achilng/floral-notepaper");
    expect(markup).not.toContain("检查更新");
    expect(markup).not.toContain("MirrorChyan");
  });

  test("renders repository and license entries", () => {
    const markup = renderToStaticMarkup(<AboutPanel onClose={vi.fn()} />);

    expect(markup).toContain("GitHub");
    expect(markup).toContain("反馈问题");
    expect(markup).toContain("许可证");
    expect(markup).toContain("THIRD_PARTY_NOTICES.md");
  });
});
