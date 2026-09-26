import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type HTMLAttributes,
} from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { openUrl } from "@tauri-apps/plugin-opener";
import { mathSyntax, sourceChange } from "./sourceDocument";
import { codeLanguages } from "./codeLanguages";
import { toggleTaskMarker } from "./taskMarker";
import "./sourceEditor.css";

// 保留标准语法分类和字重，但用便签语义色替换仅适合浅色主题的固定颜色。
const sourceHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) => ({
    ...spec,
    ...(spec.color ? { color: "var(--surface-accent, currentColor)" } : {}),
  })),
);

export interface SourceEditorHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly view: EditorView | null;
  readonly composing: boolean;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
  insertText(text: string): void;
  toggleTask(offset: number, checked: boolean): void;
}
export interface Props {
  content: string;
  editing: boolean;
  markdown: boolean;
  locked?: boolean;
  fontSize: number;
  editorRef?: Ref<SourceEditorHandle>;
  onChange?: (content: string) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onPaste?: HTMLAttributes<HTMLDivElement>["onPaste"];
  onDrop?: HTMLAttributes<HTMLDivElement>["onDrop"];
  onDragOver?: HTMLAttributes<HTMLDivElement>["onDragOver"];
}
interface SourceProps extends Props {
  onDocumentChange?: (value: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  onBlurAnchor?: () => void;
}

export function SourceEditor(props: SourceProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const access = useRef(new Compartment());
  const language = useRef(new Compartment());
  const composing = useRef(false);
  const [compositionRevision, setCompositionRevision] = useState(0);
  const syncExternal = useRef(() => {});
  useImperativeHandle(
    props.editorRef,
    () => ({
      get value() {
        return viewRef.current?.state.doc.toString() ?? "";
      },
      get selectionStart() {
        return viewRef.current?.state.selection.main.from ?? 0;
      },
      get selectionEnd() {
        return viewRef.current?.state.selection.main.to ?? 0;
      },
      get view() {
        return viewRef.current;
      },
      get composing() {
        return composing.current || !!viewRef.current?.composing;
      },
      focus() {
        viewRef.current?.focus();
      },
      setSelectionRange(start, end) {
        const view = viewRef.current;
        if (view && !composing.current && !view.composing)
          view.dispatch({
            selection: {
              anchor: Math.max(0, Math.min(start, view.state.doc.length)),
              head: Math.max(0, Math.min(end, view.state.doc.length)),
            },
          });
      },
      insertText(text) {
        const view = viewRef.current;
        if (view && !latest.current.locked)
          view.dispatch(view.state.replaceSelection(text), {
            userEvent: "input.paste",
            scrollIntoView: true,
          });
      },
      toggleTask(offset, checked) {
        const view = viewRef.current;
        if (!view || latest.current.locked || composing.current) return;
        if (toggleTaskMarker(view.state.doc.toString(), offset, checked) == null) return;
        view.dispatch({
          changes: { from: offset + 1, to: offset + 2, insert: checked ? "x" : " " },
          userEvent: "input.task",
        });
      },
    }),
    [],
  );
  useLayoutEffect(() => {
    if (!host.current) return;
    let frame = 0;
    let disposed = false;
    const wrap =
      (marker: string, link = false) =>
      (view: EditorView) => {
        if (view.state.readOnly) return false;
        const { from, to } = view.state.selection.main;
        const label = view.state.sliceDoc(from, to) || "文本";
        const text = link ? `[${label}](https://)` : `${marker}${label}${marker}`;
        const start = from + (link ? label.length + 3 : marker.length);
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: start, head: start + (link ? 8 : label.length) },
          userEvent: "input",
        });
        return true;
      };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.content,
        extensions: [
          language.current.of(
            latest.current.markdown
              ? markdown({ base: markdownLanguage, extensions: mathSyntax, codeLanguages })
              : [],
          ),
          syntaxHighlighting(sourceHighlightStyle, { fallback: true }),
          history(),
          EditorView.lineWrapping,
          access.current.of(
            EditorState.readOnly.of(!latest.current.editing || !!latest.current.locked),
          ),
          keymap.of([
            { key: "Mod-b", run: wrap("**") },
            { key: "Mod-i", run: wrap("*") },
            { key: "Mod-k", run: wrap("", true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": "便签正文",
            "data-source-editor": "true",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const value = update.state.doc.toString();
            if (
              !update.transactions.every(
                (tr) => tr.annotation(Transaction.userEvent) === "external",
              )
            )
              latest.current.onChange?.(value);
            latest.current.onDocumentChange?.(value);
          }),
          EditorView.domEventHandlers({
            mousedown(event, editor) {
              if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
              const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              let node = syntaxTree(editor.state).resolveInner(pos, 1);
              while (node.parent && !["Link", "Autolink", "URL"].includes(node.name))
                node = node.parent;
              const urlNode = node.name === "URL" ? node : node.getChild("URL");
              const url = urlNode ? editor.state.sliceDoc(urlNode.from, urlNode.to) : "";
              if (!/^https?:\/\//i.test(url)) return false;
              event.preventDefault();
              void openUrl(url);
              return true;
            },
            focus() {
              if (!latest.current.locked) latest.current.onActivate?.();
              return false;
            },
            blur(event) {
              latest.current.onBlurAnchor?.();
              const next = event.relatedTarget as HTMLElement | null;
              // 工具栏/对话框的焦点交接属于编辑会话；IME 临时失焦不结束会话。
              if (
                !composing.current &&
                !view.composing &&
                !next?.closest("button,input,[role=dialog],[role=menu]")
              )
                latest.current.onDeactivate?.();
              return false;
            },
            compositionstart() {
              composing.current = true;
              latest.current.onCompositionChange?.(true);
              return false;
            },
            compositionend() {
              const settle = () => {
                if (disposed) return;
                if (view.composing) {
                  frame = requestAnimationFrame(settle);
                  return;
                }
                composing.current = false;
                syncExternal.current();
                setCompositionRevision((value) => value + 1);
                latest.current.onCompositionChange?.(false);
              };
              frame = requestAnimationFrame(settle);
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    syncExternal.current = () => {
      if (composing.current || view.composing) return;
      const old = view.state.doc.toString();
      const incoming = view.state.toText(latest.current.content).toString();
      if (old === incoming) return;
      // 外部更新只派发最小差异，保留 selection/history；候选期间推迟到 composition 提交。
      view.dispatch({
        changes: sourceChange(old, incoming),
        annotations: [Transaction.userEvent.of("external"), Transaction.addToHistory.of(false)],
      });
    };
    latest.current.onDocumentChange?.(view.state.doc.toString());
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      syncExternal.current = () => {};
      view.destroy();
      viewRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    syncExternal.current();
  }, [props.content]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || composing.current || view.composing) return;
    view.dispatch({
      effects: access.current.reconfigure(
        EditorState.readOnly.of(!props.editing || !!props.locked),
      ),
    });
  }, [props.editing, props.locked, compositionRevision]);
  useEffect(() => {
    if (composing.current || viewRef.current?.composing) return;
    viewRef.current?.dispatch({
      effects: language.current.reconfigure(
        props.markdown
          ? markdown({ base: markdownLanguage, extensions: mathSyntax, codeLanguages })
          : [],
      ),
    });
  }, [props.markdown, compositionRevision]);
  return (
    <div
      ref={host}
      className="source-editor"
      data-tile-selectable="true"
      style={{ fontSize: props.fontSize }}
      onPasteCapture={props.onPaste}
      onDropCapture={props.onDrop}
      onDragOverCapture={props.onDragOver}
    />
  );
}
