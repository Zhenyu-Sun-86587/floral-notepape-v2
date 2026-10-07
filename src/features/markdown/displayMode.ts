export type MarkdownDisplayMode = "source" | "hybrid" | "preview";

export const displayModes = [
  { value: "source", label: "源码", description: "显示完整 Markdown 源码" },
  { value: "hybrid", label: "混合", description: "保留语法标记，同时显示文字格式" },
  { value: "preview", label: "预览", description: "渲染 Markdown，原位编辑时显示当前语法" },
] as const;

export function defaultDisplayMode(
  config?: {
    surfaceDisplayMode?: MarkdownDisplayMode | null;
    tileRenderMarkdown?: boolean;
  } | null,
): MarkdownDisplayMode {
  return (
    config?.surfaceDisplayMode ?? (config?.tileRenderMarkdown === false ? "source" : "preview")
  );
}
