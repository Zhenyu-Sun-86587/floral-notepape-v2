import chroma from "chroma-js";
import { expect, it } from "vitest";
import { textAgainst } from "./Tile";

it("keeps body text at AA contrast across light, dark, and custom tile colors", () => {
  for (const background of ["#f6f3ec", "#242823", "#e6c7d8", "#3a5879"]) {
    const target = chroma(background).luminance() > 0.18 ? "#141816" : "#f7f8f4";
    expect(
      chroma.contrast(background, textAgainst(background, target, 4.5)),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
