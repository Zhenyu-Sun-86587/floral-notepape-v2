import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface CapsuleEntry {
  key: string;
  title: string;
  preview: string;
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
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
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
      clearTimeout(hoverTimer.current);
      listeners.forEach((item) => void item.then((dispose) => dispose()));
    };
  }, [refresh]);

  const leave = () => {
    clearTimeout(hoverTimer.current);
    void invoke("surface_capsule_hover", { inside: false });
  };
  const preview = (entry: CapsuleEntry, button: HTMLButtonElement) => {
    clearTimeout(hoverTimer.current);
    if (busy.current) return;
    void invoke("surface_capsule_hover", { inside: true });
    const rect = button.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      void invoke("surface_capsule_preview", {
        key: entry.key,
        anchorY: rect.top + rect.height / 2,
        anchorX: rect.left + rect.width / 2,
      }).catch(() => setFailed(true));
    }, 90);
  };
  const restore = async (key: string) => {
    clearTimeout(hoverTimer.current);
    if (busy.current) return;
    busy.current = true;
    try {
      await invoke("surface_restore_stored", { key });
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  };

  return (
    <nav className={`edge-rail edge-${side}`} aria-label="已收纳便签" onPointerLeave={leave}>
      {entries.map((entry, index) => (
        <button
          key={entry.key}
          type="button"
          className={`edge-tab edge-tone-${index % 4}`}
          data-error={failed || undefined}
          aria-label={`展开 ${entry.title}`}
          onPointerEnter={(event) => preview(entry, event.currentTarget)}
          onFocus={(event) => preview(entry, event.currentTarget)}
          onBlur={leave}
          onPointerDown={(event) => {
            if (event.button !== 0 || busy.current || !navigator.userAgent.includes("Windows"))
              return;
            event.preventDefault();
            clearTimeout(hoverTimer.current);
            busy.current = true;
            void invoke("surface_capsule_drag", { key: entry.key })
              .catch(() => setFailed(true))
              .finally(() => {
                busy.current = false;
              });
          }}
          onClick={(event) => {
            // Windows 鼠标单击和拖动由同一后台流程判定，避免松手又触发展开。
            if (event.detail === 0 || !navigator.userAgent.includes("Windows"))
              void restore(entry.key);
          }}
        />
      ))}
    </nav>
  );
}
