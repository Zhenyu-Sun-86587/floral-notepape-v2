import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const aliases: Record<string, string> = {
  chtml: "xml",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

// Preview trees can remount unchanged code blocks while surrounding text is
// edited. Bound both entry count and retained UTF-16 text, per webview.
const highlights = new Map<string, string>();
let retainedCharacters = 0;
const maxRetainedCharacters = 512 * 1024;

export function highlightCode(source: string, language: string): string | null {
  const resolved = aliases[language.toLowerCase()] ?? language.toLowerCase();
  if (!hljs.getLanguage(resolved)) return null;
  const key = `${resolved}\0${source}`;
  const cached = highlights.get(key);
  if (cached !== undefined) {
    highlights.delete(key);
    highlights.set(key, cached);
    return cached;
  }
  const html = hljs.highlight(source, { language: resolved, ignoreIllegals: true }).value;
  const size = key.length + html.length;
  if (size <= maxRetainedCharacters) {
    while (highlights.size >= 64 || retainedCharacters + size > maxRetainedCharacters) {
      const oldest = highlights.entries().next().value;
      if (!oldest) break;
      retainedCharacters -= oldest[0].length + oldest[1].length;
      highlights.delete(oldest[0]);
    }
    highlights.set(key, html);
    retainedCharacters += size;
  }
  return html;
}
