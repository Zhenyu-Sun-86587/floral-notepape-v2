import { LanguageDescription } from "@codemirror/language";

// 语言包按 fence 延迟加载；纯文本 fence 不进入任何嵌套语法。
export const codeLanguages = [
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then((module) =>
        module.javascript({ typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx"],
    load: () => import("@codemirror/lang-javascript").then((module) => module.javascript()),
  }),
  LanguageDescription.of({
    name: "JSON",
    load: () => import("@codemirror/lang-json").then((module) => module.json()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    load: () => import("@codemirror/lang-python").then((module) => module.python()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs"],
    load: () => import("@codemirror/lang-rust").then((module) => module.rust()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["htm"],
    load: () => import("@codemirror/lang-html").then((module) => module.html()),
  }),
  LanguageDescription.of({
    name: "CSS",
    load: () => import("@codemirror/lang-css").then((module) => module.css()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh"],
    load: async () => {
      const [{ LanguageSupport, StreamLanguage }, { shell }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/shell"),
      ]);
      return new LanguageSupport(StreamLanguage.define(shell));
    },
  }),
];
