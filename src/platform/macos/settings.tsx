import type { AppConfig } from "../../features/settings/types";
export interface PlatformConfig {
  macos?: { notesOnAllSpaces: boolean; capsulesOnAllSpaces: boolean };
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
