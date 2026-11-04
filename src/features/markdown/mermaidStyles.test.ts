// @vitest-environment jsdom
import { expect, it } from "vitest";
import { prepareMermaidSvg, restoreMermaidInlineStyles } from "./mermaidStyles";
it("打包页 SVG 样式使用 Tauri nonce，内联布局经 CSSOM 恢复", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" style="max-width:480px;height:auto"><style>.node{fill:#abc}</style><g style="font-weight:bold!important"><rect width="80" height="40"/></g></svg>';
  const prepared = prepareMermaidSvg(svg, "test-nonce");
  const host = document.createElement("div");
  host.innerHTML = prepared;
  expect(host.querySelector("style")?.getAttribute("nonce")).toBe("test-nonce");
  expect(host.querySelectorAll("[style]")).toHaveLength(0);
  restoreMermaidInlineStyles(host);
  expect(host.querySelector("svg")?.style.maxWidth).toBe("480px");
  expect(host.querySelector("g")?.style.fontWeight).toBe("bold");
  expect(host.querySelector("g")?.style.getPropertyPriority("font-weight")).toBe("important");
  expect(host.querySelector("rect")?.getAttribute("width")).toBe("80");
  expect(host.querySelectorAll("[data-mermaid-inline-styles]")).toHaveLength(0);

  expect(prepareMermaidSvg(svg, "")).toBe(svg);
  expect(() => prepareMermaidSvg("<svg><broken>", "nonce")).toThrow("SVG");
});
