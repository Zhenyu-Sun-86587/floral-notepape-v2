import type { AppearanceConfig, AppearanceTokens, ThemeOption } from "./types";
import { convertFileSrc } from "@tauri-apps/api/core";

const presets: Record<"light" | "dark" | "tokyo-night" | "everforest", AppearanceTokens> = {
  light: {
    background: "#ffffff",
    foreground: "#1a1a18",
    muted: "#8a8a80",
    accent: "#2d5a3d",
    border: "#e8e1d3",
    borderWidth: 1,
    codeBackground: "#f0ebe0",
    selection: "#d4e8da",
    fontFamily: "HarmonyOS Sans SC",
    codeFontFamily: "SF Mono",
    fontSize: 14,
    lineHeight: 1.8,
    padding: 16,
    radius: 14,
    shadow: "0 1px 10px rgba(26,26,24,.06)",
    opacity: 1,
  },
  dark: {
    background: "#1a1917",
    foreground: "#e5e1da",
    muted: "#928f87",
    accent: "#4faa70",
    border: "#3c3935",
    borderWidth: 1,
    codeBackground: "#2c2a27",
    selection: "#243a2c",
    fontFamily: "HarmonyOS Sans SC",
    codeFontFamily: "SF Mono",
    fontSize: 14,
    lineHeight: 1.8,
    padding: 16,
    radius: 14,
    shadow: "0 1px 10px rgba(0,0,0,.3)",
    opacity: 1,
  },
  // 配色取自 Tokyo Night / Everforest 的公开调色板，保留花笺原有布局。
  "tokyo-night": {
    background: "#1a1b26",
    foreground: "#c0caf5",
    muted: "#9aa5ce",
    accent: "#7aa2f7",
    border: "#414868",
    borderWidth: 1,
    codeBackground: "#24283b",
    selection: "#364a82",
    fontFamily: "HarmonyOS Sans SC",
    codeFontFamily: "SF Mono",
    fontSize: 14,
    lineHeight: 1.8,
    padding: 16,
    radius: 14,
    shadow: "0 1px 10px rgba(0,0,0,.35)",
    opacity: 1,
  },
  everforest: {
    background: "#2d353b",
    foreground: "#d3c6aa",
    muted: "#9da9a0",
    accent: "#a7c080",
    border: "#5c6a72",
    borderWidth: 1,
    codeBackground: "#343f44",
    selection: "#4b6254",
    fontFamily: "HarmonyOS Sans SC",
    codeFontFamily: "SF Mono",
    fontSize: 14,
    lineHeight: 1.8,
    padding: 16,
    radius: 14,
    shadow: "0 1px 10px rgba(0,0,0,.3)",
    opacity: 1,
  },
};

const colorKeys = [
  "background",
  "foreground",
  "muted",
  "accent",
  "border",
  "codeBackground",
  "selection",
] as const;
const cssColors: Record<(typeof colorKeys)[number], string> = {
  background: "--color-cloud",
  foreground: "--color-ink",
  muted: "--color-ink-faint",
  accent: "--color-bamboo",
  border: "--color-paper-deep",
  codeBackground: "--color-paper-warm",
  selection: "--appearance-selection",
};

export function resolveAppearance(
  theme: ThemeOption,
  appearance?: AppearanceConfig,
  noteId?: string,
): AppearanceTokens {
  const name = resolveTheme(theme);
  // 逐字段合并，便签只覆盖显式设置的值，仍跟随全局其余字段变化。
  return {
    ...presets[name],
    // Acrylic 需要可透出的 WebView 背景；显式设置的不透明度仍由用户决定。
    ...(appearance?.nativeMaterial ? { opacity: 0.6 } : {}),
    ...appearance?.global,
    ...(noteId ? appearance?.notes?.[noteId] : undefined),
  };
}

