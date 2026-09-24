import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { AppearanceTokens, ThemeOption } from "./types";

export interface ThemeFile {
  version: 1;
  preset: ThemeOption;
  tokens: Partial<AppearanceTokens>;
}

const colors = [
  "background",
  "foreground",
  "muted",
  "accent",
  "border",
  "codeBackground",
  "selection",
] as const;
const numbers: Record<string, [number, number]> = {
  fontSize: [8, 30],
  lineHeight: [1, 2.5],
  padding: [4, 40],
  radius: [0, 30],
  borderWidth: [0, 4],
  opacity: [0.2, 1],
};
const presets = ["light", "dark", "system", "tokyo-night", "everforest"];
const shadows = ["none", "0 1px 10px rgba(0,0,0,.12)", "0 6px 24px rgba(0,0,0,.25)"];

export function parseThemeFile(raw: string): ThemeFile {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("主题文件格式错误");
  const object = data as Record<string, unknown>;
  if (object.version !== 1 || !presets.includes(String(object.preset)))
    throw new Error("不支持的主题版本或预设");
  if (!object.tokens || typeof object.tokens !== "object" || Array.isArray(object.tokens))
    throw new Error("主题缺少 tokens");
  const source = object.tokens as Record<string, unknown>;
  const tokens: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (colors.includes(key as (typeof colors)[number])) {
      if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))
        throw new Error(`颜色 ${key} 无效`);
    } else if (key in numbers) {
      const [min, max] = numbers[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
        throw new Error(`数值 ${key} 无效`);
    } else if (key === "fontFamily" || key === "codeFontFamily") {
      // 仅接受本机字体族名，禁止 CSS 函数、URL 和声明注入。
      if (typeof value !== "string" || value.length > 80 || !/^[\p{L}\p{N} ._-]+$/u.test(value))
        throw new Error(`字体 ${key} 无效`);
    } else if (key === "shadow") {
      if (typeof value !== "string" || !shadows.includes(value)) throw new Error("阴影值无效");
    } else {
      throw new Error(`不支持的主题字段：${key}`);
    }
    tokens[key] = value;
  }
  return { version: 1, preset: object.preset as ThemeOption, tokens };
}

export async function importThemeFile(): Promise<ThemeFile | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON theme", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  return parseThemeFile(await invoke<string>("theme_read", { path }));
}

export async function exportThemeFile(file: ThemeFile): Promise<boolean> {
  const path = await save({
    defaultPath: "hermes-theme.json",
    filters: [{ name: "JSON theme", extensions: ["json"] }],
  });
  if (typeof path !== "string") return false;
  await invoke("theme_write", { path, content: JSON.stringify(file, null, 2) });
  return true;
}
