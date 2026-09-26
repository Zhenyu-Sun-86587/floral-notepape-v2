import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface CapsuleEntry {
  key: string;
  title: string;
  preview: string;
  colorKey: number;
  expanded: boolean;
  truncated: boolean;
}

// 色相分散，便签持久化保存的是槽位；主题和展开状态都不覆盖独立颜色。
const CAPSULE_COLORS = [
  "#739b69",
  "#5e95c6",
  "#d09a4b",
  "#9972bd",
  "#cb7785",
  "#4caaa1",
  "#c1ae45",
  "#6674ba",
  "#9aaf59",
  "#bc72a9",
  "#4eabbc",
  "#cb8056",
];

interface CapsuleGroup {
  runtimeId: number;
  revision: number;
  side: "left" | "right" | "top";
  members: CapsuleEntry[];
  slotCss: number;
  gripCss: number;
  crossCss: number;
  viewportCss: number;
  contentCss: number;
}

export function CapsuleRail() {
  const [group, setGroup] = useState<CapsuleGroup | null>(null);
  const rail = useRef<HTMLElement>(null);
  const revision = useRef(0);
  const slots = useRef<{ id: number; positions: Map<string, { x: number; y: number }> } | null>(
    null,
  );
  const entries = group?.members ?? [];
  const side = group?.side ?? "right";
  const [failed, setFailed] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const busy = useRef(false);
  const insideKey = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = () => {
    if (hoverTimer.current != null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const receive = useCallback((next: CapsuleGroup | null) => {
    if (!next || next.revision < revision.current) return;
    revision.current = next.revision;
    setGroup(next);
  }, []);
  useEffect(() => {
    let active = true;
    const listener = listen<CapsuleGroup>("capsule-group-changed", ({ payload }) => {
      if (active) receive(payload);
    });
    void listener
      .then(() => invoke<CapsuleGroup | null>("surface_capsule_group"))
      .then((next) => {
        if (active) receive(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      clearHoverTimer();
      void listener.then((dispose) => dispose());
    };
  }, [receive]);
  useLayoutEffect(() => {
    if (!group) return;
    const positions = new Map<string, { x: number; y: number }>();
    for (const element of rail.current?.querySelectorAll<HTMLElement>("[data-member-key]") ?? []) {
      const key = element.dataset.memberKey!;
      const point = { x: element.offsetLeft, y: element.offsetTop };
      const old =
        slots.current?.id === group.runtimeId ? slots.current.positions.get(key) : undefined;
      if (
        old &&
        (old.x !== point.x || old.y !== point.y) &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        element.animate(
          [
            { transform: `translate(${old.x - point.x}px, ${old.y - point.y}px)` },
            { transform: "none" },
          ],
          { duration: 160, easing: "ease-out" },
        );
      }
      positions.set(key, point);
    }
    slots.current = { id: group.runtimeId, positions };
    // 隐藏 WebView 的 rAF 可能被暂停；DOM commit + 上面的 layout 测量作为 ready 边界。
    // 不把定时器/动画结束当作 native 交接的正确性条件。
    void invoke("surface_capsule_group_ready", { revision: group.revision }).catch(() =>
      setFailed(true),
    );
  }, [group]);
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

  const drag = (entry: CapsuleEntry, group: boolean) => {
    if (busy.current) return;
    clearHoverTimer();
    busy.current = true;
    setPressedKey(entry.key);
    void invoke<boolean>("surface_capsule_drag", { key: entry.key, group })
      .then((dragged) => {
        if (!dragged && !group) return invoke("surface_restore_stored", { key: entry.key });
      })
      .catch(() => setFailed(true))
      .finally(() => {
        busy.current = false;
        setPressedKey(null);
      });
  };

  return (
    <nav
      ref={rail}
      className={`capsule-group edge-rail edge-${side}`}
      style={
        {
          "--slot": `${group?.slotCss ?? 44}px`,
          "--grip": `${group?.gripCss ?? 0}px`,
          "--cross": `${group?.crossCss ?? 18}px`,
          "--content": `${group?.contentCss ?? 44}px`,
        } as CSSProperties
      }
      aria-label="已收纳便签"
      onWheel={(event) => {
        if (side === "top" && group && group.contentCss > group.viewportCss)
          event.currentTarget.scrollLeft += event.deltaY;
      }}
      onPointerLeave={() => {
        if (insideKey.current) leave(insideKey.current);
      }}
    >
      {!!group?.gripCss && entries[0] && (
        <button
          type="button"
          className="edge-group-grip"
          aria-label={`拖动合并的 ${entries.length} 个胶囊`}
          title="拖动整组胶囊"
          onPointerDown={(event) => {
            if (event.button !== 0 || !navigator.userAgent.includes("Windows")) return;
            event.preventDefault();
            drag(entries[0], true);
          }}
        >
          <span aria-hidden="true" />
        </button>
      )}
      {entries.map((entry) => (
        <div className="edge-member" key={entry.key} data-member-key={entry.key}>
          <button
            type="button"
            style={
              {
                "--tab-color": CAPSULE_COLORS[entry.colorKey % CAPSULE_COLORS.length],
              } as CSSProperties
            }
            className="edge-tab"
            data-error={failed || undefined}
            data-pressed={pressedKey === entry.key || undefined}
            data-expanded={entry.expanded || undefined}
            aria-label={`${entry.expanded ? "聚焦" : "展开"} ${entry.title}`}
            onPointerEnter={(event) => {
              if (entry.expanded) {
                if (insideKey.current) leave(insideKey.current);
                return;
              }
              insideKey.current = entry.key;
              void invoke("surface_capsule_hover", {
                inside: true,
                source: "rail",
                key: entry.key,
              });
              dwell(entry, event.currentTarget);
            }}
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
              if (event.button !== 0 || !navigator.userAgent.includes("Windows")) return;
              event.preventDefault();
              drag(entry, false);
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
        </div>
      ))}
    </nav>
  );
}
