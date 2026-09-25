import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface CapsuleEntry {
  key: string;
  title: string;
  preview: string;
  colorKey: number;
  truncated: boolean;
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
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const busy = useRef(false);
  const insideKey = useRef<string | null>(null);
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
    listeners.push(
      listen<string | null>("capsule-drag-state", ({ payload }) => {
        if (!active) return;
        clearHoverTimer();
        if (payload) setDraggingKey(payload);
        else setDraggingKey(null);
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

  const leave = (key: string) => {
    clearHoverTimer();
    if (insideKey.current === key) insideKey.current = null;
    void invoke("surface_capsule_hover", { inside: false, source: "rail", key });
  };
  const dwell = (entry: CapsuleEntry, button: HTMLButtonElement) => {
    clearHoverTimer();
    // 停留后才读取便签；掠过屏幕边缘不触发 WebView 渲染。
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      if (insideKey.current === entry.key && !busy.current && button.matches(":hover"))
        preview(entry, button);
    }, 250);
  };
  const preview = (entry: CapsuleEntry, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    void invoke<number>("surface_capsule_hover", { inside: true, source: "rail", key: entry.key })
      .then((generation) => {
        if (
          insideKey.current !== entry.key ||
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
      onPointerLeave={() => {
        if (insideKey.current) leave(insideKey.current);
      }}
    >
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className={`edge-tab edge-tone-${entry.colorKey % 8} ${entry.joinedBefore ? "joined-before" : ""} ${entry.joinedAfter ? "joined-after" : ""} ${draggingKey === entry.key ? "is-dragging" : ""}`}
          data-error={failed || undefined}
          data-pressed={pressedKey === entry.key || undefined}
          aria-label={`展开 ${entry.title}`}
          onPointerEnter={(event) => {
            insideKey.current = entry.key;
            void invoke("surface_capsule_hover", { inside: true, source: "rail", key: entry.key });
            dwell(entry, event.currentTarget);
          }}
          onPointerLeave={() => leave(entry.key)}
          onFocus={() => {
            insideKey.current = entry.key;
          }}
          onBlur={() => leave(entry.key)}
          onContextMenu={(event) => {
            event.preventDefault();
            clearHoverTimer();
            void invoke("surface_capsule_menu", { key: entry.key }).catch(() => setFailed(true));
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || busy.current || !navigator.userAgent.includes("Windows"))
              return;
            event.preventDefault();
            clearHoverTimer();
            busy.current = true;
            setPressedKey(entry.key);
            void invoke<boolean>("surface_capsule_drag", { key: entry.key })
              .then((dragged) => {
                if (!dragged) return invoke("surface_restore_stored", { key: entry.key });
              })
              .catch(() => setFailed(true))
              .finally(() => {
                busy.current = false;
                setPressedKey(null);
              });
          }}
          onClick={(event) => {
            // Windows 鼠标由原生拖动判定；键盘及 Mac 单击直接展开。
            if (event.detail === 0 || !navigator.userAgent.includes("Windows")) {
              clearHoverTimer();
              void invoke("surface_restore_stored", { key: entry.key }).catch(() =>
                setFailed(true),
              );
            }
          }}
        />
      ))}
    </nav>
  );
}
