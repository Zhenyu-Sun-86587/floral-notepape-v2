import { describe, expect, it } from "vitest";
import { capsuleGeometry } from "./capsuleGeometry";

describe("胶囊实际 viewport 分配", () => {
  it("拖动头和三个完整成员共享总长度，缩放不会挤掉末端", () => {
    const css = capsuleGeometry(44, 14, 146);
    for (const viewport of [146, 123, 219, 255.5, 292]) {
      const grip = (parseFloat(css["--grip"]) * viewport) / 100;
      const slot = (parseFloat(css["--slot"]) * viewport) / 100;
      expect(grip + 3 * slot).toBeCloseTo(viewport);
      expect(viewport - (grip + 2 * slot)).toBeCloseTo(slot);
    }
  });
  it("单成员填满，超容量仍保留可滚动内容而非压缩槽位", () => {
    expect(capsuleGeometry(44, 0, 44)).toEqual({ "--slot": "100%", "--grip": "0%" });
    const css = capsuleGeometry(44, 14, 200);
    expect(parseFloat(css["--slot"]) * 100 + parseFloat(css["--grip"])).toBeGreaterThan(100);
  });
});
