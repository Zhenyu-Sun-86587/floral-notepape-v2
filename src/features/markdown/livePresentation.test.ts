import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { expect, it } from "vitest";
import { buildLiveLayout } from "./livePresentation";
const options = { showSyntax: true, fontSize: 14 };
function parsed(doc: string) {
  let state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, doc.length, 2000);
  state = state.update({}).state;
  return state;
}
function signature(layout: ReturnType<typeof buildLiveLayout>) {
  const rows: unknown[] = [];
  for (let c = layout.decorations.iter(); c.value; c.next())
    rows.push([
      c.from,
      c.to,
      c.value.spec.class,
      c.value.spec.widget?.constructor.name,
      c.value.spec.widget?.source,
      c.value.spec.widget?.checked,
    ]);
  return rows;
}
it("long document cursor movement rebuilds only the old/new blocks", () => {
  let state = parsed(
    Array.from({ length: 1000 }, (_, i) => `paragraph ${i} **bold**`).join("\n\n"),
  );
  const before = buildLiveLayout(state, options);
  const transaction = state.update({ selection: { anchor: state.doc.length - 5 } });
  const after = buildLiveLayout(transaction.state, options, before, transaction.changes);
  expect(before.blocks.length).toBe(1000);
  expect(after.rebuiltBlocks).toBeLessThanOrEqual(2);
  expect(after.blocks[500].decorations).toBe(before.blocks[500].decorations);
  expect(signature(after)).toEqual(signature(buildLiveLayout(transaction.state, options)));
});
it("typing reuses unaffected blocks while reference edits invalidate dependent widgets", () => {
  const state = parsed("first **bold**\n\n![image][pic]\n\nlast\n\n[pic]: a.png");
  const before = buildLiveLayout(state, options);
  const tr = state.update({ changes: { from: 2, insert: "X" } });
  const next = buildLiveLayout(tr.state, options, before, tr.changes);
  expect(next.rebuiltBlocks).toBe(1);
  expect(signature(next)).toEqual(signature(buildLiveLayout(tr.state, options)));
  const at = tr.state.doc.toString().indexOf("a.png");
  const ref = tr.state.update({ changes: { from: at, to: at + 5, insert: "b.png" } });
  const after = buildLiveLayout(ref.state, options, next, ref.changes);
  expect(after.references).toContain("b.png");
  expect(signature(after)).toEqual(signature(buildLiveLayout(ref.state, options)));
});
it("block structure changes and deletion retain full-layout equivalence", () => {
  let state = parsed("first\n\n```\ncode\n```\n\nlast");
  let layout = buildLiveLayout(state, options);
  for (const edit of [
    { from: 7, to: 10, insert: "text" },
    { from: 0, to: 5, insert: "" },
  ]) {
    const tr = state.update({ changes: edit });
    layout = buildLiveLayout(tr.state, options, layout, tr.changes);
    expect(signature(layout)).toEqual(signature(buildLiveLayout(tr.state, options)));
    state = tr.state;
  }
});
