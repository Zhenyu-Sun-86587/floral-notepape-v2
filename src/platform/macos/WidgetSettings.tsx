import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface WidgetStatus {
  available: boolean;
  choices: { key: string; title: string }[];
  selected: string[];
  displays: WidgetDisplay[];
}
interface WidgetDisplay {
  noteKey: string | null;
  textSize: "compact" | "standard" | "large";
}
export function WidgetSettings() {
  const [status, setStatus] = useState<WidgetStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void invoke<WidgetStatus>("macos_widgets_status").then(
      (value) => {
        if (active) setStatus(value);
      },
      () => {
        if (active) setError("暂时无法读取小组件状态");
      },
    );
    return () => {
      active = false;
    };
  }, []);
  async function select(key: string, checked: boolean) {
    if (!status) return;
    setBusy(true);
    setError("");
    try {
      setStatus(
        await invoke<WidgetStatus>("macos_widgets_select", {
          keys: checked ? [...status.selected, key] : status.selected.filter((id) => id !== key),
        }),
      );
    } catch {
      setError("小组件便签未能保存，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function configure(index: number, patch: Partial<WidgetDisplay>) {
    if (!status) return;
    setBusy(true);
    setError("");
    try {
      setStatus(
        await invoke<WidgetStatus>("macos_widgets_configure", {
          slot: index + 1,
          display: { ...status.displays[index], ...patch },
        }),
      );
    } catch {
      setError("小组件显示配置未能发布，请重试");
      // The configuration may have saved while container publishing failed.
      try {
        setStatus(await invoke<WidgetStatus>("macos_widgets_status"));
      } catch {
        /* Keep the last known state. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-2 text-[12px] text-ink-soft">
      <div>macOS 桌面小组件</div>
      <p className="text-[11px] text-ink-faint">
        {status?.available
          ? "先允许共享便签，再为下方各编号选择内容和字号。右键桌面 → 编辑小组件，添加对应的笺影便签编号。相同编号共享设置；尺寸与外观由系统管理。"
          : "当前安装包未启用原生小组件，请使用包含 WidgetKit 扩展的安装包。"}
      </p>
      {status?.available && (
        <>
          <div className="space-y-2">
            {status.displays.map((display, index) => {
              const options = status.choices.filter((note) => status.selected.includes(note.key));
              const unavailable =
                display.noteKey && !options.some((note) => note.key === display.noteKey);
              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <span>便签 {index + 1}</span>
                  <select
                    aria-label={`便签 ${index + 1} 内容`}
                    disabled={busy}
                    value={display.noteKey ?? ""}
                    onChange={(event) =>
                      void configure(index, { noteKey: event.target.value || null })
                    }
                    className="min-w-0 flex-1 rounded border border-paper-deep/25 bg-paper-warm px-2 py-1"
                  >
                    <option value="">不显示内容</option>
                    {unavailable && (
                      <option value={display.noteKey!}>已撤销共享或笔记不可用</option>
                    )}
                    {options.map((note) => (
                      <option key={note.key} value={note.key}>
                        {note.title || "无标题便签"}
                        {note.key.startsWith("linked:") ? "（外部 Markdown）" : "（内部便签）"}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`便签 ${index + 1} 字号`}
                    disabled={busy}
                    value={display.textSize}
                    onChange={(event) =>
                      void configure(index, {
                        textSize: event.target.value as WidgetDisplay["textSize"],
                      })
                    }
                    className="rounded border border-paper-deep/25 bg-paper-warm px-2 py-1"
                  >
                    <option value="compact">紧凑</option>
                    <option value="standard">标准</option>
                    <option value="large">大字</option>
                  </select>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-faint">允许共享的便签（包括外部 Markdown）：</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {status.choices.length === 0 && <p>先新建或绑定一张笔记。</p>}
            {status.choices.map((note) => (
              <label key={note.key} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {note.title || "无标题便签"}
                  {note.key.startsWith("linked:") ? "（外部 Markdown）" : "（内部便签）"}
                </span>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={status.selected.includes(note.key)}
                  onChange={(event) => void select(note.key, event.target.checked)}
                />
              </label>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
