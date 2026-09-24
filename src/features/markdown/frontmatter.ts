export function hideLeadingFrontmatter(content: string): string {
  const start = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const opening = /^---[ \t]*\r?\n/.exec(content.slice(start));
  if (!opening) return content;

  const bodyStart = start + opening[0].length;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = bodyStart;
  const match = closing.exec(content);
  if (!match || match.index === bodyStart) return content;

  // 仅影响预览；编辑器与外部文件保存仍使用完整原文。
  return content.slice(match.index + match[0].length);
}
