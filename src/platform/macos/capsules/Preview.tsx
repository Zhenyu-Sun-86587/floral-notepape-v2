import { DisplayModeCycleButton } from "../../../features/markdown/DisplayModeControl";
import { defaultDisplayMode } from "../../../features/markdown/displayMode";
import { useSurfaceDisplayMode } from "../../../features/windows/useSurfaceDisplayMode";
import { useRef, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AppConfig } from "../../../features/settings/types";
import { MarkdownSurface } from "../../../features/markdown/MarkdownSurface";
import { useImageBaseDir } from "../../../features/images/useImageBaseDir";
import { colors } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { useCapsulePreview } from "./useCapsulePreview";

export function CapsulePreview() {
  const scroll = useRef<HTMLDivElement>(null);
  const {
    preview,
    visible,
    busy,
    error,
    previewAreaRef,
    selecting,
    markInteraction,
    act,
    dismiss,
    handleTaskToggle,
  } = useCapsulePreview();
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const off = listen<AppConfig>("config-changed", ({ payload }) => {
      revision++;
      if (active) setConfig(payload);
    });
    void invoke<AppConfig>("config_get")
      .then((value) => {
        if (active && revision === 0) setConfig(value);
      })
      .catch(console.error);
    return () => {
      active = false;
      void off.then((dispose) => dispose());
    };
  }, []);
  const display = useSurfaceDisplayMode(preview?.entry.key ?? null, defaultDisplayMode(config));
  const imageBase = useImageBaseDir();
  if (!preview) return null;
  return (
    <article
      ref={previewAreaRef}
      className={`mac-preview from-${preview.side}`}
      data-visible={visible}
      style={
        {
          "--note-color": colors[preview.entry.colorKey % colors.length],
        } as import("react").CSSProperties
      }
      onPointerEnter={() =>
        void invoke("surface_capsule_hover", {
          inside: true,
          source: "preview",
          key: preview.entry.key,
          session: preview.generation,
        })
      }
      onPointerLeave={() =>
        void invoke("surface_capsule_hover", {
          inside: false,
          source: "preview",
          key: preview.entry.key,
          session: preview.generation,
        })
      }
      onPointerDown={(event) => {
        if (event.button === 0) {
          selecting.current = true;
          markInteraction(true);
        }
      }}
    >
      <header>
        <span className="preview-mark" aria-hidden />
        <button
          className="preview-title"
          title="展开便签"
          disabled={busy}
          onClick={() => void act("surface_restore_stored")}
        >
          {preview.entry.title}
        </button>
        <DisplayModeCycleButton
          className="preview-icon"
          value={display.mode}
          disabled={display.pending || busy}
          onChange={(mode) => void display.change(mode)}
        />
        <button
          className="preview-icon"
          disabled={busy}
          aria-label="展开便签"
          onClick={() => void act("surface_restore_stored")}
        >
          <svg viewBox="0 0 24 24">
            <path d="M14 4h6v6M20 4l-9 9M10 4H4v16h16v-6" />
          </svg>
        </button>
        <button
          className="preview-icon"
          aria-label="关闭预览"
          title="关闭预览"
          onPointerDown={(event) => {
            if (event.button === 0) void dismiss();
          }}
          onClick={(event) => {
            if (event.detail === 0) void dismiss();
          }}
        >
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className="preview-body" key={preview.entry.key} ref={scroll}>
        <MarkdownSurface
          content={preview.entry.preview}
          editing={false}
          locked={!!preview.entry.locked}
          markdown={display.mode !== "source"}
          displayMode={display.mode}
          activationGesture="none"
          fontSize={config?.surfaceFontSize ?? 14}
          scrollContainerRef={scroll}
          onReadTaskToggle={handleTaskToggle}
          imageBaseDir={preview.entry.imageBaseDir ?? imageBase ?? undefined}
          imageRootDir={preview.entry.imageRootDir ?? undefined}
          allowRemoteImages={config?.allowRemoteImages ?? false}
        />
      </div>
      <footer>
        <span>悬停预览</span>
        <span>点击胶囊展开 · 拖动移动</span>
      </footer>
      {display.error && (
        <p role="alert" className="preview-error">
          {display.error}
        </p>
      )}
      {error && (
        <p role="alert" className="preview-error">
          {error}
        </p>
      )}
    </article>
  );
}
