export function continueMarkdownList(
  content: string,
  start: number,
  end: number,
): { content: string; cursor: number } | null {
  if (start !== end) return null;
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const beforeCursor = content.slice(lineStart, start);
  const match = /^(\s*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]*)?(.*)$/.exec(beforeCursor);
  if (!match) return null;

  const [, indent, bullet, spacing, task, text] = match;
  const lineEnd = content.indexOf("\n", start);
  const restOfLine = content.slice(start, lineEnd < 0 ? undefined : lineEnd);
  if (!text.trim() && !restOfLine.trim()) {
    const next = content.slice(0, lineStart) + content.slice(start);
    return { content: next, cursor: lineStart };
  }

  const nextBullet = /^\d+[.)]$/.test(bullet)
    ? `${Number.parseInt(bullet, 10) + 1}${bullet.slice(-1)}`
    : bullet;
  const continuation = `\n${indent}${nextBullet}${spacing}${task ? "[ ] " : ""}`;
  const next = content.slice(0, start) + continuation + content.slice(start);
  return { content: next, cursor: start + continuation.length };
}
