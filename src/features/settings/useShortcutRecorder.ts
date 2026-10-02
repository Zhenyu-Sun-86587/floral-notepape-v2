import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Serialize native hook lifecycle across recorder instances and StrictMode cleanup.
let nativeRecordingQueue: Promise<void> = Promise.resolve();

interface UseShortcutRecorderOptions {
  onRecord: (shortcut: string) => void;
}

export interface ShortcutRecorderHandle {
  error: string;
  isRecording: boolean;
  heldKeys: string[];
  startRecording: () => void;
  cancelRecording: () => void;
}

interface HookKeyEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const MODIFIER_EVENT_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

const CODE_TO_KEY: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
};

function normalizeKey(key: string, code?: string): string {
  // macOS Option can produce Dead/Unicode characters; global shortcuts use physical keys.
  if (code && /^Key[A-Z]$/.test(code)) return code.slice(3);
  if (code && /^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code && CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  if (key === " ") return "Space";
  if (key.length === 1 && key.charCodeAt(0) < 0x20 && code) {
    return CODE_TO_KEY[code] ?? code;
  }
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function buildShortcutString(
  ctrl: boolean,
  alt: boolean,
  shift: boolean,
  meta: boolean,
  key: string,
): string {
  const parts: string[] = [];
  if (ctrl) parts.push("Control");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  if (meta) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

export function useShortcutRecorder({
  onRecord,
}: UseShortcutRecorderOptions): ShortcutRecorderHandle {
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;
  const [isRecording, setIsRecording] = useState(false);
  const [heldKeys, setHeldKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const recording = useRef(false);
  const stopNative = useRef<() => Promise<void>>(() => Promise.resolve());

  const finishRecording = useCallback((shortcut: string) => {
    if (!recording.current) return;
    recording.current = false;
    const onRecord = onRecordRef.current;
    const stopped = stopNative.current();
    setIsRecording(false);
    setHeldKeys([]);
    void stopped.then(() => onRecord(shortcut)).catch((cause) => setError(String(cause)));
  }, []);

  const cancelRecording = useCallback(() => {
    recording.current = false;
    setIsRecording(false);
    setHeldKeys([]);
  }, []);

  // DOM keydown handler — fallback when the system hook hasn't started yet
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (MODIFIER_EVENT_KEYS.has(e.key)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        cancelRecording();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        finishRecording("");
        return;
      }

      if (e.repeat || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finishRecording(
        buildShortcutString(
          e.ctrlKey,
          e.altKey,
          e.shiftKey,
          e.metaKey,
          normalizeKey(e.key, e.code),
        ),
      );
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, finishRecording, cancelRecording]);

  // System keyboard hook — unregisters app shortcuts & intercepts system shortcuts
  useEffect(() => {
    if (!isRecording) return;

    let cancelled = false;
    let started = false;
    let unlisten: (() => void) | null = null;
    let stopping: Promise<void> | null = null;
    const ready = nativeRecordingQueue
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        const dispose = await listen<HookKeyEvent>("shortcut-hook-key", (event) => {
          if (cancelled) return;
          const { key, ctrl, alt, shift, meta } = event.payload;
          if (key === "Escape") {
            cancelRecording();
            return;
          }
          if (key === "Delete" || key === "Backspace") {
            finishRecording("");
            return;
          }
          finishRecording(buildShortcutString(ctrl, alt, shift, meta, key));
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
        started = true;
        await invoke("start_shortcut_recording");
      });
    nativeRecordingQueue = ready;
    const stop = () => {
      cancelled = true;
      if (!stopping) {
        stopping = ready
          .catch((cause) => {
            setError(String(cause));
          })
          .then(async () => {
            unlisten?.();
            if (started) await invoke("stop_shortcut_recording");
          });
        nativeRecordingQueue = stopping;
      }
      return stopping;
    };
    stopNative.current = stop;
    void ready.catch((cause) => {
      setError(String(cause));
      recording.current = false;
      setIsRecording(false);
    });
    return () => {
      void stop().catch((cause) => setError(String(cause)));
    };
  }, [isRecording, finishRecording, cancelRecording]);

  // Real-time held-keys display (modifiers pass through the hook, so DOM events work)
  useEffect(() => {
    if (!isRecording) {
      setHeldKeys([]);
      return;
    }

    const pressed = new Set<string>();

    const toLabel = (e: KeyboardEvent): string => {
      if (MODIFIER_EVENT_KEYS.has(e.key)) return e.key;
      return normalizeKey(e.key, e.code);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      pressed.add(toLabel(e));
      setHeldKeys([...pressed]);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(toLabel(e));
      setHeldKeys([...pressed]);
    };
    const onBlur = () => {
      pressed.clear();
      setHeldKeys([]);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isRecording]);

  const startRecording = useCallback(() => {
    recording.current = true;
    setError("");
    setIsRecording(true);
  }, []);

  return { error, isRecording, heldKeys, startRecording, cancelRecording };
}
