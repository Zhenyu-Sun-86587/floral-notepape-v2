import { expect, it } from "vitest";
import { textSourceMap, codeSourceMap } from "./textSourceMap";
it.each([
  ["a &amp; b", "a & b", 3, 7],
  ["\\*文本\\*", "*文本*", 2, 3],
  ["引用\n> 第二行", "引用\n第二行", 4, 6],
  ["引用\n> > 嵌套", "引用\n嵌套", 3, 7],
  ["😀 &#x1f600; 尾", "😀 😀 尾", 6, 13],
] as const)("%s 的 UTF-16 映射", (raw, text, at, expected) => {
  const map = textSourceMap(raw, text, 10);
  expect(map?.[at]).toBe(10 + expected);
  expect(map).toHaveLength(text.length + 1);
});
it.each([
  ["`a &amp; b`", "a &amp; b", false, 3, 4],
  ["`` code ` value ``", "code ` value", false, 7, 10],
  ["`multi\nline`", "multi line", false, 6, 7],
  ["```js\nconst x = 1;\n```", "const x = 1;\n", true, 6, 12],
  ["    first\n    second", "first\nsecond\n", true, 7, 15],
] as const)("代码 %s 保留字面量和缩进位置", (raw, text, block, at, expected) => {
  expect(codeSourceMap(raw, text, 0, block)?.[at]).toBe(expected);
});
it("无法可靠映射的输入显式回退", () => {
  expect(textSourceMap("a", "b", 0)).toBeNull();
});
