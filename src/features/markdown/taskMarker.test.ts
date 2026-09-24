import { describe, expect, test } from "vitest";
import { taskMarkerOffset } from "./remarkTaskOffsets";
import { toggleTaskMarker } from "./taskMarker";

describe("task marker source positions", () => {
  test("changes only the selected repeated task with CRLF and Chinese text", () => {
    const prefix = "---\r\ntitle: 测试\r\n---\r\n";
    const body = "- [ ] 重复\r\n- [ ] 重复\r\n";
    const lineStart = body.indexOf("\r\n") + 2;
    const offset = taskMarkerOffset(body, lineStart, prefix.length);

    expect(offset).toBe(prefix.length + body.indexOf("[ ]", body.indexOf("\r\n") + 2));
    expect(toggleTaskMarker(prefix + body, offset!, true)).toBe(
      `${prefix}- [ ] 重复\r\n- [x] 重复\r\n`,
    );
    expect(toggleTaskMarker(prefix + body, offset! + 1, true)).toBeNull();
  });
});
