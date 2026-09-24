import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createNote, getErrorMessage, getNote, listNotes, updateNote } from "../features/notes/api";
import {
  readLinkedDraft,
  readLinkedFile,
  saveLinkedFile,
  writeLinkedDraft,
  type LinkedContent,
} from "../features/linked/api";
import { useImagePaste } from "../features/images/useImagePaste";
import { useImageBaseDir } from "../features/images/useImageBaseDir";
import { reportInstallPreparation } from "../features/update/api";
import type { UpdateInstallPrepareRequest } from "../features/update/types";
import { showToast } from "./Toast";
import type { Note, NoteMetadata } from "../features/notes/types";
import { countNoteChars, metadataFromNote } from "../features/notes/noteUtils";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  animateCurrentWindowBounds,
  closeCurrentWindow,
  destroyCurrentWindow,
  getCurrentWindowBounds,
  recycleCurrentNotepad,
  showCurrentWindow,
  startCurrentWindowDrag,
  startCurrentWindowDragWithOffset,
  startCurrentWindowResize,
} from "../features/windows/controls";
import {
  getSurfaceSession,
  saveSurfaceSession,
  type SurfaceSession,
} from "../features/windows/surfaceSession";
import type { ResizeDirection } from "../features/windows/controls";
import { getConfig } from "../features/settings/api";
import {
  DEFAULT_TILE_COLOR,
  normalizeTileColor,
  resolveTileColor,
} from "../features/settings/tileColor";
import type { AppearanceConfig, ThemeOption, TileColorMode } from "../features/settings/types";
import { applyAppearance, resolveAppearance } from "../features/settings/theme";
import { applyNativeMaterial } from "../features/settings/nativeMaterial";
import {
  shouldEnterPadFromTileOnDoubleClick,
  shouldReturnToTileAfterManualSave,
  shouldSaveBeforeSwitchingToTile,
} from "../features/windows/noteSurfaceSavePolicy";
import {
  NOTE_SURFACE_ACTION_EVENT,
  surfaceActionFromEvent,
} from "../features/windows/surfaceActions";
import {
  NOTE_SURFACE_MODE_EVENT,
  getSurfaceTargetBounds,
  surfaceModeFromEvent,
} from "../features/windows/surfaceMode";
import type { NoteSurfaceMode } from "../features/windows/surfaceMode";
import {
  emitTileWindowUnpinned,
  tileSurfaceModeUnpinNoteId,
} from "../features/windows/tileWindowEvents";
import { NotepadOpenPanel } from "./NotepadOpenPanel";
import { Tile } from "./Tile";
import { toggleTaskMarker } from "../features/markdown/taskMarker";
import { markdownImageDirectory } from "../features/markdown/imageSrc";
import { continueMarkdownList } from "../features/markdown/listEnter";

type OpenMode = "new" | "open";
type NotePadStatus = "empty" | "opened" | "saved" | "dirty" | "saveFailed" | "copied";

interface NotePadProps {
  initialNoteId?: string;
  initialBindingId?: string;
  initialSurfaceMode?: NoteSurfaceMode;
  initialAutoSave?: boolean;
  initialTileColor?: string;
}

const surfaceResizeHandles: Array<{
  direction: ResizeDirection;
  className: string;
  size: string;
}> = [
  {
    direction: "NorthWest",
    size: "w-8 h-8",
    className: "top-0 left-0 cursor-nwse-resize",
  },
  {
    direction: "NorthEast",
    size: "w-5 h-5",
    className: "top-0 right-0 cursor-nesw-resize",
  },
  {
    direction: "SouthWest",
    size: "w-8 h-8",
    className: "bottom-0 left-0 cursor-nesw-resize",
  },
  {
    direction: "SouthEast",
    size: "w-5 h-5",
    className: "bottom-0 right-0 cursor-nwse-resize",
  },
];

function isTileControlDoubleClickTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button,input,textarea,select,a,[data-surface-resize-handle="true"]'))
  );
}

const TILE_DRAG_START_THRESHOLD_PX = 5;

function SurfaceResizeHandles() {
  return (
    <>
      {surfaceResizeHandles.map((handle) => (
        <div
          key={handle.direction}
          aria-hidden="true"
          data-surface-resize-handle="true"
          data-resize-direction={handle.direction}
          onMouseDown={(event) => {
            event.stopPropagation();
            void startCurrentWindowResize(handle.direction).catch(() => undefined);
          }}
          className={`absolute ${handle.size} opacity-0 ${handle.className}`}
        />
      ))}
    </>
  );
}

