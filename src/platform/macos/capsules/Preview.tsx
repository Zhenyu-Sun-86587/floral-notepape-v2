import { MarkdownPreview } from "../../../features/markdown/MarkdownPreview";
import { colors } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { useCapsulePreview } from "./useCapsulePreview";

export function CapsulePreview() {
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
          disabled={busy}
          aria-label="编辑便签"
          title="编辑便签"
          onClick={() => void act("surface_restore_edit")}
        >
          <svg viewBox="0 0 24 24">
            <path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3" />
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
      <div className="preview-body" key={preview.entry.key}>
        {preview.entry.preview.trim() ? (
          <MarkdownPreview
            content={preview.entry.preview}
            fontSize={14}
            onTaskToggle={handleTaskToggle}
          />
        ) : (
          <p className="preview-empty">空白便签</p>
        )}
      </div>
      <footer>
        <span>悬停预览</span>
        <span>点击胶囊展开 · 拖动移动</span>
      </footer>
      {error && (
        <p role="alert" className="preview-error">
          {error}
        </p>
      )}
    </article>
  );
}
