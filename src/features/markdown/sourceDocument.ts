import type { MarkdownConfig } from "@lezer/markdown";

// 数学语法仍交给现有 KaTeX 渲染；这里只向同一语法树登记源码范围。
export const mathSyntax: MarkdownConfig = {
  defineNodes: ["InlineMath", { name: "DisplayMath", block: true }],
  parseInline: [
    {
      name: "InlineMath",
      after: "Escape",
      parse(context, next, position) {
        if (next !== 36 || context.char(position + 1) === 32) return -1;
        const width = context.char(position + 1) === 36 ? 2 : 1;
        for (let end = position + width; end < context.end; end++) {
          if (context.char(end) === 10) return -1;
          if (context.char(end) === 92) {
            end++;
            continue;
          }
          if (context.char(end) === 36 && (width === 1 || context.char(end + 1) === 36))
            return context.addElement(context.elt("InlineMath", position, end + width));
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "DisplayMath",
      before: "FencedCode",
      parse(context, line) {
        if (line.text.slice(line.pos).trim() !== "$$") return false;
        const start = context.lineStart + line.pos;
        let end = context.lineStart + line.text.length;
        while (context.nextLine()) {
          end = context.lineStart + line.text.length;
          if (line.text.trim() === "$$") {
            context.nextLine();
            break;
          }
        }
        context.addElement(context.elt("DisplayMath", start, end));
        return true;
      },
    },
  ],
};

export function sourceChange(previous: string, next: string) {
  let from = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) from++;
  let to = previous.length,
    end = next.length;
  while (to > from && end > from && previous[to - 1] === next[end - 1]) {
    to--;
    end--;
  }
  return { from, to, insert: next.slice(from, end) };
}
