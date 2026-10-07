import type { Root, Blockquote } from "mdast";
import type { Plugin } from "unified";
import { textSourceMap } from "./textSourceMap";
import { visit } from "unist-util-visit";

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/;

const remarkAlerts: Plugin<[], Root> = () => (tree, file) => {
  visit(tree, "blockquote", (node: Blockquote) => {
    const first = node.children[0];
    if (first?.type !== "paragraph") return;

    const text = first.children[0];
    if (text?.type !== "text") return;

    const match = text.value.match(ALERT_RE);
    if (!match) return;

    const alertType = match[1].toLowerCase();

    // Preserve source coordinates when the display-only alert marker is removed.
    const start = text.position?.start.offset;
    const end = text.position?.end.offset;
    if (start != null && end != null) {
      const source = String(file.value);
      const map = textSourceMap(source.slice(start, end), text.value, start);
      const offset = map?.[match[0].length];
      if (offset != null && text.position) {
        const prefix = source.slice(0, offset);
        text.position.start = {
          offset,
          line: prefix.split("\n").length,
          column: offset - prefix.lastIndexOf("\n"),
        };
      }
    }
    text.value = text.value.slice(match[0].length);

    // If the text node is now empty, clean up
    if (!text.value) {
      first.children.shift();
      // Also remove a leading soft break if present
      if (first.children[0]?.type === "break") {
        first.children.shift();
      }
      // If the entire first paragraph is now empty, remove it
      if (first.children.length === 0) {
        node.children.shift();
      }
    }

    // Attach the alert type as an HTML data attribute
    node.data ??= {};
    node.data.hProperties = {
      ...(node.data.hProperties as Record<string, unknown>),
      "data-alert-type": alertType,
    };
  });
};

export default remarkAlerts;
