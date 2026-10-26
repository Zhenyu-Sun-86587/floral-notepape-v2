import type { TFunction } from "i18next";

export type MarkdownDisplayMode = "source" | "hybrid" | "preview";

export const displayModes = [
  { value: "source" },
  { value: "hybrid" },
  { value: "preview" },
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

export function nextDisplayMode(mode: MarkdownDisplayMode): MarkdownDisplayMode {
  return mode === "source" ? "hybrid" : mode === "hybrid" ? "preview" : "source";
}

export function displayModeCycleLabel(mode: MarkdownDisplayMode, t: TFunction): string {
  return t("markdown.displayMode.cycle", {
    current: t(`markdown.displayMode.${mode}`),
    next: t(`markdown.displayMode.${nextDisplayMode(mode)}`),
  });
}
