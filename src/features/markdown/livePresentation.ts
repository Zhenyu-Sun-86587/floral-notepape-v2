import { hideLeadingFrontmatter } from "./frontmatter";
import {
  StateEffect,
  StateField,
  RangeSet,
  type ChangeDesc,
  type EditorState,
  type Range,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { MarkdownWidget, TaskWidget, TextWidget, type LiveOptions } from "./liveWidgets";

const freeze = StateEffect.define<{ pointer?: boolean; composing?: boolean }>();
const refresh = StateEffect.define<null>();

type Span = { from: number; to: number };
function renderBlock(
  state: EditorState,
  options: LiveOptions,
  span: Span,
  frontmatterEnd: number,
  referenceDefinitions: string,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const active = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(Decoration.replace({}).range(from, to));
  };
  const mark = (from: number, to: number, name: string) => {
    if (to > from) ranges.push(Decoration.mark({ class: name }).range(from, to));
  };
  const hideMetadata =
    !options.showSyntax &&
    frontmatterEnd > 0 &&
    !state.selection.ranges.some((range) => range.from < frontmatterEnd);
  if (hideMetadata && span.from === 0)
    ranges.push(Decoration.replace({ block: true }).range(0, frontmatterEnd));
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
  if (span.from === 0 && frontmatterEnd > 0 && !hideMetadata)
    lineStyle(0, frontmatterEnd - 1, "cm-live-metadata");
  syntaxTree(state).iterate({
    from: span.from,
    to: span.to,
    enter({ node, name, from, to }) {
      if (name === "Document") return;
      if (from < span.from || from >= span.to) return false;
      // YAML is plain metadata, even while visible in hybrid/editing mode.
      // The Markdown parser otherwise mistakes its closing --- for a Setext heading.
      if (from < frontmatterEnd && name !== "Document") return false;
      const selected = !!options.showSyntax || active(from, to);
      const line = state.doc.lineAt(from);
      const lineActive = !!options.showSyntax || active(line.from, line.to);
      if (options.showSyntax && name === "ListMark") {
        const task = node.parent?.getChild("Task");
        if (task && task.from <= line.to) {
          // Task items match preview: checkbox instead of both a bullet and a marker.
          hide(from, task.from);
          return false;
        }
      }
      if (
        options.showSyntax &&
        name !== "TaskMarker" &&
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
          /^(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(state.sliceDoc(from, Math.min(to, from + 30))));
      if (complexBlock || name === "Image" || name === "InlineMath") {
        // Hybrid retains text markers, but renders complex content until that
        // range is edited. A parked read-only selection must not reveal source.
        const revealSource = options.showSyntax ? !state.readOnly && active(from, to) : selected;
        if (!revealSource) {
          ranges.push(
            Decoration.replace({
              widget: new MarkdownWidget(
                state.sliceDoc(from, to),
                options,
                complexBlock,
                referenceDefinitions,
                state.readOnly,
              ),
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
          if (name === "Link" && ["URL", "LinkTitle", "LinkLabel"].includes(child.name))
            hide(child.from, child.to);
        }
      }
      if (name === "TaskMarker" && (options.showSyntax || !selected)) {
        ranges.push(
          Decoration.replace({
            widget: new TaskWidget(
              state.sliceDoc(from + 1, from + 2).toLowerCase() === "x",
              !!options.tasksLocked || (state.readOnly && !options.onReadTaskToggle),
              options.onReadTaskToggle,
            ),
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

interface Block extends Span {
  name: string;
  references: string;
  selection: string;
  decorations: DecorationSet;
}
export interface LiveLayout {
  blocks: Block[];
  frontmatterEnd: number;
  references: string;
  decorations: DecorationSet;
  // Deterministic work count for regression/benchmark checks, not UI telemetry.
  rebuiltBlocks: number;
}
function selectionIn(state: EditorState, span: Span) {
  return state.selection.ranges
    .filter((r) => r.from <= span.to && r.to >= span.from)
    .map((r) => `${Math.max(r.from, span.from) - span.from}:${Math.min(r.to, span.to) - span.from}`)
    .join(",");
}

/** Cache only the current document. Unchanged blocks share immutable decorations. */
export function buildLiveLayout(
  state: EditorState,
  options: LiveOptions,
  previous?: LiveLayout,
  changes?: ChangeDesc,
): LiveLayout {
  const docChanged = !!changes && !changes.empty;
  const content = !previous || docChanged ? state.doc.toString() : null;
  const frontmatterEnd =
    content == null
      ? previous!.frontmatterEnd
      : content.length - hideLeadingFrontmatter(content).length;
  const touched: Span[] = [];
  changes?.iterChangedRanges((from, to) => touched.push({ from, to }));
  const reusable = new Map<number, Block>();
  if (previous && previous.frontmatterEnd === frontmatterEnd) {
    for (const old of previous.blocks) {
      if (touched.some((r) => r.from <= old.to && r.to >= old.from)) continue;
      const from = changes?.mapPos(old.from, 1) ?? old.from;
      const to = changes?.mapPos(old.to, -1) ?? old.to;
      reusable.set(from, {
        ...old,
        from,
        to,
        decorations: docChanged ? old.decorations.map(changes!) : old.decorations,
      });
    }
  }
  const spans: (Span & { name: string })[] = [];
  if (frontmatterEnd > 0) spans.push({ from: 0, to: frontmatterEnd, name: "Metadata" });
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling)
    if (node.from >= frontmatterEnd) spans.push({ from: node.from, to: node.to, name: node.name });
  const blocks = spans.map((span) => {
    const old = reusable.get(span.from);
    if (old?.to === span.to && old.name === span.name) return old;
    const definitions: string[] = [];
    if (span.name !== "Metadata")
      syntaxTree(state).iterate({
        from: span.from,
        to: span.to,
        enter({ name, from, to }) {
          if (name === "Document") return;
          if (from < span.from || from >= span.to) return false;
          if (name === "LinkReference") definitions.push(state.sliceDoc(from, to));
        },
      });
    return {
      ...span,
      references: definitions.join("\n\n"),
      selection: "!",
      decorations: Decoration.none,
    };
  });
  const references = blocks
    .map((b) => b.references)
    .filter(Boolean)
    .join("\n\n");
  let rebuiltBlocks = 0;
  const result = blocks.map((block) => {
    const selection = selectionIn(state, block);
    if (block.selection === selection && previous?.references === references) return block;
    rebuiltBlocks++;
    return {
      ...block,
      selection,
      decorations: renderBlock(state, options, block, frontmatterEnd, references),
    };
  });
  return {
    blocks: result,
    frontmatterEnd,
    references,
    rebuiltBlocks,
    decorations: RangeSet.join(result.map((b) => b.decorations)),
  };
}

export function liveDecorations(state: EditorState, options: LiveOptions): DecorationSet {
  return buildLiveLayout(state, options).decorations;
}

export function livePresentation(options: LiveOptions) {
  const field = StateField.define<{
    layout: LiveLayout;
    decorations: DecorationSet;
    pointer: boolean;
    composing: boolean;
    stale: boolean;
  }>({
    create: (state) => {
      const layout = buildLiveLayout(state, options);
      return {
        layout,
        decorations: layout.decorations,
        pointer: false,
        composing: false,
        stale: false,
      };
    },
    update(value, tr) {
      let { pointer, composing } = value;
      for (const effect of tr.effects)
        if (effect.is(freeze)) {
          pointer = effect.value.pointer ?? pointer;
          composing = effect.value.composing ?? composing;
        }
      const parsed = tr.effects.some((e) => e.is(refresh));
      const changed =
        tr.docChanged ||
        !!tr.selection ||
        tr.startState.readOnly !== tr.state.readOnly ||
        tr.effects.some((e) => e.is(freeze)) ||
        parsed;
      if (pointer || composing)
        return {
          ...value,
          pointer,
          composing,
          stale: value.stale || tr.docChanged || parsed,
          decorations: value.decorations.map(tr.changes),
        };
      if (!changed) return value;
      const reusable = !value.stale && !parsed && tr.startState.readOnly === tr.state.readOnly;
      const layout = buildLiveLayout(
        tr.state,
        options,
        reusable ? value.layout : undefined,
        reusable ? tr.changes : undefined,
      );
      return { layout, decorations: layout.decorations, pointer, composing, stale: false };
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
