import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HoverIntent } from "./HoverIntent";
import { colors, reportError, type CapsuleEntry, type CapsuleGroup } from "./types";
import { useMaterial } from "./useMaterial";

export function CapsuleRail() {
  const [group, setGroup] = useState<CapsuleGroup | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const intent = useRef(new HoverIntent());
  const owner = useRef<string | null>(null);
  const busy = useRef(false);
  const hoverQueue = useRef<Promise<unknown>>(Promise.resolve());
  const hover = (inside: boolean, key: string) => {
    const next = hoverQueue.current.then(() =>
      invoke<number>("surface_capsule_hover", { inside, source: "rail", key }),
    );
    hoverQueue.current = next.catch(reportError);
    return next;
  };
  const strip = useRef<HTMLDivElement>(null);
  const materialReady = useMaterial();
  useEffect(() => {
    let active = true;
    const receive = (next: CapsuleGroup | null) => {
      if (active && next) setGroup((old) => (!old || next.revision >= old.revision ? next : old));
    };
    const listener = listen<CapsuleGroup>("capsule-group-changed", ({ payload }) =>
      receive(payload),
    );
    void listener
      .then(() => invoke<CapsuleGroup | null>("surface_capsule_group"))
      .then(receive)
      .catch(reportError);
    return () => {
      active = false;
      intent.current.cancel();
      void listener.then((dispose) => dispose());
    };
  }, []);
  useLayoutEffect(() => {
    if (group && materialReady)
      void invoke("surface_capsule_group_ready", { revision: group.revision }).catch(reportError);
  }, [group, materialReady]);
  const leave = () => {
    intent.current.cancel();
    const key = owner.current;
    owner.current = null;
    if (key) void hover(false, key).catch(reportError);
  };
  const enter = (entry: CapsuleEntry, button: HTMLButtonElement) => {
    leave();
    if (entry.expanded || busy.current) return;
    owner.current = entry.key;
    intent.current.enter(
      () => hover(true, entry.key),
      (generation) => {
        if (!button.isConnected || owner.current !== entry.key || busy.current) return;
        const rect = button.getBoundingClientRect();
        void invoke("surface_capsule_preview", {
          key: entry.key,
          generation,
          anchorX: rect.left + rect.width / 2,
          anchorY: rect.top + rect.height / 2,
        }).catch(reportError);
      },
    );
  };
  const drag = (entry: CapsuleEntry, wholeGroup: boolean) => {
    if (busy.current) return;
    leave();
    busy.current = true;
    setPressed(entry.key);
    void invoke<boolean>("surface_capsule_drag", { key: entry.key, group: wholeGroup })
      .then((dragged) => {
        if (!dragged && !wholeGroup) return invoke("surface_toggle_capsule", { key: entry.key });
      })
      .catch(reportError)
      .finally(() => {
        busy.current = false;
        setPressed(null);
      });
  };
  const side = group?.side ?? "right";
  return (
    <nav
      className={`mac-rail side-${side}`}
      aria-label="边缘便签"
      onPointerLeave={leave}
      style={
        {
          "--slot": `${group?.slotCss ?? 48}px`,
          "--grip": `${group?.gripCss ?? 0}px`,
        } as CSSProperties
      }
      onWheel={(event) => {
        if (side === "top" && strip.current) strip.current.scrollLeft += event.deltaY;
      }}
    >
      <div className="mac-rail-strip" ref={strip}>
        {!!group?.gripCss && group.members[0] && (
          <button
            className="mac-grip"
            aria-label={`拖动整组 ${group.members.length} 张便签`}
            onPointerDown={(event) => {
              if (event.button === 0) {
                event.preventDefault();
                drag(group.members[0], true);
              }
            }}
          >
            <span />
          </button>
        )}
        {group?.members.map((entry) => (
          <button
            key={entry.key}
            className="mac-capsule"
            style={{ "--note-color": colors[entry.colorKey % colors.length] } as CSSProperties}
            data-expanded={entry.expanded || undefined}
            data-pressed={pressed === entry.key || undefined}
            aria-label={`${entry.expanded ? "收回" : "展开"} ${entry.title}`}
            title={entry.expanded ? entry.title : undefined}
            onPointerEnter={(event) => enter(entry, event.currentTarget)}
            onPointerLeave={leave}
            onFocus={(event) => enter(entry, event.currentTarget)}
            onBlur={leave}
            onContextMenu={(event) => {
              event.preventDefault();
              leave();
              void invoke("surface_capsule_menu", { key: entry.key }).catch(reportError);
            }}
            onPointerDown={(event) => {
              if (event.button === 0) {
                event.preventDefault();
                drag(entry, false);
              }
            }}
            onClick={(event) => {
              if (event.detail === 0) {
                leave();
                void invoke("surface_toggle_capsule", { key: entry.key }).catch(reportError);
              }
            }}
          >
            <span className="mac-note-glyph" aria-hidden="true">
              <svg viewBox="0 0 20 22">
                <path d="M4 2h8l4 4v14H4z" />
                <path d="M12 2v5h4M7 11h6M7 15h5" />
              </svg>
            </span>
            <span className="mac-state-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
    </nav>
  );
}
