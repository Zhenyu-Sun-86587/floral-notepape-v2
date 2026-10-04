import type { AppConfig } from "../../features/settings/types";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WidgetSettings } from "./WidgetSettings";
export const productName = "笺影";
export interface PlatformConfig {
  macos?: {
    lightweightMode?: boolean;
    notesOnAllSpaces: boolean;
    capsulesOnAllSpaces: boolean;
    materialEffect?: "liquidGlass" | "frosted";
    materialEnabled?: boolean;
    mainOpacity?: { glass: number; frosted: number };
    noteOpacity?: { glass: number; frosted: number };
    capsuleOpacity?: { glass: number; frosted: number };
    capsuleLiquidMotion?: boolean;
    capsuleDynamics?: "lightweight" | "elastic" | "fluid";
    noteDynamics?: "lightweight" | "elastic" | "fluid";
    noteSpring?: boolean | null;
    refractionStrength?: number;
    fluidLowPower?: boolean;
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
      <label className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 bg-paper-warm/45 border border-paper-deep/25 cursor-pointer text-[12px] text-ink-soft">
        轻量模式（便签、胶囊与小组件）
        <input
          type="checkbox"
          className="accent-bamboo"
          checked={settings.lightweightMode ?? false}
          onChange={(event) =>
            onChange({ ...config, macos: { ...settings, lightweightMode: event.target.checked } })
          }
        />
      </label>
      <p className="text-[11px] text-ink-faint">
        启动时仅菜单栏驻留；关闭主界面会先保存，再释放主界面。便签与胶囊保留。需要列表或设置时，从菜单栏打开主界面。
      </p>
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
      <WidgetSettings />
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
  const [fluidStatus, setFluidStatus] = useState("");
  const glass =
    (settings.materialEnabled ?? true) &&
    (settings.materialEffect ?? "liquidGlass") === "liquidGlass";
  const fluid =
    glass && (settings.capsuleDynamics === "fluid" || settings.noteDynamics === "fluid");
  const noteSpring =
    settings.noteSpring ??
    (settings.noteDynamics != null && settings.noteDynamics !== "lightweight");
  useEffect(() => {
    if (!fluid) return;
    let active = true;
    const refresh = () => {
      if (document.hidden) return;
      void invoke<string>("macos_fluid_status").then(
        (text) => {
          if (active) setFluidStatus(text);
        },
        () => {
          if (active) setFluidStatus("流体模块状态不可用，保留原生效果");
        },
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fluid]);
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
                {mode === "glass" ? "背景浓度" : "磨砂不透明度"}
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
        胶囊融合与按压动画
        <input
          type="checkbox"
          checked={settings.capsuleLiquidMotion ?? true}
          onChange={(event) =>
            onChange({
              ...config,
              macos: {
                ...settings,
                capsuleLiquidMotion: event.target.checked,
                capsuleDynamics:
                  event.target.checked && settings.capsuleDynamics === "lightweight"
                    ? "elastic"
                    : settings.capsuleDynamics,
              },
            })
          }
        />
      </label>
      <label className="flex justify-between items-center text-[11px] text-ink-soft">
        胶囊背景
        <select
          aria-label="胶囊背景"
          disabled={!glass}
          value={settings.capsuleDynamics === "fluid" ? "fluid" : "native"}
          className="rounded-lg px-3 py-2 bg-paper-warm"
          onChange={(event) =>
            onChange({
              ...config,
              macos: {
                ...settings,
                capsuleDynamics:
                  event.target.value === "fluid"
                    ? "fluid"
                    : settings.capsuleDynamics === "lightweight"
                      ? "lightweight"
                      : "elastic",
              },
            })
          }
        >
          <option value="native">系统原生玻璃</option>
          <option value="fluid">桌面折射（实验 · 较高开销）</option>
        </select>
      </label>
      <label className="flex justify-between items-center text-[11px] text-ink-soft">
        便签背景
        <select
          aria-label="便签背景"
          disabled={!glass}
          value={settings.noteDynamics === "fluid" ? "fluid" : "native"}
          className="rounded-lg px-3 py-2 bg-paper-warm"
          onChange={(event) =>
            onChange({
              ...config,
              macos: {
                ...settings,
                noteDynamics:
                  event.target.value === "fluid" ? "fluid" : noteSpring ? "elastic" : "lightweight",
                noteSpring,
              },
            })
          }
        >
          <option value="native">系统原生玻璃</option>
          <option value="fluid">桌面折射（实验 · 较高开销）</option>
        </select>
      </label>
      <label className="flex justify-between text-[11px] text-ink-soft">
        便签拖动回弹
        <input
          type="checkbox"
          checked={noteSpring}
          disabled={!glass}
          onChange={(event) =>
            onChange({ ...config, macos: { ...settings, noteSpring: event.target.checked } })
          }
        />
      </label>
      <p className="text-[10px] text-ink-faint">
        原生玻璃也有系统折射；背景浓度调整染色与扩散，不控制系统折射强度。想去除玻璃变形请选择“磨砂”。回弹只影响交互动画，不是另一种静态材质。
      </p>
      {fluid && (
        <div className="space-y-2 text-[11px] text-ink-soft">
          <p>
            桌面折射采样真实桌面并用 GPU
            折射。需要屏幕录制权限，开销明显更高；画面仅在本机内存中处理，不保存、不上传，不采集音频。胶囊超过
            12 个时使用原生玻璃。
          </p>
          <label className="block">
            桌面折射强度（便签与胶囊） {settings.refractionStrength ?? 100}%
            <input
              aria-label="桌面折射强度"
              type="range"
              min="0"
              max="100"
              value={settings.refractionStrength ?? 100}
              className="w-full accent-bamboo"
              onChange={(event) =>
                onChange({
                  ...config,
                  macos: { ...settings, refractionStrength: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="flex justify-between">
            桌面折射节能模式
            <input
              type="checkbox"
              checked={settings.fluidLowPower ?? false}
              onChange={(event) =>
                onChange({ ...config, macos: { ...settings, fluidLowPower: event.target.checked } })
              }
            />
          </label>
          <p>
            节能：便签6fps / 512像素，胶囊采样12fps；标准：便签12fps /
            768像素，胶囊采样24fps。文字分辨率不变。强度调到0仍会采样；停止采样请选原生背景。
          </p>
          <p role="status">{fluidStatus || "保存后启用；未授权时回退到弹性玻璃"}</p>
          <button
            type="button"
            className="rounded-lg px-3 py-2 bg-paper-warm"
            onClick={() =>
              void invoke<string>("macos_fluid_status", { request: true }).then(
                setFluidStatus,
                () => setFluidStatus("请在系统设置中检查屏幕录制权限"),
              )
            }
          >
            授权 / 重试背景采样
          </button>
          <p>如系统要求，授权后重启应用。便签与胶囊都切回原生背景后停止采样。</p>
        </div>
      )}
      <p className="text-[10px] text-ink-faint">
        原生背景优先适合日常使用。桌面折射开销随可见便签数量增加；不可见窗口暂停绘制，没有可见折射窗口时停止采样。动画只在交互期间运行。
      </p>
      <p className="text-[10px] text-ink-faint">
        数值越低越通透，文字不随背景变淡。玻璃保留系统折射；系统“减少动态效果”时关闭融合动画。
      </p>
      <p className="text-[10px] text-ink-faint">
        应用于主窗口、便签、胶囊与悬停预览的整块背景。液态玻璃需要 macOS 26；较旧系统自动使用磨砂。
      </p>
    </div>
  );
}
