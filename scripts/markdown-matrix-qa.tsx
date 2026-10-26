// Local QA only: exercise production panels with a deterministic in-memory Tauri bridge.
// No production paths or user data are read/written by this page.
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { initializeI18n } from "../src/locales";
import { Tile } from "../src/components/Tile";
import { CapsulePreview } from "../src/platform/macos/capsules/Preview";
import { MarkdownPreview } from "../src/features/markdown/MarkdownPreview";
import { SourceEditor, type SourceEditorHandle } from "../src/features/markdown/SourceEditor";
import { DisplayModeControl } from "../src/features/markdown/DisplayModeControl";
import type { MarkdownDisplayMode } from "../src/features/markdown/displayMode";
import fixture from "../Docs/fixtures/mac-markdown-acceptance.md?raw";
import "../src/App.css";
import "../src/platform/macos/capsules/capsules.css";
import "./markdown-matrix-qa.css";

let content = fixture;
let mode: MarkdownDisplayMode = "preview";
let version = 0;
let generation = 1;
let sequence = 0;
const savedContentListeners = new Set<(value: string) => void>();
const callbacks = new Map<number, (event: unknown) => void>();
const listeners = new Map<number, { event: string; handler: number }>();
const entry = () => ({
  key: "note:qa",
  title: "Markdown 综合验收",
  preview: content,
  colorKey: 0,
  expanded: false,
  locked: false,
  imageBaseDir: null,
  imageRootDir: null,
});
function emit(event: string, payload: unknown) {
  for (const [id, item] of listeners)
    if (item.event === event) callbacks.get(item.handler)?.({ event, id, payload });
}
const config = {
  surfaceDisplayMode: "preview",
  tileRenderMarkdown: true,
  inlineEditing: true,
  surfaceFontSize: 14,
  noteSurfaceAutoSave: true,
  noteAutoSave: true,
  allowRemoteImages: false,
};
Object.assign(window, {
  __TAURI_INTERNALS__: {
    transformCallback: (callback: (event: unknown) => void) => {
      const id = ++sequence;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (path: string) =>
      path.startsWith("/qa/images/")
        ? `/Docs/fixtures/images/${path.slice("/qa/images/".length)}`
        : "/Docs/fixtures/images/qa-intentionally-missing.png",
    invoke: async (command: string, args: Record<string, any> = {}) => {
      if (command === "plugin:event|listen") {
        const id = ++sequence;
        listeners.set(id, { event: args.event, handler: args.handler });
        return id;
      }
      if (command === "plugin:event|unlisten") {
        listeners.delete(args.eventId);
        return;
      }
      if (command === "config_get") return config;
      if (command === "images_get_base_dir") return "/qa";
      if (command === "surface_capsule_material") return { kind: "opaque", opacity: 1 };
      if (command === "surface_capsule_preview_state")
        return { side: "right", generation, entry: entry() };
      if (command === "surface_capsule_entry") return entry();
      if (command === "surface_session_get") return { key: "note:qa", displayMode: mode };
      if (command === "surface_display_mode_set") {
        mode = args.mode;
        emit("surface-session-changed", { key: "note:qa", displayMode: mode });
        return;
      }
      if (command === "notes_get")
        return {
          id: "qa",
          title: "Markdown 综合验收",
          category: "",
          content,
          updatedAt: String(version),
        };
      if (command === "notes_update") {
        content = args.request.content;
        for (const listener of savedContentListeners) listener(content);
        version++;
        emit("notes-changed", null);
        return {
          id: "qa",
          title: "Markdown 综合验收",
          category: "",
          content,
          updatedAt: String(version),
        };
      }
    },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: {
    unregisterListener: (_event: string, id: number) => listeners.delete(id),
  },
});
await initializeI18n("zh-CN");
function QA() {
  const [panel, setPanel] = useState("desktop");
  const [displayMode, setDisplayMode] = useState<MarkdownDisplayMode>("preview");
  const [text, setText] = useState(fixture);
  const [savedContent, setSavedContent] = useState(content);
  useEffect(() => {
    savedContentListeners.add(setSavedContent);
    return () => {
      savedContentListeners.delete(setSavedContent);
    };
  }, []);
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState(0);
  const [dark, setDark] = useState(false);
  const [html, setHtml] = useState(false);
  const editor = useRef<SourceEditorHandle>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const changeMode = (value: MarkdownDisplayMode) => {
    mode = value;
    setDisplayMode(value);
    emit("surface-session-changed", { key: "note:qa", displayMode: value });
  };
  return (
    <main className={dark ? "qa-dark" : ""} data-panel={panel}>
      <div id="qa-controls">
        <select
          aria-label="面板"
          value={panel}
          onChange={(event) => {
            setPanel(event.target.value);
            setEditing(false);
            setRev((x) => x + 1);
          }}
        >
          <option value="main">主编辑器渲染器</option>
          <option value="desktop">桌面便签（实际 Tile）</option>
          <option value="capsule">胶囊（实际 CapsulePreview）</option>
        </select>
        <select
          aria-label="章节"
          defaultValue=""
          onChange={(event) => {
            const needle = event.target.value;
            const panel = document.getElementById("qa-panel")!;
            const cm = panel.querySelector<HTMLElement>(
              ".markdown-edit-layer:not(.is-inactive) .cm-editor, .qa-main-source .cm-editor",
            );
            if (cm) {
              const view = EditorView.findFromDOM(cm)!;
              const position = view.state.doc.toString().indexOf(needle);
              view.dispatch({
                selection: { anchor: Math.max(0, position) },
                effects: EditorView.scrollIntoView(Math.max(0, position), { y: "start" }),
              });
            } else {
              const heading = [...panel.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((item) =>
                item.textContent?.includes(needle),
              );
              heading?.scrollIntoView({ block: "start" });
            }
          }}
        >
          <option value="">跳转章节</option>
          {[
            "01 标题",
            "02 段落",
            "03 普通列表",
            "04 引用",
            "05 链接",
            "06 图片",
            "07 表格",
            "08 代码",
            "09 数学",
            "10 Mermaid",
            "11 脚注",
            "12 分割线",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <DisplayModeControl value={displayMode} onChange={changeMode} />
        {panel !== "capsule" && (
          <>
            <button onClick={() => setEditing(!editing)}>{editing ? "阅读" : "编辑"}</button>
            <button onClick={() => setEditing(false)}>返回阅读</button>
          </>
        )}
        <button
          onClick={() => {
            content = fixture;
            setSavedContent(fixture);
            setText(fixture);
            version++;
            generation++;
            setEditing(false);
            setRev((x) => x + 1);
          }}
        >
          重置
        </button>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => {
              setDark(event.target.checked);
              document.documentElement.dataset.theme = event.target.checked ? "dark" : "light";
            }}
          />
          深色
        </label>
        <label>
          <input
            type="checkbox"
            checked={html}
            onChange={(event) => setHtml(event.target.checked)}
          />
          主预览 HTML
        </label>
        <a href="/Docs/fixtures/mac-markdown-acceptance.md">完整样例</a>
      </div>
      <div id="qa-panel" key={`${panel}-${rev}`}>
        {panel === "capsule" ? (
          <CapsulePreview />
        ) : panel === "desktop" ? (
          <Tile
            title="Markdown 综合验收"
            content={text}
            color={dark ? "#242823" : "#f6f3ec"}
            width="100%"
            className="h-full"
            displayMode={displayMode}
            editing={editing}
            contentEditorRef={editor}
            renderMarkdown={displayMode !== "source"}
            inlineEditing
            scrollContainerRef={scroll}
            imageBaseDir="/qa"
            onContentChange={setText}
            onEditorActivate={() => setEditing(true)}
            onEditorDeactivate={() => setEditing(false)}
          />
        ) : (
          <div className="qa-main">
            {(displayMode === "source" || displayMode === "hybrid") && (
              <section className="qa-main-source">
                <SourceEditor
                  content={text}
                  markdown
                  editing
                  fontSize={14}
                  editorRef={editor}
                  onChange={setText}
                />
              </section>
            )}
            {displayMode !== "source" && (
              <section className="qa-main-preview">
                <MarkdownPreview
                  content={text}
                  imageBaseDir="/qa"
                  renderHtml={html}
                  onTaskToggle={(offset, checked) =>
                    setText(
                      (old) =>
                        old.slice(0, offset + 1) + (checked ? "x" : " ") + old.slice(offset + 2),
                    )
                  }
                />
              </section>
            )}
          </div>
        )}
      </div>
      <textarea
        aria-label="原始 Markdown"
        id="qa-source"
        value={panel === "capsule" ? savedContent : text}
        readOnly
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<QA />);
