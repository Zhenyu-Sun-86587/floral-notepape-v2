import { describe, expect, it, vi } from "vitest";
import { resolveAppearance } from "./theme";
import { parseThemeFile } from "./themeFile";

describe("appearance inheritance and theme file", () => {
  it("only overrides explicit note fields", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const tokens = resolveAppearance(
      "light",
      {
        version: 1,
        global: { background: "#112233", fontSize: 18 },
        notes: { note1: { fontSize: 22 } },
      },
      "note1",
    );
    expect(tokens.background).toBe("#112233");
    expect(tokens.fontSize).toBe(22);
    expect(tokens.foreground).toBe("#1a1a18");
    vi.unstubAllGlobals();
  });

  it("rejects executable CSS fields in imported themes", () => {
    expect(() =>
      parseThemeFile(
        JSON.stringify({
          version: 1,
          preset: "light",
          tokens: { fontFamily: "url(https://example.com/font)" },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseThemeFile(
        JSON.stringify({ version: 1, preset: "light", tokens: { script: "alert(1)" } }),
      ),
    ).toThrow();
  });
});
