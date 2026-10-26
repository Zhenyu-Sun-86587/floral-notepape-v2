import type { MarkdownDisplayMode } from "./displayMode";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { MarkdownPreview } from "./MarkdownPreview";
import { SourceEditor, type Props, type SourceEditorHandle } from "./SourceEditor";
import { renderedAnchorY, sourceOffsetAtPoint } from "./sourcePosition";

type Anchor = { offset: number; y: number };
interface SurfaceProps extends Props {
  displayMode?: MarkdownDisplayMode;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  activationGesture?: "click" | "doubleClick" | "none";
  imageBaseDir?: string;
  imageRootDir?: string;
  allowRemoteImages?: boolean;
}

/** 只协调两层的焦点与几何；正文写入始终通过常驻 EditorState。 */
export function MarkdownSurface(props: SurfaceProps) {
  const editor = useRef<SourceEditorHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const read = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(props.editing);
  const [composing, setComposing] = useState(false);
  const [displayMode, setDisplayMode] = useState(props.displayMode);
  useLayoutEffect(() => {
    if (!composing && !editor.current?.composing) setDisplayMode(props.displayMode);
  }, [props.displayMode, composing]);
  const directSource = displayMode === "source" || displayMode === "hybrid";
  const editorVisible = active || directSource;

  const [presentation, setPresentation] = useState("");
  const entering = useRef<Anchor | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const activeRef = useRef(active);
  activeRef.current = active;
  useImperativeHandle(
    props.editorRef,
    () => ({
      get value() {
        return editor.current?.value ?? "";
      },
      get selectionStart() {
        return editor.current?.selectionStart ?? 0;
      },
      get selectionEnd() {
        return editor.current?.selectionEnd ?? 0;
      },
      get view() {
        return editor.current?.view ?? null;
      },
      get composing() {
        return editor.current?.composing ?? false;
      },
      focus() {
        if (activeRef.current) editor.current?.focus();
        else latest.current.onActivate?.();
      },
      setSelectionRange(start, end) {
        editor.current?.setSelectionRange(start, end);
      },
      insertText(text) {
        editor.current?.insertText(text);
      },
      prepareInsertion() {
        return editor.current?.prepareInsertion?.() ?? { insert() {}, cancel() {} };
      },
      toggleTask(offset, checked) {
        editor.current?.toggleTask(offset, checked);
      },
    }),
    [],
  );
  const capture = useCallback(() => {
    const view = editor.current?.view;
    if (!view || !activeRef.current) return;
    const offset = view.state.selection.main.head;
    const y = view.coordsAtPos(offset)?.top;
    if (y != null) anchor.current = { offset, y };
  }, []);
  const deactivate = useCallback(() => {
    if (editor.current?.composing) return;
    capture();
    latest.current.onDeactivate?.();
  }, [capture]);
  const documentChanged = useCallback((value: string) => {
    // 这里只缓存派生快照，编辑期间不触发 Markdown/KaTeX/Mermaid 重渲染。
    if (!activeRef.current) setPresentation(value);
  }, []);
  const toggleTask = useCallback((offset: number, checked: boolean) => {
    editor.current?.toggleTask(offset, checked);
  }, []);

  useEffect(() => {
    if (!active) return;
    const leaveParkedToolbar = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        editor.current?.view?.hasFocus ||
        root.current?.contains(target) ||
        target.closest("button,input,select,[role=dialog],[role=menu]") ||
        document.querySelector('[role="dialog"],[role="menu"]')
      )
        return;
      deactivate();
    };
    document.addEventListener("pointerdown", leaveParkedToolbar);
    return () => document.removeEventListener("pointerdown", leaveParkedToolbar);
  }, [active, deactivate]);

  useLayoutEffect(() => {
    if (composing || editor.current?.composing || props.editing === active) return;
    if (!props.editing) {
      capture();
      setPresentation(editor.current?.value ?? "");
    }
    setActive(props.editing);
  }, [props.editing, active, composing, capture]);

  useLayoutEffect(() => {
    const handle = editor.current;
    const view = handle?.view;
    if (!view) return;
    let frame = 0;
    let measureFrame = 0;
    let cancelled = false;
    const scroll =
      latest.current.scrollContainerRef?.current ??
      root.current?.closest<HTMLElement>(".overflow-y-auto");
    const correct = (target: Anchor, y: number | null | undefined) => {
      if (!cancelled && scroll && y != null) scroll.scrollTop += y - target.y;
    };
    if (active) {
      // 空白便签没有可恢复的正文锚点，应从首行开始；已有正文仍保留点击位置。
      const empty = view.state.doc.length === 0;
      const target = empty ? null : (entering.current ?? anchor.current);
      if (empty) {
        handle.setSelectionRange(0, 0);
        anchor.current = null;
        if (scroll) scroll.scrollTop = 0;
      } else if (entering.current)
        handle.setSelectionRange(entering.current.offset, entering.current.offset);
      entering.current = null;
      view.focus();
      // 隐藏期间 CM 没有可见 viewport；先让目标源码进入 viewport，再按锚点校正。
      frame = requestAnimationFrame(() => {
        view.dispatch({ scrollIntoView: true });
        measureFrame = requestAnimationFrame(() => {
          view.requestMeasure({
            read: () => view.coordsAtPos(view.state.selection.main.head)?.top,
            write: (y) => {
              if (target) correct(target, y);
            },
          });
        });
      });
    } else if (!directSource) {
      frame = requestAnimationFrame(() => {
        if (anchor.current && read.current)
          correct(anchor.current, renderedAnchorY(read.current, anchor.current.offset));
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
    };
  }, [active]);

  // 图片和 Mermaid 可能在切回阅读后才完成布局；用户开始滚动后立即放弃自动校正。
  useEffect(() => {
    if (active || directSource || !read.current || !anchor.current) return;
    const layer = read.current;
    const scroll =
      latest.current.scrollContainerRef?.current ??
      root.current?.closest<HTMLElement>(".overflow-y-auto");
    let cancelled = false;
    const stop = () => {
      cancelled = true;
    };
    const observer = new ResizeObserver(() => {
      if (cancelled || activeRef.current || !anchor.current || !scroll) return;
      const y = renderedAnchorY(layer, anchor.current.offset);
      if (y != null) scroll.scrollTop += y - anchor.current.y;
    });
    observer.observe(layer);
    for (const event of ["wheel", "pointerdown", "keydown", "touchstart"])
      scroll?.addEventListener(event, stop, { passive: true });
    return () => {
      observer.disconnect();
      for (const event of ["wheel", "pointerdown", "keydown", "touchstart"])
        scroll?.removeEventListener(event, stop);
    };
  }, [active, directSource]);

  const activate = (event: MouseEvent<HTMLDivElement>) => {
    if (
      active ||
      props.locked ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("a,button,input,summary,[role=button]")
    )
      return;
    const selection = window.getSelection();
    // 双击会产生原生词语选区，不应阻止显式的双击编辑手势。
    if (
      props.activationGesture !== "doubleClick" &&
      ((directSource && !editor.current?.view?.state.selection.main.empty) ||
        (selection && !selection.isCollapsed && read.current?.contains(selection.anchorNode)))
    )
      return;
    // Widgets already mapped mousedown to their inner source range. CM's coarse
    // coordinate hit test would overwrite that with the replacement block's end.
    const offset = directSource
      ? (event.target as HTMLElement).closest(".cm-live-block,.cm-live-inline")
        ? (editor.current?.selectionStart ?? null)
        : (editor.current?.view?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? null)
      : read.current
        ? sourceOffsetAtPoint(
            read.current,
            event.clientX,
            event.clientY,
            event.target as HTMLElement,
          )
        : null;
    const caret = offset ?? editor.current?.selectionStart ?? 0;
    entering.current = {
      offset: caret,
      y: directSource
        ? (editor.current?.view?.coordsAtPos(caret)?.top ?? event.clientY)
        : read.current
          ? (renderedAnchorY(read.current, caret) ?? event.clientY)
          : event.clientY,
    };
    if (props.activationGesture === "doubleClick") {
      event.preventDefault();
      event.stopPropagation();
    }
    props.onActivate?.();
  };

  return (
    <div ref={root} className="markdown-surface" data-tile-selectable="true">
      <div
        ref={read}
        className={`markdown-read-layer ${editorVisible ? "is-inactive" : ""}`}
        inert={editorVisible}
        aria-hidden={editorVisible}
        onClick={(props.activationGesture ?? "click") === "click" ? activate : undefined}
        onDoubleClick={props.activationGesture === "doubleClick" ? activate : undefined}
      >
        {props.markdown ? (
          <MarkdownPreview
            content={presentation}
            fontSize={props.fontSize}
            sourceMapping
            imageBaseDir={props.imageBaseDir}
            imageRootDir={props.imageRootDir}
            allowRemoteImages={props.allowRemoteImages}
            onTaskToggle={props.locked ? undefined : (props.onReadTaskToggle ?? toggleTask)}
          />
        ) : (
          <div
            className="whitespace-pre-wrap"
            style={{ fontSize: props.fontSize }}
            data-source-start={0}
            data-source-end={presentation.length}
            data-source-text-start={0}
            data-source-text-end={presentation.length}
          >
            {presentation || " "}
          </div>
        )}
      </div>
      <div
        className={`markdown-edit-layer ${editorVisible ? "" : "is-inactive"}`}
        inert={!editorVisible}
        aria-hidden={!editorVisible}
        onClick={
          directSource && (props.activationGesture ?? "click") === "click" ? activate : undefined
        }
        onDoubleClick={
          directSource && props.activationGesture === "doubleClick" ? activate : undefined
        }
      >
        <SourceEditor
          {...props}
          editing={active}
          markdown={displayMode === "source" ? false : props.markdown}
          presentation={
            displayMode === "hybrid"
              ? "hybrid"
              : displayMode === "source"
                ? "source"
                : props.presentation
          }
          activateOnFocus={!directSource}
          editorRef={editor}
          onDeactivate={deactivate}
          onReadTaskToggle={props.onReadTaskToggle ?? toggleTask}
          onDocumentChange={documentChanged}
          onCompositionChange={setComposing}
          onBlurAnchor={capture}
        />
      </div>
    </div>
  );
}
