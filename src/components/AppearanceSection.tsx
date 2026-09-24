import { useEffect, useState } from "react";
import type { AppConfig, AppearanceTokens } from "../features/settings/types";
import { resolveAppearance } from "../features/settings/theme";
import { getMaterialStatus, type MaterialStatus } from "../features/settings/nativeMaterial";
import { exportThemeFile, importThemeFile } from "../features/settings/themeFile";
import { showToast } from "./Toast";
import { chooseBackgroundImage } from "../features/settings/api";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  config: AppConfig;
  noteId?: string;
  onChange: (config: AppConfig) => void;
}

const colorFields: Array<[keyof AppearanceTokens, string]> = [
  ["background", "背景"],
  ["foreground", "文字"],
  ["muted", "次要文字"],
  ["accent", "强调色"],
  ["border", "边框"],
  ["codeBackground", "代码背景"],
  ["selection", "选区"],
];

const numberFields: Array<[keyof AppearanceTokens, string, number, number, number]> = [
  ["fontSize", "字号", 8, 30, 1],
  ["lineHeight", "行距", 1, 2.5, 0.1],
  ["padding", "内边距", 4, 40, 1],
  ["radius", "圆角", 0, 30, 1],
  ["borderWidth", "边框宽度", 0, 4, 1],
];

