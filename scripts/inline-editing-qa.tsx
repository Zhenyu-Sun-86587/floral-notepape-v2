import { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownSurface } from "../src/features/markdown/MarkdownSurface";
import type { SourceEditorHandle } from "../src/features/markdown/SourceEditor";
import "../src/App.css";
import { inlineEditingCases as cases } from "../src/features/markdown/inlineEditingCases.testdata";
function QA() {
  const [kind, setKind] = useState("paragraph");
  const [value, setValue] = useState(cases.paragraph);
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const editor = useRef<SourceEditorHandle>(null);
  return (
    <div id="qa">
      <div id="controls">
        <select
          aria-label="case"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setValue(cases[e.target.value]);
            setEditing(false);
            setRev((x) => x + 1);
          }}
        >
          {Object.keys(cases).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          onClick={() => {
            setValue(cases[kind]);
            setEditing(false);
            setRev((x) => x + 1);
          }}
        >
          Reset
        </button>
        <button onClick={() => setEditing(!editing)}>{editing ? "Read" : "Edit"}</button>
        <button
          onClick={() => {
            editor.current?.setSelectionRange(value.length, value.length);
            editor.current?.focus();
          }}
        >
          End
        </button>
      </div>
      <div id="surface" ref={scroll}>
        <MarkdownSurface
          key={rev}
          content={value}
          editing={editing}
          markdown
          presentation="live"
          fontSize={16}
          editorRef={editor}
          scrollContainerRef={scroll}
          onChange={setValue}
          onActivate={() => setEditing(true)}
          onDeactivate={() => setEditing(false)}
        />
      </div>
      <textarea id="source" aria-label="Source" value={value} readOnly />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<QA />);