export function appearanceVariables(
  theme: ThemeOption,
  appearance?: AppearanceConfig,
  noteId?: string,
): Record<string, string> {
  const tokens = resolveAppearance(theme, appearance, noteId);
  return {
    ...Object.fromEntries(colorKeys.map((key) => [cssColors[key], tokens[key]])),
    "--color-ink-soft": tokens.foreground,
    "--color-ink-ghost": tokens.muted,
    "--color-bamboo-light": tokens.accent,
    "--color-paper": `color-mix(in srgb, ${tokens.background} 94%, ${tokens.foreground})`,
    "--color-bamboo-mist": `color-mix(in srgb, ${tokens.background} 88%, ${tokens.accent})`,
    "--color-bamboo-glow": `color-mix(in srgb, ${tokens.background} 75%, ${tokens.accent})`,
    "--color-stone": tokens.muted,
    "--font-body": `"${tokens.fontFamily.replace(/["\\]/g, "")}", "HarmonyOS Sans SC", system-ui, sans-serif`,
    "--font-display": `"${tokens.fontFamily.replace(/["\\]/g, "")}", "HarmonyOS Sans SC", system-ui, sans-serif`,
    "--font-mono": `"${tokens.codeFontFamily.replace(/["\\]/g, "")}", monospace`,
    "--appearance-line-height": String(tokens.lineHeight),
    "--appearance-padding": `${tokens.padding}px`,
    "--app-surface-radius": `${tokens.radius}px`,
    "--appearance-shadow": tokens.shadow,
    "--appearance-border-width": `${tokens.borderWidth}px`,
    "--appearance-opacity-percent": `${Math.round(tokens.opacity * 100)}%`,
    "--appearance-font-size": `${tokens.fontSize}px`,
    "--appearance-image": tokens.backgroundImagePath
      ? `url("${convertFileSrc(tokens.backgroundImagePath).replace(/"/g, "%22")}")`
      : "none",
    "--appearance-image-blur": `${Math.max(0, Math.min(20, tokens.imageBlur ?? 0))}px`,
  };
}

export function applyAppearance(
  theme: ThemeOption,
  appearance?: AppearanceConfig,
  noteId?: string,
): void {
  lastAppearance = appearance;
  lastNoteId = noteId;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(appearanceVariables(theme, appearance, noteId))) {
    // 无变化时不触发整窗样式失效和监听 style 的 Markdown 组件重绘。
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  const hasImage = !!resolveAppearance(theme, appearance, noteId).backgroundImagePath;
  if (root.hasAttribute("data-appearance-image") !== hasImage) {
    root.toggleAttribute("data-appearance-image", hasImage);
  }
}

let lastAppearance: AppearanceConfig | undefined;
let lastNoteId: string | undefined;

function resolveTheme(option: ThemeOption): "light" | "dark" | "tokyo-night" | "everforest" {
  if (option === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return option;
}

export function applyTheme(option: ThemeOption): void {
  const root = document.documentElement;
  const resolved = resolveTheme(option);
  // Cache to localStorage so the blocking script in index.html can set
  // data-theme before first paint, preventing a flash of wrong theme.
  localStorage.setItem("theme-option", option);
  const brightness = resolved === "light" ? "light" : "dark";
  localStorage.setItem("theme-resolved", brightness);
  root.setAttribute("data-theme-preset", resolved);
  if (root.getAttribute("data-theme") !== brightness) {
    root.classList.add("theme-transition");
    root.setAttribute("data-theme", brightness);
    setTimeout(() => root.classList.remove("theme-transition"), 400);
  }
}

let systemListener: (() => void) | null = null;

export function watchSystemTheme(option: ThemeOption): () => void {
  if (systemListener) {
    systemListener();
    systemListener = null;
  }

  if (option !== "system") return () => {};

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    applyTheme("system");
    applyAppearance("system", lastAppearance, lastNoteId);
    window.dispatchEvent(new Event("appearance-system-theme-changed"));
  };
  mql.addEventListener("change", handler);

  const cleanup = () => {
    mql.removeEventListener("change", handler);
    // 仅当自己仍是当前单例时才清空全局引用；否则会把后来者
    // （如设置面板刚注册的监听）的注销入口抹掉，造成监听泄漏
    if (systemListener === cleanup) {
      systemListener = null;
    }
  };
  systemListener = cleanup;
  return cleanup;
}
