import { describe, expect, test } from "vitest";
import { continueMarkdownList } from "./listEnter";

describe("continueMarkdownList", () => {
  test("continues nested tasks and resets the new checkbox", () => {
    const source = "  - [x] 中文😀";
    expect(continueMarkdownList(source, source.length, source.length)).toEqual({
      content: "  - [x] 中文😀\n  - [ ] ",
      cursor: source.length + "\n  - [ ] ".length,
    });
  });

  test("increments numbered lists and ends an empty item", () => {
    expect(continueMarkdownList("9. 项目", 5, 5)?.content).toBe("9. 项目\n10. ");
    expect(continueMarkdownList("- 项目\n- ", 7, 7)).toEqual({
      content: "- 项目\n",
      cursor: 5,
    });
  });

  test("leaves selections and ordinary paragraphs to the textarea", () => {
    expect(continueMarkdownList("普通正文", 4, 4)).toBeNull();
    expect(continueMarkdownList("- 项目", 2, 4)).toBeNull();
  });
});
