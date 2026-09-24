import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getErrorMessage } from "../features/notes/api";
import {
  hotkeyToConfigString,
  isValidGlobalShortcut,
  shortcutPlatform,
} from "../features/settings/shortcutRecorder";
import { useShortcutRecorder } from "../features/settings/useShortcutRecorder";
import {
  getSurfaceSession,
  saveSurfaceSession,
  type StartupBehavior,
  type SurfaceSession,
} from "../features/windows/surfaceSession";

export function SurfaceSessionControls({ sessionKey }: { sessionKey: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SurfaceSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError("");
    void getSurfaceSession(sessionKey)
      .then((value) => {
        if (active) setSession(value);
      })
      .catch((cause) => {
        if (active) setError(getErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [sessionKey]);

  useEffect(() => {
    const unlisten = listen<SurfaceSession>("surface-session-changed", (event) => {
      if (event.payload.key === sessionKey) setSession(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [sessionKey]);

  const save = async (change: Partial<SurfaceSession>) => {
    if (!session || busy) return;
    const next = { ...session, ...change };
    setBusy(true);
    setError("");
    try {
      await saveSurfaceSession(next);
      setSession(next);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const recorder = useShortcutRecorder({
    onRecord: (recorded) => {
      if (recorded && !isValidGlobalShortcut(recorded)) {
        setError("全局快捷键需包含 Ctrl、Alt 或 Win 键");
        return;
      }
      const shortcut = recorded ? hotkeyToConfigString(recorded, shortcutPlatform()) : "";
      void save({ shortcut });
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="h-7 px-2 rounded-lg text-xs text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
        title="当前便签的启动与快捷键"
      >
        启动
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-50 w-72 rounded-xl border border-paper-deep bg-paper p-3 shadow-lg text-sm text-ink">
          <div className="font-semibold mb-2">当前便签</div>
          <label className="block mb-1 text-ink-faint">登录启动时</label>
          <select
            value={session?.startupBehavior ?? "hidden"}
            disabled={!session || busy}
            onChange={(event) =>
              void save({ startupBehavior: event.target.value as StartupBehavior })
            }
            className="w-full rounded-lg border border-paper-deep bg-paper-warm p-2 mb-3"
          >
            <option value="hidden">不自动打开</option>
            <option value="restoreLast">恢复上次显示状态</option>
            <option value="expanded">始终打开</option>
          </select>
          <label className="block mb-1 text-ink-faint">窗口层级</label>
          <select
            value={session?.windowMode ?? "alwaysOnTop"}
            disabled={!session || busy}
            onChange={(event) =>
              void save({ windowMode: event.target.value as SurfaceSession["windowMode"] })
            }
            className="w-full rounded-lg border border-paper-deep bg-paper-warm p-2 mb-3"
          >
            <option value="alwaysOnTop">置顶</option>
            <option value="normal">普通窗口</option>
            <option value="desktopAttached" disabled={!navigator.userAgent.includes("Windows")}>
              附着桌面（Windows）
            </option>
          </select>
          {!navigator.userAgent.includes("Windows") && (
            <p className="mb-2 text-xs text-ink-faint">
              桌面附着暂仅支持 Windows；Mac 适配由协作者验收。
            </p>
          )}
          {session?.windowMode === "desktopAttached" && (
            <p className="mb-2 text-xs text-ink-faint">
              桌面附着时会停用原生 Acrylic 和窗口阴影，避免黑边；便签颜色与圆角仍保留。
            </p>
          )}
          <button
            type="button"
            disabled={!session || busy}
            onClick={() => void save({ locked: !session?.locked })}
            className="mb-2 w-full rounded-lg border border-paper-deep p-2 text-left"
          >
            {session?.locked ? "解除鼠标穿透锁定" : "锁定便签并允许鼠标穿透"}
          </button>
          <p className="mb-3 text-xs text-ink-faint">
            {navigator.userAgent.includes("Windows")
              ? "锁定后仅右上角“解锁”按钮接收点击，其余区域穿透；也可从这里解锁。"
              : "锁定后便签置顶且不接收鼠标；从这里解锁。"}
          </p>
          <div className="mb-1 text-ink-faint">全局快捷键（默认不占用）</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!session || busy}
              onClick={recorder.isRecording ? recorder.cancelRecording : recorder.startRecording}
              className="flex-1 rounded-lg border border-paper-deep p-2 text-left"
            >
              {recorder.isRecording ? "请按组合键 · Esc 取消" : session?.shortcut || "点击录制"}
            </button>
            <button
              type="button"
              disabled={!session || busy}
              onClick={() => void save({ shortcut: "" })}
            >
              清除
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-red-500 text-xs">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={!session || busy}
            onClick={() =>
              void save({
                startupBehavior: "hidden",
                shortcut: "",
                windowMode: "alwaysOnTop",
                locked: false,
              })
            }
            className="mt-2 text-xs text-ink-faint underline"
          >
            恢复默认
          </button>
          <p className="mt-2 text-xs text-ink-faint">关闭便签后可用快捷键按原位置重新打开。</p>
        </div>
      )}
    </div>
  );
}
