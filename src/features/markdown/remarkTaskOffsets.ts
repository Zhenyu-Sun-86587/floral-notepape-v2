import type { ListItem, Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

export function taskMarkerOffset(
  source: string,
  start: number,
  sourceOffset: number,
): number | null {
  const firstLine = source.slice(start).split(/\r?\n/, 1)[0];
  const marker = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\]/.exec(firstLine);
  return marker ? start + marker[0].lastIndexOf("[") + sourceOffset : null;
}

const remarkTaskOffsets: Plugin<[string, number], Root> = (source, sourceOffset) => (tree) => {
  visit(tree, "listItem", (item: ListItem) => {
    const start = item.position?.start.offset;
    if (item.checked == null || start == null) return;
    const offset = taskMarkerOffset(source, start, sourceOffset);
    if (offset == null) return;

    // 记录原文中的精确位置，重复任务也只改点击的那个方框。
    item.data ??= {};
    item.data.hProperties = {
      ...(item.data.hProperties as Record<string, unknown>),
      dataTaskOffset: offset,
    };
  });
};

export default remarkTaskOffsets;
