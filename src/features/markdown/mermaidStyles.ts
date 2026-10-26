/** Packaged Tauri pages use a style nonce. Mermaid's generated SVG styles must
 * use the same nonce; inline declarations are restored through CSSOM, just like
 * React's style prop, rather than inserted as blocked style attributes. */
export function prepareMermaidSvg(svg: string, nonce: string): string {
  if (!nonce) return svg;
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("图表 SVG 无法解析");
  for (const style of document.querySelectorAll("style")) style.setAttribute("nonce", nonce);
  for (const element of document.querySelectorAll<HTMLElement | SVGElement>("[style]")) {
    const declarations = Array.from(element.style).map((name) => [
      name,
      element.style.getPropertyValue(name),
      element.style.getPropertyPriority(name),
    ]);
    element.removeAttribute("style");
    element.setAttribute("data-mermaid-inline-styles", JSON.stringify(declarations));
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function restoreMermaidInlineStyles(root: HTMLElement | null) {
  if (!root) return;
  for (const element of root.querySelectorAll<HTMLElement | SVGElement>(
    "[data-mermaid-inline-styles]",
  )) {
    const declarations = JSON.parse(
      element.getAttribute("data-mermaid-inline-styles")!,
    ) as string[][];
    for (const [name, value, priority] of declarations)
      element.style.setProperty(name, value, priority);
    element.removeAttribute("data-mermaid-inline-styles");
  }
}
