import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface CapsuleEntry {
  key: string;
  title: string;
  preview: string;
  joinedBefore: boolean;
  joinedAfter: boolean;
}

export function CapsuleRail({
  monitorIndex,
  side,
}: {
  monitorIndex: number;
  side: "left" | "right" | "top";
}) {
  const [entries, setEntries] = useState<CapsuleEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const inside = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = () => {
    if (hoverTimer.current != null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const refresh = useCallback(async () => {
    const next = await invoke<CapsuleEntry[]>("surface_capsules_list", { monitorIndex, side });
    setEntries(next);
  }, [monitorIndex, side]);

  useEffect(() => {
    let active = true;
    const listeners = ["capsules-changed", "notes-changed", "bindings-changed"].map((name) =>
      listen(name, () => {
        if (active) void refresh().catch(() => setFailed(true));
      }),
    );
    void Promise.all(listeners)
      .then(refresh)
      .then(() => {
        if (active) return invoke("show_silent_surface");
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      clearHoverTimer();
      listeners.forEach((item) => void item.then((dispose) => dispose()));
    };
  }, [refresh]);

  const leave = () => {
    clearHoverTimer();
    inside.current = false;
    void invoke("surface_capsule_hover", { inside: false });
  };
  const dwell = (entry: CapsuleEntry, button: HTMLButtonElement) => {
    clearHoverTimer();
    // 停留后才读取便签；掠过屏幕边缘不触发 WebView 渲染。
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      if (inside.current && !busy.current && button.matches(":hover")) preview(entry, button);
    }, 300);
  };
  const preview = (entry: CapsuleEntry, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    void invoke<number>("surface_capsule_hover", { inside: true })
      .then((generation) => {
        if (
          !inside.current ||
          !button.isConnected ||
          (!button.matches(":hover") && document.activeElement !== button)
        )
          return;
        return invoke("surface_capsule_preview", {
          key: entry.key,
          anchorY: rect.top + rect.height / 2,
          anchorX: rect.left + rect.width / 2,
          generation,
        });
      })
      .catch(() => setFailed(true));
  };

  return (
    <nav
      className={`edge-rail edge-${side}`}
      aria-label="已收纳便签"
      onPointerEnter={() => {
        inside.current = true;
      }}
      onPointerLeave={leave}
    >
      {entries.map((entry, index) => (
        <button
          key={entry.key}
          type="button"
          className={`edge-tab edge-tone-${index % 4} ${entry.joinedBefore ? "joined-before" : ""} ${entry.joinedAfter ? "joined-after" : ""}`}
          data-error={failed || undefined}
          aria-label={`预览 ${entry.title}`}
          onPointerEnter={(event) => dwell(entry, event.currentTarget)}
          onPointerLeave={() => {
            clearHoverTimer();
            void invoke("surface_capsule_hover", { inside: false });
          }}
          onFocus={() => {
            inside.current = true;
          }}
          onBlur={leave}
          onPointerDown={(event) => {
            if (event.button !== 0 || busy.current || !navigator.userAgent.includes("Windows"))
              return;
            event.preventDefault();
            clearHoverTimer();
            busy.current = true;
            const button = event.currentTarget;
            void invoke<boolean>("surface_capsule_drag", { key: entry.key })
              .then((dragged) => {
                // 单击才预览；拖动全程不创建预览窗口。
                if (!dragged && inside.current) preview(entry, button);
              })
              .catch(() => setFailed(true))
              .finally(() => {
                busy.current = false;
              });
          }}
          onClick={(event) => {
            // 键盘及非 Windows 的单击保持可访问；Windows 鼠标由原生拖动判定。
            if (event.detail === 0 || !navigator.userAgent.includes("Windows")) {
              clearHoverTimer();
              preview(entry, event.currentTarget);
            }
          }}
        />
      ))}
    </nav>
  );
}
