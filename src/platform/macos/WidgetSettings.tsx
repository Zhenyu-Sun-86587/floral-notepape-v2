import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface WidgetStatus {
  available: boolean;
  choices: { key: string; title: string }[];
  selected: string[];
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
  return (
    <section className="space-y-2 text-[12px] text-ink-soft">
      <div>macOS 桌面小组件</div>
      <p className="text-[11px] text-ink-faint">
        {status?.available
          ? "选择允许显示的便签，再右键桌面 → 编辑小组件 → 笺影。每个小组件可选择一张便签；大小与外观由系统管理，点击打开便签。"
          : "当前安装包未启用原生小组件。需要使用已配置 Apple 签名与共享容器的小组件安装包。"}
      </p>
      {status?.available && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {status.choices.length === 0 && <p>先新建或绑定一张笔记。</p>}
          {status.choices.map((note) => (
            <label key={note.key} className="flex items-center justify-between gap-2">
              <span className="truncate">{note.title || "无标题便签"}</span>
              <input
                type="checkbox"
                disabled={busy}
                checked={status.selected.includes(note.key)}
                onChange={(event) => void select(note.key, event.target.checked)}
              />
            </label>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
