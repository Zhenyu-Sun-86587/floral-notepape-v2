import { decodeString } from "micromark-util-decode-string";

/** UTF-16 boundaries in rendered text mapped back to the unmodified Markdown. */
export function textSourceMap(raw: string, text: string, base: number): number[] | null {
  const map = [base];
  let cursor = 0;
  let offset = 0;
  while (offset < text.length) {
    // Blockquote/list continuation prefixes are present in source, absent in HAST text.
    if (cursor > 0 && raw[cursor - 1] === "\n") {
      const prefix = /^(?:[ \t]*>[ \t]?)+[ \t]*/.exec(raw.slice(cursor));
      if (prefix) cursor += prefix[0].length;
      else if (raw[cursor] !== text[offset]) cursor += /^[ \t]*/.exec(raw.slice(cursor))![0].length;
      map[offset] = base + cursor;
    }
    const token =
      /^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);)/.exec(
        raw.slice(cursor),
      )?.[0] ?? raw[cursor];
    if (!token) return null;
    const decoded = decodeString(token);
    if (!text.startsWith(decoded, offset)) return null;
    for (let i = 1; i <= decoded.length; i++)
      map[offset + i] = base + cursor + (i === decoded.length ? token.length : i);
    cursor += token.length;
    offset += decoded.length;
  }
  return cursor === raw.length ? map : null;
}

/** Code is literal: escapes/entities must not be decoded, even under syntax highlighting. */
export function codeSourceMap(
  raw: string,
  text: string,
  base: number,
  block: boolean,
): number[] | null {
  let cursor = 0;
  if (block && /^(?:`{3,}|~{3,})/.test(raw)) cursor = raw.indexOf("\n") + 1;
  if (!block) {
    const ticks = /^`+/.exec(raw)?.[0].length ?? 0;
    let body = raw.slice(ticks, ticks ? -ticks : undefined);
    cursor = ticks;
    if (body.startsWith(" ") && body.endsWith(" ") && body.trim()) {
      body = body.slice(1, -1);
      cursor++;
    }
    if (body.replace(/\n/g, " ") !== text) return null;
    return Array.from({ length: text.length + 1 }, (_, i) => base + cursor + i);
  }
  const map: number[] = [];
  const parts = text.split("\n");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const at = raw.indexOf(part, cursor);
    if (at < 0) return null;
    if (map.length) map[map.length - 1] = base + at;
    else map.push(base + at);
    for (let j = 1; j <= part.length; j++) map.push(base + at + j);
    cursor = at + part.length;
    if (i < parts.length - 1) {
      const newline = raw.indexOf("\n", cursor);
      cursor = newline < 0 ? cursor : newline + 1;
      map.push(base + cursor);
    }
  }
  return map;
}
