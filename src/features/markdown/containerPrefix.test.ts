import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { containerPrefixes, prefixDecorations } from "./containerPrefix";
import { mathSyntax } from "./sourceDocument";

describe("Lezer container prefix presentation", () => {
  const cases = [
    "- A\n* B\n+ C",
    "1. A\n2. B\n10. C",
    "- [ ] A\n- [x] B",
    "> Quote",
    "- parent\n  - child\n    - 孙子",
    "1. parent\n   1. child\n2. second",
    "> - [ ] nested",
    "- [ ] parent\n  - [ ] child",
    "- This is a very long item ".repeat(20),
  ];
  for (const doc of cases)
    it(`保留源码、行数及所有结构偏移：${doc.slice(0, 30)}`, () => {
      const state = EditorState.create({
        doc,
        extensions: markdown({ base: markdownLanguage, extensions: mathSyntax }),
      });
      const prefixes = containerPrefixes(state);
      expect(prefixes.length).toBeGreaterThan(0);
      const inactive = prefixDecorations(state, false, 0);
      const active = prefixDecorations(state, true, 0);
      expect(active.map((r) => [r.from, r.to])).toEqual(inactive.map((r) => [r.from, r.to]));
      for (const range of [...inactive, ...active]) {
        expect(range.value.spec.widget).toBeUndefined();
        expect(range.value.spec.class).toBeTruthy();
      }
      for (const prefix of prefixes) {
        expect(prefix.bodyFrom).toBeLessThanOrEqual(state.doc.lineAt(prefix.lineFrom).to);
        for (const marker of prefix.markers) {
          const slot = inactive.find(
            (r) =>
              r.from === marker.from &&
              r.to === marker.to &&
              r.value.spec.class.includes("source-prefix-slot"),
          );
          expect(slot).toBeDefined();
          if (marker.kind === "ordered")
            expect(slot!.value.spec.class).toContain("source-prefix-ordered");
          if (marker.kind === "task")
            expect(Number(slot!.value.spec.attributes["data-task-offset"])).toBe(marker.from);
        }
      }
      expect(state.doc.toString()).toBe(doc);
      expect(state.doc.lines).toBe(doc.split("\n").length);
    });
  it("有序编号保留且不把代码中的伪 marker 当成 container", () => {
    const state = EditorState.create({
      doc: "10. item\n\n```\n- [ ] literal\n```",
      extensions: markdown({ base: markdownLanguage }),
    });
    const prefixes = containerPrefixes(state);
    expect(prefixes).toHaveLength(1);
    expect(prefixes[0].markers[0].kind).toBe("ordered");
    expect(state.sliceDoc(prefixes[0].markers[0].from, prefixes[0].markers[0].to)).toBe("10.");
  });
  it("嵌套 quote/task 只抑制 task 所属 bullet", () => {
    const state = EditorState.create({
      doc: "> - [x] nested",
      extensions: markdown({ base: markdownLanguage }),
    });
    const prefixes = containerPrefixes(state);
    expect(prefixes[0].markers.map((m) => m.kind)).toEqual(["quote", "bullet", "task"]);
    expect(prefixes[0].bodyFrom).toBe(8);
    const classes = prefixDecorations(state, false, 0).map((r) => r.value.spec.class);
    expect(classes.some((c) => c.includes("source-prefix-silent"))).toBe(true);
    expect(classes.some((c) => c.includes("source-prefix-bullet"))).toBe(false);
  });
});
