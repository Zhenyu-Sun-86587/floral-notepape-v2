import { useEffect, useImperativeHandle, useRef, type Ref, type HTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MarkdownPreviewLazy } from "./MarkdownPreviewLazy";
import { mathSyntax, sourceChange } from "./sourceDocument";
import { hideLeadingFrontmatter } from "./frontmatter";
import "./sourceEditor.css";

export interface SourceEditorHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
  insertText(text: string): void;
}
interface Props {
  content: string;
  editing: boolean;
  markdown: boolean;
  locked?: boolean;
  fontSize: number;
  imageBaseDir?: string;
  imageRootDir?: string;
  allowRemoteImages?: boolean;
  editorRef?: Ref<SourceEditorHandle>;
  onChange?: (content: string) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onTaskToggle?: (offset: number, checked: boolean) => void;
  onPaste?: HTMLAttributes<HTMLDivElement>["onPaste"];
  onDrop?: HTMLAttributes<HTMLDivElement>["onDrop"];
  onDragOver?: HTMLAttributes<HTMLDivElement>["onDragOver"];
}
const presentation = StateEffect.define<boolean>();

class Marker extends WidgetType {
  constructor(
    readonly text: string,
    readonly checked?: boolean,
    readonly offset = 0,
  ) {
    super();
  }
  eq(other: Marker) {
    return (
      this.text === other.text && this.checked === other.checked && this.offset === other.offset
    );
  }
  toDOM() {
    const element = document.createElement(this.checked == null ? "span" : "input");
    element.className = "source-marker";
    if (element instanceof HTMLInputElement) {
      element.type = "checkbox";
      element.checked = this.checked!;
      element.dataset.taskOffset = String(this.offset);
      element.setAttribute("aria-label", "切换任务状态");
    } else element.textContent = this.text;
    return element;
  }
  ignoreEvent() {
    return false;
  }
}

