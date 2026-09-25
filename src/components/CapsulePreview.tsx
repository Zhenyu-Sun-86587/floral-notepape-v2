import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CapsuleEntry } from "./CapsuleRail";
import { MarkdownPreviewLazy } from "../features/markdown/MarkdownPreviewLazy";
import { toggleTaskMarker } from "../features/markdown/taskMarker";
import { getNote, updateNote } from "../features/notes/api";
import { readLinkedFile, saveLinkedFile } from "../features/linked/api";

interface Preview {
  entry: CapsuleEntry;
  side: "left" | "right" | "top";
  generation: number;
}
export function CapsulePreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const closing = useRef(false);
  const previewAreaRef = useRef<HTMLElement>(null);
  const selecting = useRef(false);
  const current = useRef<Preview | null>(null);
  current.current = preview;
  useEffect(() => {
    let active = true;
    const accept = (value: Preview | null) => {
      if (active && value)
        setPreview((old) => (!old || value.generation >= old.generation ? value : old));
    };
    const refreshEntry = () => {
      const entry = current.current?.entry;
      if (!entry) return;
      void invoke<CapsuleEntry | null>("surface_capsule_entry", { key: entry.key })
        .then((next) => {
          if (active && next)
            setPreview((old) => (old?.entry.key === next.key ? { ...old, entry: next } : old));
        })
        .catch(() => undefined);
    };
    const listeners = [
      listen<Preview>("capsule-preview-changed", (event) => {
        setError("");
        accept(event.payload);
      }),
      listen<{ bindingId: string }>("linked-content-changed", (event) => {
        const entry = current.current?.entry;
        if (entry?.key !== `linked:${event.payload.bindingId}`) return;
        refreshEntry();
      }),
      listen("notes-changed", () => {
        if (current.current?.entry.key.startsWith("note:")) refreshEntry();
      }),
      listen<string>("linked-file-unavailable", (event) => {
        if (current.current?.entry.key === `linked:${event.payload}`) refreshEntry();
      }),
    ];
    void Promise.all(listeners)
      .then(() => invoke<Preview | null>("surface_capsule_preview_state"))
      .then(accept);
    return () => {
      active = false;
      listeners.forEach((item) => void item.then((dispose) => dispose()));
    };
  }, []);
  useLayoutEffect(() => {
    if (!preview) return;
    const frame = requestAnimationFrame(
      () => void invoke("surface_capsule_present", { generation: preview.generation }),
    );
    return () => cancelAnimationFrame(frame);
  }, [preview?.generation]);
  useEffect(() => {
    if (!preview || !previewAreaRef.current?.matches(":hover")) return;
    // 共享预览窗换 owner 时不会重新触发 pointerenter，需要把当前占用归给新会话。
    void invoke("surface_capsule_hover", {
      inside: true,
      source: "preview",
      key: preview.entry.key,
      session: preview.generation,
    });
  }, [preview?.entry.key, preview?.generation]);
  const act = async (command: string) => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await invoke(command, { key: preview.entry.key });
    } catch (cause) {
      setError(
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await invoke("surface_capsule_dismiss");
      setPreview(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      closing.current = false;
    }
  };
  const markInteraction = (inside: boolean) => {
    if (!preview) return;
    void invoke("surface_capsule_hover", {
      inside,
      source: "interaction",
      key: preview.entry.key,
      session: preview.generation,
    });
  };
  useEffect(() => {
    const release = () => {
      if (!selecting.current) return;
      selecting.current = false;
      markInteraction(false);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [preview?.entry.key, preview?.generation]);
  const toggleTask = async (offset: number, checked: boolean) => {
    if (!preview || busy) return;
    const key = preview.entry.key;
    const generation = preview.generation;
    setBusy(true);
    try {
      if (key.startsWith("linked:")) {
        const id = key.slice(7);
        const latest = await readLinkedFile(id);
        if (!latest.content.startsWith(preview.entry.preview))
          throw new Error("原文件已变化，请等待预览更新后重试");
        const next = toggleTaskMarker(latest.content, offset, checked);
        if (next == null) return;
        await saveLinkedFile(id, next, latest.revision);
      } else {
        const id = key.slice(5);
        const latest = await getNote(id);
        if (!latest.content.startsWith(preview.entry.preview))
          throw new Error("便签已变化，请等待预览更新后重试");
        const next = toggleTaskMarker(latest.content, offset, checked);
        if (next == null) return;
        await updateNote(id, { title: latest.title, category: latest.category, content: next });
      }
      const entry = await invoke<CapsuleEntry | null>("surface_capsule_entry", { key });
      if (entry)
        setPreview((old) =>
          old?.generation === generation && old.entry.key === key ? { ...old, entry } : old,
        );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!preview) return null;
  return (
    <article
      ref={previewAreaRef}
      className={`edge-preview from-${preview.side}`}
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
        <span className="preview-mark" aria-hidden>
          ▤
        </span>
        <button
          className="preview-title"
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
          <MarkdownPreviewLazy
            content={preview.entry.preview}
            fontSize={13}
            onTaskToggle={(offset, checked) => void toggleTask(offset, checked)}
          />
        ) : (
          <p className="preview-empty">空白便签</p>
        )}
        {preview.entry.truncated && (
          <p className="preview-truncated">内容未完 · 展开便签查看全文</p>
        )}
      </div>
      {error && (
        <p role="alert" className="preview-error">
          {error}
        </p>
      )}
    </article>
  );
}