export function AppearanceSection({ config, noteId, onChange }: Props) {
  const [scope, setScope] = useState<"global" | "note">("global");
  const [materialStatus, setMaterialStatus] = useState<MaterialStatus>(getMaterialStatus);
  useEffect(() => {
    const update = () => setMaterialStatus(getMaterialStatus());
    window.addEventListener("native-material-status", update);
    return () => window.removeEventListener("native-material-status", update);
  }, []);
  const activeNoteId = scope === "note" ? noteId : undefined;
  const overrides = activeNoteId
    ? (config.appearance?.notes?.[activeNoteId] ?? {})
    : (config.appearance?.global ?? {});
  const values = resolveAppearance(config.theme, config.appearance, activeNoteId);

  const update = (key: keyof AppearanceTokens, value: string | number | undefined) => {
    const next = { ...overrides };
    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
    const appearance = config.appearance ?? { version: 1 as const };
    onChange({
      ...config,
      appearance: activeNoteId
        ? { ...appearance, notes: { ...appearance.notes, [activeNoteId]: next } }
        : { ...appearance, global: next },
    });
  };

  const controlClass =
    "h-8 min-w-0 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft px-2";
  return (
    <section className="space-y-3 border-t border-paper-deep/40 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-faint">外观覆盖</span>
        {noteId && (
          <select
            className={controlClass}
            value={scope}
            onChange={(event) => setScope(event.target.value as "global" | "note")}
          >
            <option value="global">全部便签</option>
            <option value="note">当前便签</option>
          </select>
        )}
      </div>
      {scope === "note" && !noteId && (
        <p className="text-[11px] text-ink-faint">请先选择一篇笔记。</p>
      )}
      <p className="text-[10px] text-ink-ghost">
        单便签只保存改动字段；主题字号优先于下方旧字号设置。点“继承”恢复跟随。
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="text-[11px] text-bamboo"
          onClick={() => {
            void importThemeFile()
              .then((file) => {
                if (!file) return;
                onChange({
                  ...config,
                  theme: file.preset,
                  appearance: {
                    ...config.appearance,
                    version: 1,
                    global: {
                      ...file.tokens,
                      backgroundImagePath: config.appearance?.global?.backgroundImagePath,
                      imageBlur: config.appearance?.global?.imageBlur,
                    },
                  },
                });
                showToast("主题已导入");
              })
              .catch((error) => showToast(String(error)));
          }}
        >
          导入 JSON 主题
        </button>
        <button
          type="button"
          className="text-[11px] text-bamboo"
          onClick={() => {
            const {
              backgroundImagePath: _localImage,
              imageBlur: _localBlur,
              ...portableTokens
            } = config.appearance?.global ?? {};
            void exportThemeFile({ version: 1, preset: config.theme, tokens: portableTokens })
              .then((saved) => {
                if (saved) showToast("主题已导出");
              })
              .catch((error) => showToast(String(error)));
          }}
        >
          导出 JSON 主题
        </button>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-ink-faint">
        <input
          type="checkbox"
          checked={config.appearance?.nativeMaterial ?? false}
          onChange={(event) =>
            onChange({
              ...config,
              appearance: {
                ...config.appearance,
                version: 1,
                nativeMaterial: event.target.checked,
              },
            })
          }
        />
        Windows Acrylic 原生磨砂
      </label>
      <p className="text-[10px] text-ink-ghost">
        {materialStatus === "active"
          ? "系统已接受 Acrylic 请求；实际磨砂效果以桌面观察为准"
          : materialStatus === "unavailable"
            ? "当前环境不可用，已降级为半透明背景"
            : "原生材质未启用"}
      </p>
      {colorFields.map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-[11px] text-ink-faint">{label}</label>
          <input
            type="color"
            value={String(values[key])}
            onChange={(event) => update(key, event.target.value)}
            className="w-9 h-8 cursor-pointer"
          />
          <span className="flex-1 text-[10px] font-mono text-ink-faint">{String(values[key])}</span>
          {overrides[key] !== undefined && (
            <button className="text-[10px] text-bamboo" onClick={() => update(key, undefined)}>
              继承
            </button>
          )}
        </div>
      ))}
      {(
        [
          ["fontFamily", "正文字体"],
          ["codeFontFamily", "代码字体"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <label className="w-16 shrink-0 text-[11px] text-ink-faint">{label}</label>
          <input
            type="text"
            className={`${controlClass} flex-1`}
            value={String(values[key])}
            maxLength={80}
            onChange={(event) => update(key, event.target.value)}
            placeholder="已安装字体名称"
          />
          {overrides[key] !== undefined && (
            <button className="text-[10px] text-bamboo" onClick={() => update(key, undefined)}>
              继承
            </button>
          )}
        </div>
      ))}
      {numberFields.map(([key, label, min, max, step]) => (
        <div key={key} className="flex items-center gap-2">
          <label className="w-20 shrink-0 text-[11px] text-ink-faint">{label}</label>
          <input
            type="range"
            className="flex-1 accent-bamboo"
            min={min}
            max={max}
            step={step}
            value={Number(values[key])}
            onChange={(event) => update(key, Number(event.target.value))}
          />
          <span className="w-8 text-right text-[10px] text-ink-faint">
            {Number(values[key]).toFixed(key === "lineHeight" ? 1 : 0)}
          </span>
          {overrides[key] !== undefined && (
            <button className="text-[10px] text-bamboo" onClick={() => update(key, undefined)}>
              继承
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-[11px] text-ink-faint">背景透明度</label>
        <input
          type="range"
          className="flex-1 accent-bamboo"
          min={0}
          max={80}
          step={5}
          value={Math.round((1 - values.opacity) * 100)}
          onChange={(event) => update("opacity", 1 - Number(event.target.value) / 100)}
        />
        <span className="w-8 text-right text-[10px] text-ink-faint">
          {Math.round((1 - values.opacity) * 100)}%
        </span>
        {overrides.opacity !== undefined && (
          <button className="text-[10px] text-bamboo" onClick={() => update("opacity", undefined)}>
            继承
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 text-[11px] text-ink-faint">阴影</label>
        <select
          className={`${controlClass} flex-1`}
          value={values.shadow}
          onChange={(event) => update("shadow", event.target.value)}
        >
          <option value="none">无</option>
          <option value="0 1px 10px rgba(0,0,0,.12)">柔和</option>
          <option value="0 6px 24px rgba(0,0,0,.25)">明显</option>
          {!["none", "0 1px 10px rgba(0,0,0,.12)", "0 6px 24px rgba(0,0,0,.25)"].includes(
            values.shadow,
          ) && <option value={values.shadow}>主题默认</option>}
        </select>
        {overrides.shadow !== undefined && (
          <button className="text-[10px] text-bamboo" onClick={() => update("shadow", undefined)}>
            继承
          </button>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-ink-faint">便签背景图</span>
          <button
            type="button"
            className="text-[11px] text-bamboo"
            onClick={() => {
              void chooseBackgroundImage()
                .then(async (path) => {
                  if (!path) return;
                  update(
                    "backgroundImagePath",
                    await invoke<string>("copy_background_image", { sourcePath: path }),
                  );
                })
                .catch((error) => showToast(String(error)));
            }}
          >
            选择图片
          </button>
          {values.backgroundImagePath && (
            <button
              type="button"
              className="text-[11px] text-bamboo"
              onClick={() => update("backgroundImagePath", "")}
            >
              清除
            </button>
          )}
          {overrides.backgroundImagePath !== undefined && (
            <button
              className="text-[10px] text-bamboo"
              onClick={() => update("backgroundImagePath", undefined)}
            >
              继承
            </button>
          )}
        </div>
        <p className="truncate text-[10px] text-ink-ghost">
          {values.backgroundImagePath?.split(/[/\\]/).pop() ?? "无"}
        </p>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-ink-faint">图片模糊</span>
          <input
            type="range"
            className="flex-1 accent-bamboo"
            min={0}
            max={20}
            step={1}
            value={values.imageBlur ?? 0}
            onChange={(event) => update("imageBlur", Number(event.target.value))}
          />
          <span className="w-8 text-right text-[10px] text-ink-faint">
            {values.imageBlur ?? 0}px
          </span>
          {overrides.imageBlur !== undefined && (
            <button
              className="text-[10px] text-bamboo"
              onClick={() => update("imageBlur", undefined)}
            >
              继承
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
