import type { Root, RootContent, Text } from "mdast";
import type { Plugin } from "unified";

// Read-only hybrid rendering uses the existing Markdown pipeline, without a
// CodeMirror view, selection, history, or a second hidden presentation tree.
const remarkHybrid: Plugin<[string], Root> = (source) => (tree) => {
  const text = (value: string): Text => ({ type: "text", value });
  const raw = (node: RootContent) =>
    source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  function walk(node: Root | RootContent) {
    if (
      node.type === "table" ||
      (node.type === "blockquote" && node.data?.hProperties?.["data-alert-type"])
    )
      return;
    if (node.type === "footnoteReference") return;
    if (!("children" in node)) return;
    const children = node.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type === "footnoteReference") {
        children[i] = text(raw(child));
        continue;
      }
      walk(child);
    }
    if (node.type === "strong" || node.type === "emphasis" || node.type === "delete") {
      const marker =
        node.type === "delete" ? "~~" : raw(node)[0].repeat(node.type === "strong" ? 2 : 1);
      node.children.unshift(text(marker));
      node.children.push(text(marker));
    } else if (node.type === "heading") {
      const prefix = raw(node).match(/^#{1,6}[ \t]+/)?.[0];
      if (prefix) node.children.unshift(text(prefix));
      else node.children.push(text("\n" + raw(node).split(/\r?\n/).slice(-1)[0]));
    } else if (node.type === "link" || node.type === "linkReference") {
      // Keep the link action, while showing its original spelling and target.
      node.children = [text(raw(node))];
    } else if (node.type === "listItem" && node.checked == null) {
      const first = node.children[0];
      const prefix = raw(node).match(/^(?:[-+*]|\d+[.)])[ \t]+/)?.[0];
      if (first?.type === "paragraph" && prefix) first.children.unshift(text(prefix));
    } else if (node.type === "blockquote") {
      const first = node.children[0];
      if (first?.type === "paragraph") first.children.unshift(text("> "));
    }
  }
  walk(tree);
  // Inline code and definitions are leaves; retain definitions for reference
  // resolution and additionally display their source as ordinary hybrid text.
  function leaves(parent: Root | RootContent) {
    if (
      !("children" in parent) ||
      parent.type === "table" ||
      (parent.type === "blockquote" && parent.data?.hProperties?.["data-alert-type"])
    )
      return;
    const children = parent.children as RootContent[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type === "inlineCode") child.value = raw(child);
      else if (child.type === "code" && child.lang?.toLowerCase() !== "mermaid")
        child.value = raw(child);
      else if (child.type === "definition" || child.type === "footnoteDefinition") {
        children.splice(++i, 0, {
          type: "paragraph",
          children: [text(raw(child))],
        });
      } else leaves(child);
    }
  }
  leaves(tree);
};

export default remarkHybrid;