export function NotePad({
  initialNoteId,
  initialBindingId,
  initialSurfaceMode = "pad",
  initialAutoSave = true,
  initialTileColor = DEFAULT_TILE_COLOR,
}: NotePadProps) {
  const { t } = useTranslation();
  const [surfaceMode, setSurfaceMode] = useState<NoteSurfaceMode>(initialSurfaceMode);
  const [tileWriting, setTileWriting] = useState(false);
  const [tileLocked, setTileLocked] = useState(false);
  const [desktopAttached, setDesktopAttached] = useState(false);
  const [mode, setMode] = useState<OpenMode>("new");
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const linkedRevisionRef = useRef("");
  const linkedClosingRef = useRef(false);
  const [linkedConflict, setLinkedConflict] = useState<LinkedContent | null>(null);
  const [linkedImageScope, setLinkedImageScope] = useState<{
    baseDir: string;
    rootDir: string;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<NotePadStatus>("empty");
  const [noteSurfaceAutoSave, setNoteSurfaceAutoSave] = useState(initialAutoSave);
  const [tileColorRaw, setTileColorRaw] = useState(normalizeTileColor(initialTileColor));
  const [tileColorMode, setTileColorMode] = useState<TileColorMode>("system");
  const [surfaceFontSize, setSurfaceFontSize] = useState(14);
  const [appearanceConfig, setAppearanceConfig] = useState<AppearanceConfig | undefined>();
  const [appearanceTheme, setAppearanceTheme] = useState<ThemeOption>("system");
  const [tileRenderMarkdown, setTileRenderMarkdown] = useState(false);
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [tileDoubleClickToEdit, setTileDoubleClickToEdit] = useState(false);
  const [tileSaveReturnsToPin, setTileSaveReturnsToPin] = useState(false);
  const [tileColor, setTileColor] = useState(() =>
    resolveTileColor("system", normalizeTileColor(initialTileColor)),
  );
  const [isExiting, setIsExiting] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const tileContentRef = useRef<HTMLTextAreaElement>(null);
  const tileDragIntentRef = useRef<{ x: number; y: number } | null>(null);
  const windowLabelRef = useRef("");
  const statusRef = useRef<NotePadStatus>("empty");
  const contentValueRef = useRef(content);
  contentValueRef.current = content;
  const titleValueRef = useRef(title);
  titleValueRef.current = title;
  const tileColorModeRef = useRef(tileColorMode);
  tileColorModeRef.current = tileColorMode;
  const tileColorRawRef = useRef(tileColorRaw);
  tileColorRawRef.current = tileColorRaw;
  const isStandby = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("standby") === "1",
  );
  // 窗口位于池中（standby 预热或已回收隐藏）时为 true：
  // 休眠期间跳过笔记列表拉取，激活时统一刷新
  const dormantRef = useRef(isStandby.current);
  const hasEnteredOnce = useRef(false);
  const statusLabel = useMemo<Record<NotePadStatus, string>>(
    () => ({
      empty: t("notepad.status.empty", { defaultValue: "空" }),
      opened: t("notepad.status.opened", { defaultValue: "已打开" }),
      saved: t("notepad.status.saved", { defaultValue: "已保存" }),
      dirty: t("notepad.status.unsaved", { defaultValue: "未保存" }),
      saveFailed: t("notepad.status.saveFailed", { defaultValue: "保存失败" }),
      copied: t("notepad.status.copied", { defaultValue: "已复制" }),
    }),
    [t],
  );
  const tabLabels = useMemo(
    () => ({
      new: t("notepad.tab.new", { defaultValue: "新建" }),
      edit: t("notepad.tab.edit", { defaultValue: "编辑" }),
      open: t("notepad.tab.open", { defaultValue: "打开" }),
    }),
    [t],
  );
  statusRef.current = status;

  const refreshNotes = useCallback(async () => {
    // 池中休眠的窗口不拉取笔记列表，激活时会统一刷新
    if (dormantRef.current) return [] as NoteMetadata[];
    const loadedNotes = await listNotes();
    setNotes(loadedNotes);
    return loadedNotes;
  }, []);

  const applyNote = useCallback((note: Note) => {
    setEditingNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setMode("new");
    setStatus("opened");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [loadedConfig] = await Promise.all([getConfig(), refreshNotes()]);
        if (!cancelled) {
          setNoteSurfaceAutoSave(loadedConfig.noteSurfaceAutoSave);
          setSurfaceFontSize(loadedConfig.surfaceFontSize ?? 14);
          setAppearanceConfig(loadedConfig.appearance);
          setAppearanceTheme(loadedConfig.theme);
          setTileRenderMarkdown(loadedConfig.tileRenderMarkdown ?? false);
          setAllowRemoteImages(loadedConfig.allowRemoteImages ?? false);
          setTileDoubleClickToEdit(loadedConfig.tileDoubleClickToEdit ?? false);
          setTileSaveReturnsToPin(loadedConfig.tileSaveReturnsToPin ?? false);
          setTileColorRaw(normalizeTileColor(loadedConfig.tileColor));
          setTileColorMode(loadedConfig.tileColorMode ?? "system");
          setTileColor(
            resolveTileColor(loadedConfig.tileColorMode ?? "system", loadedConfig.tileColor),
          );
        }
        if (initialBindingId) {
          const [linked, draft] = await Promise.all([
            readLinkedFile(initialBindingId),
            readLinkedDraft(initialBindingId),
          ]);
          if (!cancelled) {
            const recovered = draft?.content != null && draft.content !== linked.content;
            linkedRevisionRef.current = recovered ? draft.baseRevision : linked.revision;
            setLinkedImageScope({
              baseDir: markdownImageDirectory(linked.binding.path),
              rootDir: linked.imageRoot,
            });
            setTitle(
              linked.binding.path
                .split(/[\\/]/)
                .pop()
                ?.replace(/\.(md|markdown)$/i, "") ?? "",
            );
            setContent(recovered ? draft.content! : linked.content);
            setStatus(recovered ? "dirty" : "opened");
            if (recovered && draft.baseRevision !== linked.revision) setLinkedConflict(linked);
          }
        } else if (initialNoteId) {
          const note = await getNote(initialNoteId);
          if (!cancelled) applyNote(note);
        }
      } catch (error) {
        if (!cancelled) showToast(getErrorMessage(error));
      } finally {
        if (!cancelled) setBootstrapReady(true);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, initialBindingId, initialNoteId, refreshNotes]);

  useEffect(() => {
    if (!initialBindingId || status !== "dirty") return undefined;
    const timer = window.setTimeout(() => {
      void writeLinkedDraft(initialBindingId, content, linkedRevisionRef.current).catch((error) =>
        showToast(getErrorMessage(error)),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [content, initialBindingId, status]);

  useEffect(() => {
    if (!initialBindingId) return undefined;
    let active = true;
    const refresh = () => {
      void readLinkedFile(initialBindingId)
        .then((latest) => {
          if (!active || latest.revision === linkedRevisionRef.current) return;
          if (statusRef.current === "dirty" || statusRef.current === "saveFailed") {
            setLinkedConflict(latest);
            return;
          }
          // 只有干净的窗口才自动刷新；用户输入中的正文始终留在本地。
          linkedRevisionRef.current = latest.revision;
          setContent(latest.content);
          setStatus("opened");
        })
        .catch((error) => {
          if (active) showToast(getErrorMessage(error));
        });
    };
    const unlisten = listen<{ bindingId: string; revision: string }>(
      "linked-content-changed",
      (event) => {
        if (event.payload.bindingId === initialBindingId) refresh();
      },
    );
    const unavailable = listen<string>("linked-file-unavailable", (event) => {
      if (event.payload === initialBindingId)
        showToast("原文件暂不可用，当前内容已保留", "warning");
    });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      void unlisten.then((fn) => fn());
      void unavailable.then((fn) => fn());
    };
  }, [initialBindingId]);

  useEffect(() => {
    const unlisten = listen("notes-changed", () => {
      void refreshNotes().catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  useEffect(() => {
    if (isStandby.current) return;
    if (hasEnteredOnce.current) return;
    const silentRestore = new URLSearchParams(window.location.search).has("silentRestore");
    if (silentRestore && !bootstrapReady) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          hasEnteredOnce.current = true;
          void (async () => {
            const key = initialBindingId
              ? `linked:${initialBindingId}`
              : initialNoteId
                ? `note:${initialNoteId}`
                : null;
            const session = key ? await getSurfaceSession(key).catch(() => null) : null;
            const attached = session?.windowMode === "desktopAttached";
            setDesktopAttached(attached);
            setTileLocked(session?.locked ?? false);
            document.documentElement.setAttribute(
              "data-desktop-attached",
              String(attached && !session?.locked),
            );
            if (silentRestore || attached || session?.locked) {
              await invoke("show_silent_surface");
            } else {
              await showCurrentWindow();
              contentRef.current?.focus();
            }
          })().catch(() => undefined);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrapReady, initialBindingId, initialNoteId]);

  useEffect(() => {
    const ownKey = initialBindingId
      ? `linked:${initialBindingId}`
      : (editingNoteId ?? initialNoteId)
        ? `note:${editingNoteId ?? initialNoteId}`
        : null;
    if (!ownKey) return undefined;
    const unlisten = listen<SurfaceSession>("surface-session-changed", (event) => {
      if (event.payload.key !== ownKey) return;
      setDesktopAttached(event.payload.windowMode === "desktopAttached");
      setTileLocked(event.payload.locked);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [editingNoteId, initialBindingId, initialNoteId]);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-desktop-attached",
      String(desktopAttached && !tileLocked && !tileWriting),
    );
  }, [desktopAttached, tileLocked, tileWriting]);

  useEffect(() => {
    if (!initialNoteId && !initialBindingId) return;
    const current = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void invoke("surface_bounds_save").catch(() => undefined);
      }, 500);
    };
    const moved = current.onMoved(save);
    const resized = current.onResized(save);
    return () => {
      clearTimeout(timer);
      void moved.then((off) => off());
      void resized.then((off) => off());
    };
  }, [initialNoteId, initialBindingId]);

  useEffect(() => {
    const unlisten = listen<{
      tileColor?: string;
      tileColorMode?: TileColorMode;
      surfaceFontSize?: number;
      appearance?: AppearanceConfig;
      theme?: ThemeOption;
      tileRenderMarkdown?: boolean;
      allowRemoteImages?: boolean;
      tileDoubleClickToEdit?: boolean;
      tileSaveReturnsToPin?: boolean;
    }>("config-changed", (event) => {
      const mode = event.payload.tileColorMode ?? tileColorModeRef.current;
      const raw = event.payload.tileColor ?? tileColorRawRef.current;
      setTileColorMode(mode);
      setTileColorRaw(normalizeTileColor(raw));
      setTileColor(resolveTileColor(mode, raw));
      if (event.payload.surfaceFontSize != null) setSurfaceFontSize(event.payload.surfaceFontSize);
      setAppearanceConfig(event.payload.appearance);
      if (event.payload.theme) setAppearanceTheme(event.payload.theme);
      if (event.payload.tileRenderMarkdown != null)
        setTileRenderMarkdown(event.payload.tileRenderMarkdown);
      if (event.payload.allowRemoteImages != null)
        setAllowRemoteImages(event.payload.allowRemoteImages);
      if (event.payload.tileDoubleClickToEdit != null)
        setTileDoubleClickToEdit(event.payload.tileDoubleClickToEdit);
      if (event.payload.tileSaveReturnsToPin != null)
        setTileSaveReturnsToPin(event.payload.tileSaveReturnsToPin);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const noteId = initialBindingId ? `linked:${initialBindingId}` : (editingNoteId ?? undefined);
    applyAppearance(appearanceTheme, appearanceConfig, noteId);
    void applyNativeMaterial(
      appearanceConfig?.nativeMaterial ?? false,
      resolveAppearance(appearanceTheme, appearanceConfig, noteId).radius,
      true,
    );
  }, [
    appearanceTheme,
    appearanceConfig,
    editingNoteId,
    initialBindingId,
    desktopAttached,
    tileLocked,
    tileWriting,
  ]);

  useEffect(() => {
    if (tileColorMode !== "system") return;
    const observer = new MutationObserver(() => {
      setTileColor(resolveTileColor("system", tileColorRaw));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => observer.disconnect();
  }, [tileColorMode, tileColorRaw]);

  useEffect(() => {
    let myLabel = "";
    try {
      myLabel = getCurrentWindow().label;
      windowLabelRef.current = myLabel;
    } catch {
      // not in Tauri environment (tests)
    }

    const unlisten = listen<string>("notepad:activate", (event) => {
      if (event.payload !== myLabel) return;

      isStandby.current = false;
      dormantRef.current = false;
      hasEnteredOnce.current = true;
      setEditingNoteId(null);
      setTitle("");
      setContent("");
      setMode("new");
      setStatus("empty");
      setIsExiting(false);
      setSurfaceMode("pad");
      void refreshNotes().catch(() => undefined);
      void showCurrentWindow()
        .then(() => contentRef.current?.focus())
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refreshNotes]);

  const saveNote = useCallback(async () => {
    if (initialBindingId) {
      const contentSnapshot = content;
      const nextRevision = await saveLinkedFile(
        initialBindingId,
        contentSnapshot,
        linkedRevisionRef.current,
      );
      linkedRevisionRef.current = nextRevision;
      void writeLinkedDraft(initialBindingId, null, nextRevision).catch(() => undefined);
      setLinkedConflict(null);
      setStatus(contentValueRef.current === contentSnapshot ? "saved" : "dirty");
      return { id: initialBindingId };
    }
    const existingCategory = notes.find((n) => n.id === editingNoteId)?.category ?? "";
    const request = { title, content, category: existingCategory };
    const note = editingNoteId
      ? await updateNote(editingNoteId, request)
      : await createNote(request);

    setEditingNoteId(note.id);
    setNotes((current) => {
      const metadata = metadataFromNote(note);
      const exists = current.some((item) => item.id === note.id);
      const next = exists
        ? current.map((item) => (item.id === note.id ? metadata : item))
        : [metadata, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
    const contentChanged = contentValueRef.current !== content || titleValueRef.current !== title;
    setStatus(contentChanged ? "dirty" : "saved");
    return note;
  }, [content, editingNoteId, initialBindingId, notes, title]);

  // 通过 ref 持有最新的 saveNote，让下方的 Tauri 监听只注册一次，
  // 避免每次输入（content 变化）都注销再重注册事件监听
  const saveNoteRef = useRef(saveNote);
  saveNoteRef.current = saveNote;

  const closeLinkedWindow = useCallback(async () => {
    if (!initialBindingId || linkedClosingRef.current) return;
    linkedClosingRef.current = true;
    try {
      if (statusRef.current === "dirty") await saveNoteRef.current();
      // 外部文件窗口必须销毁原生窗口；close() 会再次触发关闭监听，失败时还会留下透明遮挡层。
      await invoke("surface_session_close_current");
      await destroyCurrentWindow();
    } catch (error) {
      linkedClosingRef.current = false;
      setStatus("saveFailed");
      showToast(getErrorMessage(error));
    }
  }, [initialBindingId]);

  useEffect(() => {
    if (!initialBindingId) return undefined;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await closeLinkedWindow();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [closeLinkedWindow, initialBindingId]);

  useEffect(() => {
    const unlisten = listen<UpdateInstallPrepareRequest>("update://prepare-install", (event) => {
      const respond = async () => {
        const windowLabel = windowLabelRef.current || "notepad";
        if (statusRef.current !== "dirty") {
          await reportInstallPreparation(event.payload.requestId, windowLabel, "ready");
          return;
        }

        try {
          await saveNoteRef.current();
          await reportInstallPreparation(event.payload.requestId, windowLabel, "ready");
        } catch (error) {
          setStatus("saveFailed");
          showToast(getErrorMessage(error));
          await reportInstallPreparation(
            event.payload.requestId,
            windowLabel,
            "failed",
            getErrorMessage(error),
          );
        }
      };

      void respond().catch(async (error) => {
        await reportInstallPreparation(
          event.payload.requestId,
          windowLabelRef.current || "notepad",
          "failed",
          getErrorMessage(error),
        ).catch(() => undefined);
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const hasDraftContent = useCallback(
    () => Boolean(editingNoteId || title.trim() || content.trim()),
    [content, editingNoteId, title],
  );

  const imageBaseDir = useImageBaseDir();

  const ensureNoteSaved = useCallback(async (): Promise<string | null> => {
    if (editingNoteId) return editingNoteId;
    try {
      const note = await saveNote();
      return note.id;
    } catch {
      return null;
    }
  }, [editingNoteId, saveNote]);

  const {
    handlePaste: imagePasteHandler,
    handleDrop: imageDropHandler,
    handleDragOver: imageDragOverHandler,
  } = useImagePaste({
    noteId: editingNoteId,
    textareaRef: tileWriting ? tileContentRef : contentRef,
    setContent,
    markDirty: () => setStatus("dirty"),
    onEnsureNoteSaved: ensureNoteSaved,
    onError: showToast,
    t,
  });

  const tileNoteId = editingNoteId ?? initialBindingId ?? initialNoteId ?? "";

  const switchSurfaceMode = useCallback(
    async (nextMode: NoteSurfaceMode) => {
      const unpinnedNoteId = tileSurfaceModeUnpinNoteId(surfaceMode, nextMode, tileNoteId);
      try {
        // 桌面子窗口使用父窗口坐标；编辑前先脱离，回到磁贴后再附着。
        if (nextMode === "pad") await invoke("surface_edit_mode", { editing: true });
        const currentBounds = await getCurrentWindowBounds();
        const targetBounds = getSurfaceTargetBounds(nextMode, currentBounds);
        await animateCurrentWindowBounds(targetBounds);
        if (nextMode === "tile") await invoke("surface_edit_mode", { editing: false });
        setSurfaceMode(nextMode);
        if (unpinnedNoteId) {
          void emitTileWindowUnpinned(unpinnedNoteId).catch(() => undefined);
        }
      } catch (error) {
        showToast(getErrorMessage(error));
      }
    },
    [surfaceMode, tileNoteId],
  );

  useEffect(() => {
    function handleSurfaceModeRequest(event: Event) {
      const nextMode = surfaceModeFromEvent(event);
      if (!nextMode) return;
      void switchSurfaceMode(nextMode);
    }

    window.addEventListener(NOTE_SURFACE_MODE_EVENT, handleSurfaceModeRequest);
    return () => {
      window.removeEventListener(NOTE_SURFACE_MODE_EVENT, handleSurfaceModeRequest);
    };
  }, [switchSurfaceMode]);

  const handleSave = useCallback(
    async ({ isAutoSave = false }: { isAutoSave?: boolean } = {}) => {
      try {
        const savedNote = await saveNote();
        const key = initialBindingId ? `linked:${initialBindingId}` : `note:${savedNote.id}`;
        const desktopAttached =
          !isAutoSave &&
          (await getSurfaceSession(key).catch(() => null))?.windowMode === "desktopAttached";
        if (
          shouldReturnToTileAfterManualSave({
            enabled: tileSaveReturnsToPin || desktopAttached,
            noteId: savedNote.id,
            currentMode: surfaceMode,
            isAutoSave,
          })
        ) {
          await switchSurfaceMode("tile");
        }
      } catch (error) {
        setStatus("saveFailed");
        if (initialBindingId) {
          void readLinkedFile(initialBindingId)
            .then(setLinkedConflict)
            .catch(() => undefined);
        }
        showToast(getErrorMessage(error));
      }
    },
    [initialBindingId, saveNote, surfaceMode, switchSurfaceMode, tileSaveReturnsToPin],
  );

  // 全局监听（Ctrl+S、表面动作）只注册一次，通过 ref 取最新回调，
  // 避免回调依赖 content 导致每次输入都重绑监听
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const clearPendingTileDrag = useCallback(() => {
    tileDragIntentRef.current = null;
  }, []);

  const startTileWriting = useCallback(async () => {
    if (tileLocked || tileWriting) return;
    try {
      await invoke("surface_edit_mode", { editing: true });
      setTileWriting(true);
      requestAnimationFrame(() => tileContentRef.current?.focus());
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  }, [tileLocked, tileWriting]);

  const finishTileWriting = useCallback(async () => {
    if (!tileWriting) return;
    try {
      await saveNote();
      await invoke("surface_edit_mode", { editing: false });
      setTileWriting(false);
    } catch (error) {
      setStatus("saveFailed");
      showToast(getErrorMessage(error));
    }
  }, [saveNote, tileWriting]);

  const lockTile = useCallback(async () => {
    const key = initialBindingId
      ? `linked:${initialBindingId}`
      : `note:${editingNoteId ?? initialNoteId ?? ""}`;
    try {
      if (statusRef.current === "dirty") await saveNote();
      const session = await getSurfaceSession(key);
      await saveSurfaceSession({ ...session, locked: true });
      setTileWriting(false);
      setTileLocked(true);
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  }, [editingNoteId, initialBindingId, initialNoteId, saveNote]);

  useEffect(() => clearPendingTileDrag, [clearPendingTileDrag]);

  useEffect(() => {
    if (surfaceMode !== "tile" || !tileDoubleClickToEdit) {
      clearPendingTileDrag();
      return undefined;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const intent = tileDragIntentRef.current;
      if (!intent) return;
      // Pointer left the window during a missed mouseup, etc. — drop the stale intent.
      if ((event.buttons & 1) === 0) {
        clearPendingTileDrag();
        return;
      }

      const distanceX = event.screenX - intent.x;
      const distanceY = event.screenY - intent.y;
      const distance = Math.hypot(distanceX, distanceY);
      if (distance < TILE_DRAG_START_THRESHOLD_PX) return;

      tileDragIntentRef.current = null;
      // Compensate for the deadzone drift before handing off to the OS drag.
      void startCurrentWindowDragWithOffset(distanceX, distanceY).catch(() => undefined);
    };

    const handleMouseUp = () => clearPendingTileDrag();

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [clearPendingTileDrag, surfaceMode, tileDoubleClickToEdit]);

  const handleTileDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (
        !shouldEnterPadFromTileOnDoubleClick(
          tileDoubleClickToEdit,
          isTileControlDoubleClickTarget(event.target),
        )
      ) {
        return;
      }

      clearPendingTileDrag();
      event.preventDefault();
      event.stopPropagation();
      void startTileWriting();
    },
    [clearPendingTileDrag, startTileWriting, tileDoubleClickToEdit],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void handleSaveRef.current();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleOpenNote = async (noteId: string) => {
    try {
      const note = await getNote(noteId);
      applyNote(note);
      await switchSurfaceMode("pad");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handlePin = async () => {
    try {
      if (shouldSaveBeforeSwitchingToTile(noteSurfaceAutoSave) || !editingNoteId) {
        await saveNote();
      }
      await switchSurfaceMode("tile");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  };

  const handleClose = useCallback(() => {
    if (initialBindingId) {
      void closeLinkedWindow();
      return;
    }
    setIsExiting(true);
    if (surfaceMode === "tile") {
      void (async () => {
        await closeCurrentWindow();
      })().catch((error) => {
        setIsExiting(false);
        setStatus("saveFailed");
        showToast(getErrorMessage(error));
      });
      return;
    }

    // 回收进窗口池：窗口只是被隐藏，立刻清空编辑器状态并进入休眠，
    // 避免上一篇笔记全文和笔记列表驻留在隐藏窗口的内存里
    dormantRef.current = true;
    void recycleCurrentNotepad()
      .then(() => {
        setEditingNoteId(null);
        setTitle("");
        setContent("");
        setNotes([]);
        setMode("new");
        setStatus("empty");
        setIsExiting(false);
      })
      .catch((error) => {
        dormantRef.current = false;
        setIsExiting(false);
        showToast(getErrorMessage(error));
      });
  }, [closeLinkedWindow, initialBindingId, surfaceMode]);

  const copyTileContent = useCallback(async () => {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        throw new Error(t("notepad.error.copyUnsupported", { defaultValue: "当前环境不支持复制" }));
      }
      await clipboard.writeText(content);
      setStatus("copied");
    } catch (error) {
      showToast(getErrorMessage(error));
    }
  }, [content, t]);

  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  const copyTileContentRef = useRef(copyTileContent);
  copyTileContentRef.current = copyTileContent;
  const startTileWritingRef = useRef(startTileWriting);
  startTileWritingRef.current = startTileWriting;

  useEffect(() => {
    function handleSurfaceActionRequest(event: Event) {
      const action = surfaceActionFromEvent(event);
      if (!action) return;

      if (action === "copy") {
        void copyTileContentRef.current();
        return;
      }

      if (action === "save") {
        void handleSaveRef.current();
        return;
      }

      if (action === "close") {
        void handleCloseRef.current();
        return;
      }

      void startTileWritingRef.current();
    }

    window.addEventListener(NOTE_SURFACE_ACTION_EVENT, handleSurfaceActionRequest);
    return () => {
      window.removeEventListener(NOTE_SURFACE_ACTION_EVENT, handleSurfaceActionRequest);
    };
  }, []);

  useEffect(() => {
    if (!noteSurfaceAutoSave || mode !== "new" || status !== "dirty") {
      return undefined;
    }
    if (!hasDraftContent()) return undefined;

    const timer = window.setTimeout(() => {
      void handleSave({ isAutoSave: true });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [handleSave, hasDraftContent, mode, noteSurfaceAutoSave, status]);

  const handleDrag = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea")) return;

    if (surfaceMode === "tile" && tileDoubleClickToEdit) {
      if (event.button !== 0 || event.detail > 1) return;
      clearPendingTileDrag();
      tileDragIntentRef.current = {
        x: event.screenX,
        y: event.screenY,
      };
      return;
    }

    void startCurrentWindowDrag().catch(() => undefined);
  };

  const resetDraft = () => {
    if (initialBindingId) return;
    setEditingNoteId(null);
    setTitle("");
    setContent("");
    setMode("new");
    setStatus("empty");
  };

  const isTile = surfaceMode === "tile";
  const appearanceNoteId = initialBindingId
    ? `linked:${initialBindingId}`
    : (editingNoteId ?? undefined);
  const displayFontSize =
    (appearanceNoteId ? appearanceConfig?.notes?.[appearanceNoteId]?.fontSize : undefined) ??
    appearanceConfig?.global?.fontSize ??
    surfaceFontSize;
  const tileTitle = title.trim();
  const enterClass = hasEnteredOnce.current ? "" : "animate-window-enter";
  const surfaceWrapperClassName = `w-full h-screen flex flex-col bg-transparent p-0 ${isExiting ? "animate-window-exit" : enterClass}`;
  const padSurfaceClassName =
    "app-surface-frame relative noise-bg w-full h-full min-h-0 bg-cloud overflow-hidden flex flex-col flex-1 border border-paper-deep/70 shadow-[0_1px_10px_rgba(26,26,24,0.06)] transition-all duration-200 ease-out";

  return (
    <div className={surfaceWrapperClassName}>
      {isTile ? (
        <Tile
          title={tileTitle || undefined}
          content={content}
          color={tileColor}
          fontSize={displayFontSize}
          renderMarkdown={tileRenderMarkdown}
          imageBaseDir={linkedImageScope?.baseDir ?? imageBaseDir ?? undefined}
          imageRootDir={linkedImageScope?.rootDir}
          allowRemoteImages={allowRemoteImages}
          onTaskToggle={(offset, checked) => {
            const next = toggleTaskMarker(contentValueRef.current, offset, checked);
            if (next == null) return;
            contentValueRef.current = next;
            setContent(next);
            statusRef.current = "dirty";
            setStatus("dirty");
          }}
          editing={tileWriting}
          titleEditable={!initialBindingId}
          onTitleChange={(value) => {
            titleValueRef.current = value;
            setTitle(value);
            setStatus("dirty");
          }}
          onContentChange={(value) => {
            contentValueRef.current = value;
            setContent(value);
            setStatus("dirty");
          }}
          contentEditorRef={tileContentRef}
          onEditorPaste={imagePasteHandler}
          onEditorDrop={imageDropHandler}
          onEditorDragOver={imageDragOverHandler}
          width="100%"
          className="h-full cursor-default"
          data-surface-mode={surfaceMode}
          data-context-menu="tile"
          data-note-id={tileNoteId}
          onMouseDown={handleDrag}
          onDoubleClick={handleTileDoubleClick}
        >
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <button
              type="button"
              aria-label={tileWriting ? "保存并切换阅读模式" : "切换写作模式"}
              title={tileWriting ? "保存并切换阅读模式" : "切换写作模式"}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void (tileWriting ? finishTileWriting() : startTileWriting())}
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink-ghost/70 hover:text-ink hover:bg-paper-warm/80 transition-colors cursor-pointer"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {tileWriting ? (
                  <path d="M4 19h16M6 5h12v10H6zM9 5v5h6" />
                ) : (
                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4z" />
                )}
              </svg>
            </button>
            <button
              type="button"
              aria-label="锁定便签并允许鼠标穿透"
              title="锁定便签；从主界面解锁"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void lockTile()}
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink-ghost/70 hover:text-ink hover:bg-paper-warm/80 transition-colors cursor-pointer"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="10" width="14" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="取消钉屏"
              title="取消钉屏"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() =>
                void (async () => {
                  try {
                    if (tileWriting && statusRef.current === "dirty") await saveNote();
                    handleClose();
                  } catch (error) {
                    showToast(getErrorMessage(error));
                  }
                })()
              }
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink-ghost/70 hover:text-red-400 hover:bg-danger-bg/80 transition-colors cursor-pointer"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <SurfaceResizeHandles />
        </Tile>
      ) : (
        <div className={padSurfaceClassName} data-surface-mode={surfaceMode}>
          <>
            <div
              className="flex items-center justify-between px-4 pt-3 pb-0 cursor-default"
              onMouseDown={handleDrag}
            >
              <div className="flex items-center gap-0.5">
                <button
                  onClick={resetDraft}
                  disabled={Boolean(initialBindingId)}
                  className={`relative px-3.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${
                    mode === "new"
                      ? "text-bamboo font-medium"
                      : "text-ink-ghost hover:text-ink-faint"
                  }`}
                >
                  {editingNoteId ? tabLabels.edit : tabLabels.new}
                  {mode === "new" && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />
                  )}
                </button>
                <button
                  onClick={() => setMode("open")}
                  disabled={Boolean(initialBindingId)}
                  className={`relative px-3.5 py-1.5 text-[13px] rounded-t-lg transition-all duration-200 cursor-pointer ${
                    mode === "open"
                      ? "text-bamboo font-medium"
                      : "text-ink-ghost hover:text-ink-faint"
                  }`}
                >
                  {tabLabels.open}
                  {mode === "open" && (
                    <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-bamboo rounded-full" />
                  )}
                </button>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => void handlePin()}
                  className="group w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
                  title={t("notepad.tooltip.pinToTile", { defaultValue: "转为磁贴" })}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                  </svg>
                </button>

                <button
                  onClick={() => void handleClose()}
                  className="group w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:bg-danger-bg hover:text-red-400 transition-all duration-200 cursor-pointer"
                  title={t("notepad.tooltip.close", { defaultValue: "关闭" })}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mx-4 mt-1 h-px bg-paper-deep/50" />

            {mode === "new" ? (
              <div
                data-pad-editor-body="true"
                className="px-4 pt-3 pb-2 flex flex-col flex-1 min-h-0"
              >
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  readOnly={Boolean(initialBindingId)}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setStatus("dirty");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "ArrowDown") {
                      event.preventDefault();
                      contentRef.current?.focus();
                    }
                  }}
                  placeholder={t("notepad.placeholder.title", { defaultValue: "标题（可选）" })}
                  className="w-full font-display font-medium text-ink placeholder:text-ink-ghost/60 mb-2 tracking-wide shrink-0"
                  style={{ fontSize: `${displayFontSize}px` }}
                />

                <textarea
                  ref={contentRef}
                  data-tab-indent="true"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setStatus("dirty");
                  }}
                  onPaste={imagePasteHandler}
                  onDrop={imageDropHandler}
                  onDragOver={imageDragOverHandler}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                      const key = event.key.toLowerCase();
                      const marker = key === "b" ? "**" : key === "i" ? "*" : null;
                      if (marker || key === "k") {
                        event.preventDefault();
                        const textarea = event.currentTarget;
                        const { selectionStart: start, selectionEnd: end } = textarea;
                        const selected = textarea.value.slice(start, end);
                        const label = selected || "文本";
                        const replacement =
                          key === "k" ? `[${label}](https://)` : `${marker}${label}${marker}`;
                        if (!document.execCommand("insertText", false, replacement)) {
                          textarea.setRangeText(replacement, start, end, "end");
                        }
                        contentValueRef.current = textarea.value;
                        setContent(textarea.value);
                        statusRef.current = "dirty";
                        setStatus("dirty");
                        const cursor =
                          key === "k" ? start + label.length + 3 : start + marker!.length;
                        requestAnimationFrame(() =>
                          textarea.setSelectionRange(
                            cursor,
                            cursor + (key === "k" ? "https://".length : label.length),
                          ),
                        );
                        return;
                      }
                    }
                    if (event.key === "Enter") {
                      const next = continueMarkdownList(
                        contentValueRef.current,
                        event.currentTarget.selectionStart,
                        event.currentTarget.selectionEnd,
                      );
                      if (next) {
                        event.preventDefault();
                        contentValueRef.current = next.content;
                        setContent(next.content);
                        statusRef.current = "dirty";
                        setStatus("dirty");
                        requestAnimationFrame(() =>
                          contentRef.current?.setSelectionRange(next.cursor, next.cursor),
                        );
                        return;
                      }
                    }
                    if (event.key === "ArrowUp") {
                      const ta = contentRef.current;
                      if (ta && ta.selectionStart === ta.selectionEnd) {
                        const textBeforeCursor = content.slice(0, ta.selectionStart);
                        if (!textBeforeCursor.includes("\n")) {
                          event.preventDefault();
                          titleRef.current?.focus();
                        }
                      }
                    }
                  }}
                  placeholder={t("notepad.placeholder.content", { defaultValue: "写点什么……" })}
                  className="w-full flex-1 min-h-0 pb-2 leading-relaxed text-ink-soft font-body placeholder:text-ink-ghost/50"
                  style={{
                    fontSize: `${displayFontSize}px`,
                    lineHeight: "var(--appearance-line-height)",
                    tabSize: `var(--tab-indent-size, 2)`,
                  }}
                />

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-paper-deep/30 shrink-0">
                  {linkedConflict && initialBindingId && (
                    <div className="flex items-center gap-2 text-[11px] text-red-600">
                      <span>原文件已变化</span>
                      <button
                        onClick={() => {
                          linkedRevisionRef.current = linkedConflict.revision;
                          setContent(linkedConflict.content);
                          setStatus("opened");
                          setLinkedConflict(null);
                          void writeLinkedDraft(
                            initialBindingId,
                            null,
                            linkedConflict.revision,
                          ).catch(() => undefined);
                        }}
                      >
                        载入磁盘
                      </button>
                      <button
                        onClick={() => {
                          void saveLinkedFile(
                            initialBindingId,
                            content,
                            linkedRevisionRef.current,
                            true,
                          )
                            .then((revision) => {
                              linkedRevisionRef.current = revision;
                              setLinkedConflict(null);
                              setStatus(contentValueRef.current === content ? "saved" : "dirty");
                              void writeLinkedDraft(initialBindingId, null, revision).catch(
                                () => undefined,
                              );
                            })
                            .catch((error) => showToast(getErrorMessage(error)));
                        }}
                      >
                        覆盖原文件
                      </button>
                      <button onClick={() => setLinkedConflict(null)}>保留草稿</button>
                    </div>
                  )}
                  <span className="text-[11px] text-ink-ghost font-mono tabular-nums truncate max-w-[170px]">
                    {`${countNoteChars(content)} ${t("common.wordCountUnit", { defaultValue: "字" })} · ${statusLabel[status]}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={resetDraft}
                      disabled={Boolean(initialBindingId)}
                      className="px-4 py-1.5 text-[12px] text-ink-faint hover:text-ink-soft rounded-lg hover:bg-paper-warm transition-all duration-200 cursor-pointer"
                    >
                      {t("notepad.button.clear", { defaultValue: "清空" })}
                    </button>
                    <button
                      onClick={() => void handleSave()}
                      className="px-4 py-1.5 text-[12px] text-cloud bg-bamboo hover:bg-bamboo-light rounded-lg transition-all duration-200 font-medium cursor-pointer"
                    >
                      {t("common.save", { defaultValue: "保存" })}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <NotepadOpenPanel
                notes={notes}
                onOpenNote={(noteId) => void handleOpenNote(noteId)}
              />
            )}
          </>
          <SurfaceResizeHandles />
        </div>
      )}
    </div>
  );
}
