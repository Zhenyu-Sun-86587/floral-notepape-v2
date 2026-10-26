import { DisplayModeCycleButton } from "../../../features/markdown/DisplayModeControl";
import { defaultDisplayMode } from "../../../features/markdown/displayMode";
import { useSurfaceDisplayMode } from "../../../features/windows/useSurfaceDisplayMode";
import { useRef, useEffect } from "react";
import { MarkdownSurface } from "../../../features/markdown/MarkdownSurface";
import type { SourceEditorHandle } from "../../../features/markdown/SourceEditor";
import { useImagePaste } from "../../../features/images/useImagePaste";
import { useImageBaseDir } from "../../../features/images/useImageBaseDir";
import { markdownImageDirectory } from "../../../features/markdown/imageSrc";
import { useCapsuleEditing } from "./useCapsuleEditing";
import { colors } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { useCapsulePreview } from "./useCapsulePreview";

export function CapsulePreview() {
  const occupied = useRef(false);
  const editor = useRef<SourceEditorHandle>(null);
  const pendingImages = useRef<Promise<void> | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const {
    refresh,
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
  } = useCapsulePreview(occupied);
  const edit = useCapsuleEditing(preview, occupied, editor, pendingImages);
  const display = useSurfaceDisplayMode(
    preview?.entry.key ?? null,
    defaultDisplayMode(edit.config),
  );
  const imageBase = useImageBaseDir();
  const target = edit.snapshot?.target;
  const linked = target && "binding" in target ? target : null;
  const images = useImagePaste({
    noteId: target && "id" in target ? target.id : null,
    linkedBindingId: linked?.binding.id,
    pendingRef: pendingImages,
    textareaRef: editor,
    setContent: edit.change,
    markDirty: () => {},
    onEnsureNoteSaved: async () => null,
    disabled: edit.phase !== "editing",
    onError: edit.reportError,
  });
  useEffect(() => {
    if (edit.phase === "reading") refresh();
  }, [edit.phase]);
  const inlineEnabled = edit.config?.inlineEditing ?? false;
  const inlineSession = inlineEnabled || edit.phase !== "reading";
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
          disabled={busy || edit.phase === "loading" || edit.phase === "leaving"}
          onClick={() => void act("surface_restore_stored")}
        >
          {preview.entry.title}
        </button>
        <DisplayModeCycleButton
          className="preview-icon"
          value={display.mode}
          disabled={display.pending || busy || edit.phase === "loading" || edit.phase === "leaving"}
          onChange={(mode) => void display.change(mode)}
        />
        <button
          className="preview-icon"
          disabled={busy || edit.phase === "loading" || edit.phase === "leaving"}
          aria-label="展开便签"
          onClick={() => void act("surface_restore_stored")}
        >
          <svg viewBox="0 0 24 24">
            <path d="M14 4h6v6M20 4l-9 9M10 4H4v16h16v-6" />
          </svg>
        </button>
        <button
          className="preview-icon"
          disabled={busy || edit.phase === "loading" || edit.phase === "leaving"}
          aria-label="编辑便签"
          title="编辑便签"
          onClick={() => {
            if (!inlineSession) void act("surface_restore_edit");
            else if (edit.phase === "editing") editor.current?.focus();
            else edit.begin();
          }}
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
      <div className="preview-body" key={preview.entry.key} ref={scroll}>
        <MarkdownSurface
          content={edit.snapshot?.content ?? preview.entry.preview}
          editing={edit.phase === "editing" || edit.phase === "leaving"}
          locked={
            edit.inputBlocked ||
            !!preview.entry.locked ||
            edit.phase === "leaving" ||
            edit.phase === "loading"
          }
          markdown={display.mode !== "source"}
          displayMode={display.mode}
          presentation={inlineSession ? "live" : "source"}
          activationGesture={inlineSession ? "click" : "none"}
          fontSize={edit.config?.surfaceFontSize ?? 14}
          editorRef={editor}
          scrollContainerRef={scroll}
          onActivate={edit.begin}
          onDeactivate={() => {
            void edit.finish(undefined, true);
          }}
          onChange={edit.change}
          onReadTaskToggle={handleTaskToggle}
          imageBaseDir={
            linked
              ? markdownImageDirectory(linked.binding.path)
              : (preview.entry.imageBaseDir ?? imageBase ?? undefined)
          }
          // Rust serializes absent internal-note paths as null. Use undefined so
          // the renderer defaults the boundary to the resolved image base.
          imageRootDir={linked?.imageRoot ?? preview.entry.imageRootDir ?? undefined}
          allowRemoteImages={edit.config?.allowRemoteImages ?? false}
          onPaste={images.handlePaste}
          onDrop={images.handleDrop}
          onDragOver={images.handleDragOver}
        />
      </div>
      <footer>
        <span>
          {edit.reloading
            ? "正在重新加载…"
            : edit.phase === "loading"
              ? "正在载入…"
              : edit.phase === "reading"
                ? "悬停预览"
                : edit.status === "saving"
                  ? "正在保存…"
                  : edit.status === "dirty"
                    ? "未保存"
                    : edit.status === "error"
                      ? "保存失败"
                      : "编辑中 · 已保存"}
        </span>
        <span>
          {edit.phase === "reading"
            ? inlineEnabled
              ? "点击文字编辑 · 点击胶囊展开"
              : "点击铅笔编辑 · 点击胶囊展开"
            : "⌘S 保存 · Esc 返回预览"}
        </span>
      </footer>
      {display.error && (
        <p role="alert" className="preview-error">
          {display.error}
        </p>
      )}
      {(error || edit.error) && (
        <p role="alert" className="preview-error">
          {edit.error || error}
          {edit.snapshot && (
            <>
              <button disabled={edit.reloading} onClick={() => void edit.save()}>
                重试保存
              </button>
              <button disabled={edit.reloading} onClick={() => void edit.reload()}>
                重新加载
              </button>
            </>
          )}
        </p>
      )}
    </article>
  );
}
