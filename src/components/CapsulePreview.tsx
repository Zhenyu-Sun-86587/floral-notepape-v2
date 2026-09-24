import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CapsuleEntry } from "./CapsuleRail";

interface Preview {
  entry: CapsuleEntry;
  side: "left" | "right" | "top";
  generation: number;
}
const plain = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "〔图片〕")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "");

function Body({ source }: { source: string }) {
  let code = false;
  return (
    <>
      {source.split("\n").map((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) {
          code = !code;
          return null;
        }
        if (code)
          return (
            <div className="preview-code" key={index}>
              {line || " "}
            </div>
          );
        if (!line.trim()) return <div className="preview-space" key={index} />;
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        if (heading) return <h3 key={index}>{plain(heading[2])}</h3>;
        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return <hr key={index} />;
        const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
        if (task)
          return (
            <p className="preview-list" key={index}>
              <span aria-hidden>{task[1] === " " ? "☐" : "☑"}</span>
              <span>{plain(task[2])}</span>
            </p>
          );
        const list = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (list)
          return (
            <p className="preview-list" key={index}>
              <span aria-hidden>•</span>
              <span>{plain(list[1])}</span>
            </p>
          );
        return <p key={index}>{plain(line.replace(/^>\s?/, ""))}</p>;
      })}
    </>
  );
}

export function CapsulePreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  if (!preview) return null;
  return (
    <article
      className={`edge-preview from-${preview.side}`}
      onPointerEnter={() => void invoke("surface_capsule_hover", { inside: true })}
      onPointerLeave={() => void invoke("surface_capsule_hover", { inside: false })}
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
          aria-label="隐藏便签"
          onClick={() => void act("surface_capsule_hide")}
        >
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div
        className="preview-body"
        key={preview.entry.key}
        role="button"
        tabIndex={0}
        aria-label="展开预览中的便签"
        onClick={() => void act("surface_restore_stored")}
        onKeyDown={(event) => {
          if (event.key === "Enter") void act("surface_restore_stored");
        }}
      >
        {preview.entry.preview.trim() ? (
          <Body source={preview.entry.preview} />
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