// 复杂块使用已有只读渲染器；只有源码变化才更新该块，不持有第二份可编辑文档。
const richRoots = new WeakMap<HTMLElement, Root>();
class RichBlock extends WidgetType {
  constructor(
    readonly source: string,
    readonly props: Props,
    readonly inline: boolean,
  ) {
    super();
  }
  eq(other: RichBlock) {
    return (
      this.source === other.source &&
      this.inline === other.inline &&
      this.props.fontSize === other.props.fontSize &&
      this.props.imageBaseDir === other.props.imageBaseDir &&
      this.props.imageRootDir === other.props.imageRootDir &&
      this.props.allowRemoteImages === other.props.allowRemoteImages
    );
  }
  toDOM() {
    const element = document.createElement(this.inline ? "span" : "div");
    element.className = `source-rich-block ${this.inline ? "source-rich-inline" : ""}`;
    const root = createRoot(element);
    richRoots.set(element, root);
    root.render(
      <MarkdownPreviewLazy
        content={this.source}
        fontSize={this.props.fontSize}
        imageBaseDir={this.props.imageBaseDir}
        imageRootDir={this.props.imageRootDir}
        allowRemoteImages={this.props.allowRemoteImages}
      />,
    );
    return element;
  }
  destroy(element: HTMLElement) {
    const root = richRoots.get(element);
    richRoots.delete(element);
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent(event: Event) {
    return (event.target as HTMLElement)?.closest("a,button,input") != null;
  }
}

export function decorate(
  state: EditorState,
  active: boolean,
  from: number,
  to: number,
  props: Props,
  revealHead = state.selection.main.head,
): DecorationSet {
  if (!props.markdown) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const activeLine = state.doc.lineAt(Math.min(revealHead, state.doc.length));
  const reveal = (a: number, b: number) => active && a <= activeLine.to && b >= activeLine.from;
  const hide = (a: number, b: number) => {
    if (b > a) ranges.push(Decoration.replace({}).range(a, b));
  };
  const mark = (a: number, b: number, cls: string, attributes?: Record<string, string>) => {
    if (b > a) ranges.push(Decoration.mark({ class: cls, attributes }).range(a, b));
  };
  const source = state.doc.toString();
  const frontmatterEnd = source.length - hideLeadingFrontmatter(source).length;
  if (frontmatterEnd > 0 && !reveal(0, frontmatterEnd - 1))
    ranges.push(Decoration.replace({ block: true }).range(0, frontmatterEnd));
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const { name, from: a, to: b } = node;
      if (
        frontmatterEnd > 0 &&
        !reveal(0, frontmatterEnd - 1) &&
        a < frontmatterEnd &&
        name !== "Document"
      )
        return false;
      const line = state.doc.lineAt(a);
      const source = () => state.sliceDoc(a, b);
      const rich =
        name === "Table" ||
        name === "Image" ||
        name === "InlineMath" ||
        name === "DisplayMath" ||
        (name === "FencedCode" && /^```+mermaid\b/.test(source()));
      if (rich && !reveal(a, b)) {
        ranges.push(
          Decoration.replace({
            widget: new RichBlock(source(), props, name === "Image" || name === "InlineMath"),
            block: name !== "Image" && name !== "InlineMath",
          }).range(a, b),
        );
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(name)) {
        ranges.push(
          Decoration.line({ class: `source-heading source-h${name.slice(-1)}` }).range(line.from),
        );
      }
      const styles: Record<string, string> = {
        StrongEmphasis: "source-strong",
        Emphasis: "source-em",
        Strikethrough: "source-strike",
        InlineCode: "source-code",
      };
      if (styles[name]) mark(a, b, styles[name]);
      if (name === "FencedCode" || name === "CodeBlock") {
        for (let i = line.number; i <= state.doc.lineAt(b).number; i++)
          ranges.push(Decoration.line({ class: "source-fence" }).range(state.doc.line(i).from));
      }
      if (name === "Link" || name === "Autolink") {
        const urlNode = node.node.getChild("URL");
        if (urlNode)
          mark(a, b, "source-link", {
            "data-source-url": state.sliceDoc(urlNode.from, urlNode.to),
          });
      }
      if (name === "HorizontalRule" && !reveal(a, b)) {
        ranges.push(Decoration.replace({ widget: new Marker("―") }).range(a, b));
        return false;
      }
      if (name === "TaskMarker") {
        // 任务槽位始终可点；列表符号和任务框不能重复显示。
        ranges.push(
          Decoration.replace({ widget: new Marker("", /x/i.test(source()), a) }).range(a, b),
        );
        return false;
      }
      if (!reveal(a, b)) {
        if (
          ["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark"].includes(name)
        )
          hide(a, b);
        if ((name === "URL" || name === "LinkTitle") && node.node.parent?.name === "Link")
          hide(a, b);
        if (name === "QuoteMark")
          ranges.push(Decoration.replace({ widget: new Marker("│") }).range(a, b));
        if (name === "ListMark") {
          const tail = state.sliceDoc(b, Math.min(line.to, b + 5));
          const text = /^\s*\[[ xX]\]/.test(tail) ? "" : /^\d/.test(source()) ? source() : "•";
          ranges.push(Decoration.replace({ widget: new Marker(text) }).range(a, b));
        }
        if (name === "CodeInfo") hide(a, b);
      }
    },
  });
  return Decoration.set(ranges, true);
}

export function SourceEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const access = useRef(new Compartment());
  const updatePresentation = useRef<(active: boolean) => void>(() => {});
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
      focus() {
        viewRef.current?.focus();
      },
      setSelectionRange(start, end) {
        const view = viewRef.current;
        if (view)
          view.dispatch({
            selection: {
              anchor: Math.min(start, view.state.doc.length),
              head: Math.min(end, view.state.doc.length),
            },
          });
      },
      insertText(text) {
        const view = viewRef.current;
        if (view)
          view.dispatch(view.state.replaceSelection(text), {
            userEvent: "input.paste",
            scrollIntoView: true,
          });
      },
    }),
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    let active = latest.current.editing;
    let gesture = false;
    let gestureHead = 0;
    let composing = false;
    let compositionFrame = 0;
    let disposed = false;
    const decorations = StateField.define<DecorationSet>({
      create: (state) => decorate(state, active, 0, state.doc.length, latest.current),
      update(value, tr) {
        // 输入法候选期间只映射已有装饰，不替换正在组成文字的 DOM。
        if (composing) return tr.docChanged ? value.map(tr.changes) : value;
        let changed =
          tr.docChanged ||
          (active &&
            tr.selection != null &&
            tr.startState.doc.lineAt(tr.startState.selection.main.head).number !==
              tr.state.doc.lineAt(tr.state.selection.main.head).number) ||
          syntaxTree(tr.startState) !== syntaxTree(tr.state);
        for (const effect of tr.effects) {
          if (effect.is(presentation)) {
            active = effect.value;
            changed = true;
          }
        }
        // 块高度不随 viewport 移除，避免滚动时标题/复杂块高度变化；DOM 由编辑器虚拟化。
        return changed
          ? decorate(
              tr.state,
              active,
              0,
              tr.state.doc.length,
              latest.current,
              gesture ? gestureHead : undefined,
            )
          : value;
      },
      provide: (field) => EditorView.decorations.from(field),
    });
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
          markdown({ base: markdownLanguage, extensions: mathSyntax }),
          history(),
          EditorView.lineWrapping,
          access.current.of(EditorState.readOnly.of(!latest.current.editing)),
          decorations,
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
            if (
              update.docChanged &&
              !update.transactions.every(
                (tr) => tr.annotation(Transaction.userEvent) === "external",
              )
            )
              latest.current.onChange?.(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown(event, editor) {
              if (event.button !== 0 || latest.current.locked) return false;
              const target = event.target as HTMLElement;
              const task = target.closest<HTMLInputElement>("[data-task-offset]");
              if (task) {
                event.preventDefault();
                const offset = Number(task.dataset.taskOffset);
                editor.dispatch({
                  changes: { from: offset + 1, to: offset + 2, insert: task.checked ? " " : "x" },
                  userEvent: "input.task",
                });
                return true;
              }
              const link = target.closest<HTMLElement>("[data-source-url]");
              if (link && (!latest.current.editing || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                const url = link.dataset.sourceUrl!;
                if (/^https?:\/\//i.test(url)) void openUrl(url);
                return true;
              }
              if (
                !latest.current.editing &&
                editor.state.doc.length &&
                !target.closest(".source-rich-block")
              ) {
                const hit = document.caretRangeFromPoint(event.clientX, event.clientY);
                if (hit?.startContainer.nodeType === Node.TEXT_NODE)
                  hit.selectNodeContents(hit.startContainer);
                const textHit =
                  hit?.startContainer.nodeType === Node.TEXT_NODE &&
                  editor.contentDOM.contains(hit.startContainer) &&
                  Array.from(hit.getClientRects()).some(
                    (rect) =>
                      event.clientX >= rect.left &&
                      event.clientX <= rect.right &&
                      event.clientY >= rect.top &&
                      event.clientY <= rect.bottom,
                  );
                if (!textHit) {
                  event.preventDefault();
                  return true;
                }
              }
              // 用编辑器当前排版命中源码位置，鼠标手势结束前冻结装饰，避免显露符号改变落点。
              gesture = true;
              gestureHead = editor.state.selection.main.head;
              if (!latest.current.editing) {
                const anchor = editor.posAtCoords({ x: event.clientX, y: event.clientY });
                if (anchor != null)
                  editor.dispatch({
                    selection: { anchor },
                    effects: access.current.reconfigure(EditorState.readOnly.of(false)),
                  });
                latest.current.onActivate?.();
              }
              return false;
            },
            focus() {
              if (!latest.current.locked && !gesture) latest.current.onActivate?.();
              return false;
            },
            blur(event, editor) {
              const next = event.relatedTarget as HTMLElement | null;
              if (!editor.composing && !next?.closest("button,input,[role=dialog],[role=menu]"))
                latest.current.onDeactivate?.();
              return false;
            },
            compositionstart() {
              composing = true;
              return false;
            },
            compositionend() {
              composing = false;
              // 等编辑器提交 composition transaction 后恢复装饰，不改写原生输入事件。
              const settle = () => {
                if (disposed) return;
                if (view.composing) {
                  compositionFrame = requestAnimationFrame(settle);
                  return;
                }
                updatePresentation.current(latest.current.editing);
              };
              cancelAnimationFrame(compositionFrame);
              compositionFrame = requestAnimationFrame(settle);
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    updatePresentation.current = (focused) => {
      if (disposed || view.composing) return;
      const scroll = host.current?.closest<HTMLElement>(".overflow-y-auto");
      const top = scroll?.getBoundingClientRect().top;
      const anchor =
        top == null
          ? null
          : view.posAtCoords(
              { x: view.contentDOM.getBoundingClientRect().left + 1, y: top + 1 },
              false,
            );
      const before = anchor == null ? null : view.coordsAtPos(anchor)?.top;
      view.dispatch({
        effects: [
          access.current.reconfigure(EditorState.readOnly.of(!focused || !!latest.current.locked)),
          ...(gesture ? [] : [presentation.of(focused)]),
        ],
      });
      if (scroll && anchor != null && before != null && scroll.scrollTop > 0) {
        // 装饰改变换行后，以可见源码锚点补偿滚动，读写转换不回到旧像素位置或顶部。
        view.requestMeasure({
          key: updatePresentation,
          read: () => view.coordsAtPos(anchor)?.top,
          write: (after) => {
            if (after != null) scroll.scrollTop += after - before;
          },
        });
      }
    };
    const release = () => {
      if (!gesture) return;
      gesture = false;
      updatePresentation.current(view.hasFocus && !view.state.readOnly);
    };
    window.addEventListener("mouseup", release);
    window.addEventListener("blur", release);
    return () => {
      disposed = true;
      cancelAnimationFrame(compositionFrame);
      window.removeEventListener("mouseup", release);
      window.removeEventListener("blur", release);
      view.destroy();
      viewRef.current = null;
    };
  }, []);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const old = view.state.doc.toString();
    const incoming = view.state.toText(props.content).toString();
    if (incoming === old) return;
    // 外部更新只派发最小差异，光标经 ChangeSet 映射，保留同一份 undo/document。
    view.dispatch({
      changes: sourceChange(old, incoming),
      annotations: [Transaction.userEvent.of("external"), Transaction.addToHistory.of(false)],
    });
  }, [props.content]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.composing) return;
    updatePresentation.current(props.editing);
    if (!props.editing && view.hasFocus) view.contentDOM.blur();
    else if (props.editing && !props.locked && !view.hasFocus) view.focus();
  }, [
    props.editing,
    props.markdown,
    props.locked,
    props.fontSize,
    props.imageBaseDir,
    props.imageRootDir,
    props.allowRemoteImages,
  ]);
  return (
    <div
      ref={host}
      className={`source-editor ${props.editing ? "is-editing" : "is-reading"}`}
      data-tile-selectable="true"
      style={{ fontSize: props.fontSize }}
      onPasteCapture={props.onPaste}
      onDropCapture={props.onDrop}
      onDragOverCapture={props.onDragOver}
      onClickCapture={(event) => {
        if (
          props.editing &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.target as HTMLElement).closest(".source-rich-block a")
        ) {
          event.preventDefault();
          event.stopPropagation();
          viewRef.current?.focus();
        }
      }}
    />
  );
}
