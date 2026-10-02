export interface CapsuleEntry {
  key: string;
  title: string;
  preview: string;
  colorKey: number;
  expanded: boolean;
}
export interface CapsuleGroup {
  runtimeId: number;
  revision: number;
  side: "left" | "right" | "top";
  members: CapsuleEntry[];
  slotCss: number;
  gripCss: number;
  crossCss: number;
  viewportCss: number;
  contentCss: number;
}
export const colors = [
  "#428768",
  "#4787bd",
  "#b68a39",
  "#8c6bb4",
  "#bd687b",
  "#38978d",
  "#a29336",
  "#6478b9",
  "#7c964b",
  "#ad67a0",
  "#368b9e",
  "#b57749",
];
export const reportError = (error: unknown) => console.error("Mac capsule", error);
