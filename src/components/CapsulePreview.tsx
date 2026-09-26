import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const savingTask = useRef(false);
  const taskEpoch = useRef(0);
  const reconcile = useRef<() => void>(() => {});
  const current = useRef<Preview | null>(null);
  const dismissedGeneration = useRef(-1);
  current.current = preview;
  useEffect(() => {
    let active = true;
    let refreshQueued = false;
    let refreshRunning = false;
    const accept = (value: Preview | null) => {
      if (active && value && value.generation > dismissedGeneration.current)
        setPreview((old) => (!old || value.generation >= old.generation ? value : old));
    };
    const refreshEntry = () => {
      if (!active) return;
      if (savingTask.current || refreshRunning) {
        refreshQueued = true;
        return;
      }
      const snapshot = current.current;
      const entry = snapshot?.entry;
      if (!entry || !snapshot) return;
      refreshRunning = true;
      refreshQueued = false;
      const epoch = taskEpoch.current;
      void invoke<CapsuleEntry | null>("surface_capsule_entry", { key: entry.key })
        .then((next) => {
          if (savingTask.current || taskEpoch.current !== epoch) {
            refreshQueued = true;
            return;
          }
          if (active && next)
            setPreview((old) =>
              old?.entry.key === next.key &&
              old.generation === snapshot.generation &&
              (old.entry.preview !== next.preview || old.entry.title !== next.title)
                ? { ...old, entry: next }
                : old,
            );
        })
        .catch(() => undefined)
        .finally(() => {
          refreshRunning = false;
          if (active && refreshQueued && !savingTask.current) refreshEntry();
        });
    };
    reconcile.current = () => {
      if (refreshQueued) refreshEntry();
    };
    const listeners = [
      listen<number>("capsule-preview-hidden", ({ payload: generation }) => {
        if (!active) return;
        dismissedGeneration.current = Math.max(dismissedGeneration.current, generation);
        if (current.current && current.current.generation > generation) return;
        // 隐藏后卸载 Markdown，停止响应正文更新；迟到的旧 state 不能重新呈现。
        current.current = null;
        refreshQueued = false;
        selecting.current = false;
        setPreview((old) => (old && old.generation > generation ? old : null));
      }),
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
    const generation = preview?.generation ?? -1;
    try {
      await invoke("surface_capsule_dismiss");
      setPreview((old) => (old && old.generation > generation ? old : null));
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
    const releaseIfUp = (event: PointerEvent) => {
      // 在窗口外松开鼠标时可能收不到 pointerup，返回后也要释放交互占用。
      if ((event.buttons & 1) === 0) release();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointermove", releaseIfUp);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointermove", releaseIfUp);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [preview?.entry.key, preview?.generation]);
  const toggleTask = async (offset: number, checked: boolean) => {
    if (!preview || busy || savingTask.current) return;
    const key = preview.entry.key;
    const generation = preview.generation;
    const optimistic = toggleTaskMarker(preview.entry.preview, offset, checked);
    if (optimistic == null) return;
    savingTask.current = true;
    taskEpoch.current++;
    const previous = preview.entry.preview;
    setPreview((old) =>
      old?.entry.key === key && old.generation === generation
        ? { ...old, entry: { ...old.entry, preview: optimistic } }
        : old,
    );
    setBusy(true);
    try {
      if (key.startsWith("linked:")) {
        const id = key.slice(7);
        const latest = await readLinkedFile(id);
        if (latest.content !== preview.entry.preview)
          throw new Error("原文件已变化，请等待预览更新后重试");
        const next = toggleTaskMarker(latest.content, offset, checked);
        if (next == null) return;
        await saveLinkedFile(id, next, latest.revision);
      } else {
        const id = key.slice(5);
        const latest = await getNote(id);
        if (latest.content !== preview.entry.preview)
          throw new Error("便签已变化，请等待预览更新后重试");
        const next = toggleTaskMarker(latest.content, offset, checked);
        if (next == null) return;
        await updateNote(id, { title: latest.title, category: latest.category, content: next });
      }
    } catch (cause) {
      setError(String(cause));
      setPreview((old) =>
        old?.entry.key === key && old.generation === generation
          ? { ...old, entry: { ...old.entry, preview: previous } }
          : old,
      );
    } finally {
      savingTask.current = false;
      // 保存产生的多个通知合并为一次核对；相同正文保持现有 DOM、generation 和滚动。
      reconcile.current();
      setBusy(false);
    }
  };
  const taskAction = useRef(toggleTask);
  taskAction.current = toggleTask;
  const handleTaskToggle = useCallback((offset: number, checked: boolean) => {
    void taskAction.current(offset, checked);
  }, []);
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
            onTaskToggle={handleTaskToggle}
          />
        ) : (
          <p className="preview-empty">空白便签</p>
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
