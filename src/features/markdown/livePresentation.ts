import { hideLeadingFrontmatter } from "./frontmatter";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { MarkdownWidget, TaskWidget, TextWidget, type LiveOptions } from "./liveWidgets";

const freeze = StateEffect.define<{ pointer?: boolean; composing?: boolean }>();
const refresh = StateEffect.define<null>();

export function liveDecorations(state: EditorState, options: LiveOptions): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const active = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(Decoration.replace({}).range(from, to));
  };
  const mark = (from: number, to: number, name: string) => {
    if (to > from) ranges.push(Decoration.mark({ class: name }).range(from, to));
  };
  const document = state.doc.toString();
  const frontmatterEnd = document.length - hideLeadingFrontmatter(document).length;
  const hideMetadata =
    !options.showSyntax &&
    frontmatterEnd > 0 &&
    !state.selection.ranges.some((range) => range.from < frontmatterEnd);
  if (hideMetadata) ranges.push(Decoration.replace({ block: true }).range(0, frontmatterEnd));
  const lines = new Set<string>();
  const lineStyle = (from: number, to: number, cls: string) => {
    for (let pos = state.doc.lineAt(from).from; pos <= to; ) {
      const key = `${pos}:${cls}`;
      if (!lines.has(key)) {
        ranges.push(Decoration.line({ class: cls }).range(pos));
        lines.add(key);
      }
      const line = state.doc.lineAt(pos);
      if (line.to >= to || line.to === state.doc.length) break;
      pos = line.to + 1;
    }
  };
  syntaxTree(state).iterate({
    enter({ node, name, from, to }) {
      if (hideMetadata && from < frontmatterEnd && name !== "Document") return false;
      const selected = !!options.showSyntax || active(from, to);
      const line = state.doc.lineAt(from);
      const lineActive = !!options.showSyntax || active(line.from, line.to);
      if (
        options.showSyntax &&
        /^(HeaderMark|QuoteMark|EmphasisMark|StrikethroughMark|CodeMark|CodeInfo|LinkMark|URL|LinkTitle|TaskMarker|ListMark)$/.test(
          name,
        )
      )
        mark(from, to, "cm-live-marker");
      const complexBlock =
        (name === "Blockquote" &&
          /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(
            state.sliceDoc(from, Math.min(to, from + 40)),
          )) ||
        name === "Table" ||
        name === "DisplayMath" ||
        name === "HorizontalRule" ||
        (name === "FencedCode" &&
          /^```mermaid\b/i.test(state.sliceDoc(from, Math.min(to, from + 30))));
      if (complexBlock || name === "Image" || name === "InlineMath") {
        if (!selected) {
          ranges.push(
            Decoration.replace({
              widget: new MarkdownWidget(state.sliceDoc(from, to), options, complexBlock),
              block: complexBlock,
            }).range(from, to),
          );
          return false;
        }
      }
      if (/^(ATX|Setext)Heading\d$/.test(name))
        lineStyle(from, to, `cm-live-heading cm-live-h${name.slice(-1)}`);
      if (name === "Blockquote") lineStyle(from, to, "cm-live-quote");
      if (name === "FencedCode" || name === "CodeBlock") lineStyle(from, to, "cm-live-codeblock");
      const styles: Record<string, string> = {
        StrongEmphasis: "cm-live-strong",
        Emphasis: "cm-live-em",
        Strikethrough: "cm-live-strike",
        InlineCode: "cm-live-code",
        Link: "cm-live-link",
        Autolink: "cm-live-link",
      };
      if (styles[name]) mark(from, to, styles[name]);
      if (
        ["StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode", "Link", "Autolink"].includes(
          name,
        ) &&
        !selected
      ) {
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (["EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark"].includes(child.name))
            hide(child.from, child.to);
          if (name === "Link" && ["URL", "LinkTitle"].includes(child.name))
            hide(child.from, child.to);
        }
      }
      if (name === "TaskMarker" && !selected) {
        ranges.push(
          Decoration.replace({
            widget: new TaskWidget(state.sliceDoc(from + 1, from + 2).toLowerCase() === "x"),
          }).range(from, to),
        );
      }
      if (name === "ListMark" && !lineActive && /^[-+*]$/.test(state.sliceDoc(from, to)))
        ranges.push(Decoration.replace({ widget: new TextWidget("•") }).range(from, to));
      if ((name === "HeaderMark" || name === "QuoteMark") && !lineActive) {
        hide(from, Math.min(to + (state.sliceDoc(to, to + 1) === " " ? 1 : 0), line.to));
      }
      if (
        (name === "CodeMark" || name === "CodeInfo") &&
        node.parent?.name === "FencedCode" &&
        !options.showSyntax &&
        !active(node.parent.from, node.parent.to)
      )
        hide(from, to);
    },
  });
  return Decoration.set(ranges, true);
}

export function livePresentation(options: LiveOptions) {
  const field = StateField.define<{
    decorations: DecorationSet;
    pointer: boolean;
    composing: boolean;
  }>({
    create: (state) => ({
      decorations: liveDecorations(state, options),
      pointer: false,
      composing: false,
    }),
    update(value, tr) {
      let { pointer, composing } = value;
      for (const effect of tr.effects)
        if (effect.is(freeze)) {
          pointer = effect.value.pointer ?? pointer;
          composing = effect.value.composing ?? composing;
        }
      const changed =
        tr.docChanged || tr.selection || tr.effects.some((e) => e.is(freeze) || e.is(refresh));
      return {
        pointer,
        composing,
        decorations:
          pointer || composing
            ? value.decorations.map(tr.changes)
            : changed
              ? liveDecorations(tr.state, options)
              : value.decorations,
      };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
  return [
    field,
    ViewPlugin.fromClass(
      class {
        private composing = false;
        private disposed = false;
        private release = () => this.view.dispatch({ effects: freeze.of({ pointer: false }) });
        private press = () => this.view.dispatch({ effects: freeze.of({ pointer: true }) });
        private start = () => {
          this.composing = true;
          this.view.dispatch({ effects: freeze.of({ composing: true }) });
        };
        private end = () => {
          const settle = () => {
            if (this.disposed) return;
            if (this.view.composing) {
              requestAnimationFrame(settle);
              return;
            }
            this.composing = false;
            this.view.dispatch({ effects: freeze.of({ composing: false }) });
          };
          requestAnimationFrame(settle);
        };
        constructor(private view: EditorView) {
          view.dom.addEventListener("pointerdown", this.press);
          view.dom.addEventListener("compositionstart", this.start);
          view.dom.addEventListener("compositionend", this.end);
          window.addEventListener("pointerup", this.release);
          window.addEventListener("pointercancel", this.release);
          window.addEventListener("blur", this.release);
        }
        update(update: import("@codemirror/view").ViewUpdate) {
          if (
            !update.docChanged &&
            syntaxTree(update.startState) !== syntaxTree(update.state) &&
            !this.composing
          )
            queueMicrotask(() => {
              if (!this.disposed) this.view.dispatch({ effects: refresh.of(null) });
            });
        }
        destroy() {
          this.disposed = true;
          this.view.dom.removeEventListener("pointerdown", this.press);
          this.view.dom.removeEventListener("compositionstart", this.start);
          this.view.dom.removeEventListener("compositionend", this.end);
          window.removeEventListener("pointerup", this.release);
          window.removeEventListener("pointercancel", this.release);
          window.removeEventListener("blur", this.release);
        }
      },
    ),
  ];
}
