import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSurfaceSession, type SurfaceSession } from "./surfaceSession";
import type { MarkdownDisplayMode } from "../markdown/displayMode";

/** A note and its capsule share one persisted override; null follows the global default. */
export function useSurfaceDisplayMode(key: string | null, defaultMode: MarkdownDisplayMode) {
  const [saved, setSaved] = useState<{ key: string; mode: MarkdownDisplayMode | null } | null>(
    null,
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const saving = useRef(false);
  const latestKey = useRef(key);
  const eventRevision = useRef(0);
  latestKey.current = key;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let revision = 0;
    const subscription = listen<SurfaceSession>("surface-session-changed", ({ payload }) => {
      if (!cancelled && payload.key === key) {
        revision++;
        eventRevision.current++;
        setSaved({ key, mode: payload.displayMode ?? null });
      }
    });
    // Subscribe before reading so a late initial read cannot overwrite a newer event.
    void subscription
      .then(async () => {
        const atRead = revision;
        const session = await getSurfaceSession(key);
        if (!cancelled && atRead === revision) setSaved({ key, mode: session.displayMode ?? null });
      })
      .catch(() => {
        if (!cancelled) setFailure({ key, message: "读取显示方式失败，请重试切换" });
      });
    return () => {
      cancelled = true;
      void subscription.then((dispose) => dispose()).catch(() => {});
    };
  }, [key]);
  const override = saved?.key === key ? saved.mode : null;
  const change = async (mode: MarkdownDisplayMode | null) => {
    if (!key || saving.current) return;
    saving.current = true;
    setPendingKey(key);
    setFailure(null);
    const atSave = eventRevision.current;
    try {
      await invoke("surface_display_mode_set", { key, mode });
      // A later broadcast (including another window's selection) is more
      // authoritative than this command's potentially delayed acknowledgment.
      if (latestKey.current === key && atSave === eventRevision.current) setSaved({ key, mode });
    } catch {
      setFailure({ key, message: "显示方式保存失败，请重试" });
    } finally {
      saving.current = false;
      setPendingKey(null);
    }
  };
  return {
    mode: override ?? defaultMode,
    followingDefault: override == null,
    pending: pendingKey === key && key !== null,
    error: failure?.key === key ? failure?.message : undefined,
    change,
  };
}
