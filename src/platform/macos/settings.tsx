import type { AppConfig } from "../../features/settings/types";
export interface PlatformConfig {
  macos?: {
    notesOnAllSpaces: boolean;
    capsulesOnAllSpaces: boolean;
    materialEffect?: "liquidGlass" | "frosted";
    materialEnabled?: boolean;
    mainOpacity?: { glass: number; frosted: number };
    noteOpacity?: { glass: number; frosted: number };
    capsuleOpacity?: { glass: number; frosted: number };
    capsuleLiquidMotion?: boolean;
  };
}
export function PlatformSettings({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}) {
  const settings = config.macos ?? { notesOnAllSpaces: true, capsulesOnAllSpaces: true };
  return (
    <section className="space-y-2">
      <div className="text-[11px] text-ink-faint">macOS 桌面与全屏空间</div>
      {(
        [
          ["notesOnAllSpaces", "便签在所有桌面显示"],
          ["capsulesOnAllSpaces", "胶囊在所有桌面显示"],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          className="flex items-center justify-between gap-2 h-9 rounded-lg px-2.5 bg-paper-warm/45 border border-paper-deep/25 cursor-pointer text-[12px] text-ink-soft"
        >
          {label}
          <input
            type="checkbox"
            className="accent-bamboo"
            checked={settings[key]}
            onChange={(event) =>
              onChange({ ...config, macos: { ...settings, [key]: event.target.checked } })
            }
          />
        </label>
      ))}
      <p className="text-[11px] text-ink-faint">
        保存后立即生效。关闭后留在当前所属桌面；开启后，置顶便签和胶囊也显示在其他应用的原生全屏空间。
      </p>
    </section>
  );
}
export const desktopLayerHint =
  "桌面层位于普通应用下方；编辑时临时回到普通层。跨桌面显示由设置控制，需要悬浮时请选择置顶模式。";
export const materialLabel = "macOS 原生磨砂";

export const desktopLayerLabel = "桌面层（macOS）";
export const supportsDesktopLayer = true;

export function MaterialSettings({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}) {
  const settings = config.macos ?? { notesOnAllSpaces: true, capsulesOnAllSpaces: true };
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between text-[12px] text-ink-soft">
        Mac 原生材质
        <input
          type="checkbox"
          checked={settings.materialEnabled ?? true}
          onChange={(event) =>
            onChange({ ...config, macos: { ...settings, materialEnabled: event.target.checked } })
          }
        />
      </label>
      <label className="flex items-center justify-between text-[12px] text-ink-soft">
        材质效果
        <select
          aria-label="Mac 材质效果"
          value={settings.materialEffect ?? "liquidGlass"}
          onChange={(event) =>
            onChange({
              ...config,
              macos: {
                ...settings,
                materialEffect: event.target.value as "liquidGlass" | "frosted",
              },
            })
          }
          className="rounded-lg px-3 py-2 bg-paper-warm"
        >
          <option value="liquidGlass">液态玻璃</option>
          <option value="frosted">磨砂</option>
        </select>
      </label>
      {(
        [
          ["mainOpacity", "主界面", 35, 70],
          ["noteOpacity", "便签", 35, 70],
          ["capsuleOpacity", "胶囊与预览", 25, 60],
        ] as const
      ).map(([key, label, glass, frosted]) => {
        const mode =
          (settings.materialEffect ?? "liquidGlass") === "liquidGlass" ? "glass" : "frosted";
        const values = settings[key] ?? { glass, frosted };
        return (
          <label key={key} className="block text-[11px] text-ink-soft">
            <span className="flex justify-between">
              <span>
                {label}
                {mode === "glass" ? "玻璃浓度" : "磨砂不透明度"}
              </span>
              <span>{values[mode]}%</span>
            </span>
            <input
              aria-label={`${label}材质浓度`}
              type="range"
              min="0"
              max="100"
              value={values[mode]}
              className="w-full accent-bamboo"
              onChange={(event) =>
                onChange({
                  ...config,
                  macos: { ...settings, [key]: { ...values, [mode]: Number(event.target.value) } },
                })
              }
            />
          </label>
        );
      })}
      <label className="flex justify-between text-[11px] text-ink-soft">
        胶囊液态融合动画
        <input
          type="checkbox"
          checked={settings.capsuleLiquidMotion ?? true}
          onChange={(event) =>
            onChange({
              ...config,
              macos: { ...settings, capsuleLiquidMotion: event.target.checked },
            })
          }
        />
      </label>
      <p className="text-[10px] text-ink-faint">
        数值越低越通透，文字不随背景变淡。玻璃保留系统折射；系统“减少动态效果”时关闭融合动画。
      </p>
      <p className="text-[10px] text-ink-faint">
        应用于主窗口、便签、胶囊与悬停预览的整块背景。液态玻璃需要 macOS 26；较旧系统自动使用磨砂。
      </p>
    </div>
  );
}
