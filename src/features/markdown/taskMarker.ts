export function toggleTaskMarker(content: string, offset: number, checked: boolean): string | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const marker = content.slice(offset, offset + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return null;
  return `${content.slice(0, offset + 1)}${checked ? "x" : " "}${content.slice(offset + 2)}`;
}
