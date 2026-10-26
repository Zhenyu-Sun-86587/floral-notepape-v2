// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { forceParsing } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inlineEditingCases } from "./inlineEditingCases.testdata";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
// jsdom cannot measure Mermaid SVG text; real diagrams are checked in the browser/app.
vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <pre data-mermaid>{source}</pre>,
}));
let root: Root;
let host: HTMLDivElement;
let source: string;
const editor = createRef<SourceEditorHandle>();
function render(markdown = true) {
  root.render(
    <SourceEditor
      content={source}
      editing
      markdown={markdown}
      fontSize={14}
      editorRef={editor}
      onChange={(value) => {
        source = value;
      }}
    />,
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  source = "# Long note\n" + "中文连续输入 **Markdown** 内容\n".repeat(2000);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("长文连续输入回传不重复拆分全文，外部更新仍最小写入且保留撤销历史", async () => {
  await act(async () => render());
  const view = editor.current!.view!;
  const normalize = vi.spyOn(EditorState.prototype, "toText");
  normalize.mockClear();
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: "字" }, userEvent: "input" });
      render();
    });
  }
  expect(normalize).not.toHaveBeenCalled();
  expect(editor.current!.value).toBe(source);
  source += "\n外部更新\r\n末行";
  await act(async () => render());
  expect(normalize).toHaveBeenCalled();
  expect(editor.current!.value.endsWith("外部更新\n末行")).toBe(true);
  expect(editor.current!.view).toBe(view);
  await act(async () => {
    expect(undo(view)).toBe(true);
  });
  expect(editor.current!.value.endsWith("外部更新\n末行")).toBe(true);
  expect(editor.current!.value.match(/^字+/)?.[0].length ?? 0).toBeLessThan(20);
});

it("未改变语言开关的重渲染不派发配置事务，真正切换开关仍生效", async () => {
  await act(async () => render());
  const view = editor.current!.view!;
  const dispatch = vi.spyOn(view, "dispatch");
  await act(async () => render());
  expect(dispatch).not.toHaveBeenCalled();
  await act(async () => render(false));
  expect(dispatch).toHaveBeenCalledTimes(1);
  await act(async () => render(false));
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("live 呈现保留原文、撤销和异步图片的事务映射位置", async () => {
  source = "# 标题\n\n前文 **粗体**\n\n- [ ] task\n";
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="live"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  const original = source;
  await act(async () =>
    editor.current!.setSelectionRange(source.indexOf("前文") + 2, source.indexOf("前文") + 2),
  );
  const pending = editor.current!.prepareInsertion!();
  await act(async () => view.dispatch({ changes: { from: 0, insert: "新" }, userEvent: "input" }));
  await act(async () => pending.insert("图片"));
  expect(source).toBe("新" + original.replace("前文", "前文图片"));
  const offset = source.indexOf("[ ]");
  await act(async () => editor.current!.toggleTask(offset, true));
  expect(source).toContain("[x]");
  await act(async () => {
    undo(view);
  });
  expect(source).toContain("[ ]");
  expect(editor.current!.view).toBe(view);
});

it("拖选期间不会重排语法，松开后按新选区展开", async () => {
  source = "开头\n\n**粗体**\n\n末尾";
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="live"
        fontSize={14}
        editorRef={editor}
      />,
    ),
  );
  const view = editor.current!.view!;
  expect(view.contentDOM.textContent).not.toContain("**");
  await act(async () => {
    view.dom.dispatchEvent(new Event("pointerdown"));
    view.dispatch({ selection: { anchor: source.indexOf("粗体") } });
  });
  expect(view.contentDOM.textContent).not.toContain("**");
  await act(async () => window.dispatchEvent(new Event("pointerup")));
  expect(view.contentDOM.textContent).toContain("**粗体**");
});

it("任务 widget 使用当前源码位置，前面的编辑不会使勾选写错位置", async () => {
  source = "前言\n\n- [ ] task\n";
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="live"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  await act(async () =>
    view.dispatch({ changes: { from: 0, insert: "追加" }, userEvent: "input" }),
  );
  const task = host.querySelector<HTMLInputElement>(".cm-live-task")!;
  await act(async () => {
    task.checked = true;
    task.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(source).toBe("追加前言\n\n- [x] task\n");
  await act(async () => {
    undo(view);
  });
  expect(source).toBe("追加前言\n\n- [ ] task\n");
});

it.each(Object.entries(inlineEditingCases))(
  "%s 呈现、切换开关与撤销不改写 Markdown 原文",
  async (_name, original) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    source = original;
    const show = (presentation: "source" | "live" | "hybrid") =>
      root.render(
        <SourceEditor
          content={source}
          editing
          markdown
          presentation={presentation}
          fontSize={16}
          editorRef={editor}
          onChange={(value) => {
            source = value;
          }}
        />,
      );
    await act(async () => show("live"));
    const view = editor.current!.view!;
    await act(async () => {
      editor.current!.setSelectionRange(source.length, source.length);
      editor.current!.insertText("\n测试新增");
    });
    expect(source).toBe(original + "\n测试新增");
    await act(async () => show("hybrid"));
    expect(editor.current!.view).toBe(view);
    expect(editor.current!.value).toBe(original + "\n测试新增");
    if (["math", "table", "mermaid", "hr", "alert"].includes(_name))
      expect(host.querySelector(".cm-live-block")).not.toBeNull();
    else expect(host.querySelector(".cm-live-block")).toBeNull();
    if (_name === "task") expect(host.querySelectorAll(".cm-live-task")).toHaveLength(2);
    else expect(host.querySelector(".cm-live-task")).toBeNull();
    if (["image", "math"].includes(_name))
      expect(host.querySelector(".cm-live-inline")).not.toBeNull();
    else expect(host.querySelector(".cm-live-inline")).toBeNull();
    await act(async () => show("source"));
    expect(editor.current!.view).toBe(view);
    await act(async () => {
      expect(undo(view)).toBe(true);
    });
    expect(source).toBe(original);
    await act(async () => show("live"));
    expect(editor.current!.value).toBe(original);
    vi.unstubAllGlobals();
  },
);

it("混合图片在阅读和编辑会话切换时更新；编辑当前图片显示源码，离开后恢复", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  source = "![截图](images/photo.png)\n\n末尾";
  const show = (editing: boolean) =>
    root.render(
      <SourceEditor
        content={source}
        editing={editing}
        markdown
        presentation="hybrid"
        fontSize={14}
        imageBaseDir="/data"
        editorRef={editor}
      />,
    );
  await act(async () => show(false));
  const view = editor.current!.view!;
  expect(host.querySelector('img[alt="截图"]')?.getAttribute("src")).toBe(
    "asset://localhost/data/images/photo.png",
  );
  await act(async () => show(true));
  expect(host.querySelector('img[alt="截图"]')).toBeNull();
  expect(view.contentDOM.textContent).toContain("![截图](images/photo.png)");
  await act(async () => editor.current!.setSelectionRange(source.length, source.length));
  expect(host.querySelector('img[alt="截图"]')).not.toBeNull();
  await act(async () => editor.current!.setSelectionRange(3, 3));
  expect(host.querySelector('img[alt="截图"]')).toBeNull();
  await act(async () => show(false));
  expect(host.querySelector('img[alt="截图"]')).not.toBeNull();
  expect(editor.current!.view).toBe(view);
  expect(editor.current!.value).toBe(source);
  vi.unstubAllGlobals();
});

it("混合编辑中复选框保持可用，前方改动后仍写对任务并保留撤销", async () => {
  source = "- [ ] first\n  - [x] nested\n- [X] third";
  const original = source;
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="hybrid"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  // Even a caret inside the first marker leaves hybrid task controls rendered.
  await act(async () => editor.current!.setSelectionRange(3, 3));
  expect(host.querySelectorAll(".cm-live-task")).toHaveLength(3);
  await act(async () =>
    view.dispatch({ changes: { from: 0, insert: "前文\n\n" }, userEvent: "input" }),
  );
  const nested = host.querySelectorAll<HTMLInputElement>(".cm-live-task")[1];
  await act(async () => nested.click());
  expect(source).toBe("前文\n\n" + original.replace("[x] nested", "[ ] nested"));
  await act(async () => {
    undo(view);
  });
  expect(source).toBe("前文\n\n" + original);
});

it("混合引用式图片带上文档定义，定义更新和撤销均刷新图片且保留原文", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  source = '![引用图片][asset]\n\n[asset]: images/a.png "标题"\n\n末尾';
  const original = source;
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="hybrid"
        imageBaseDir="/qa"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  await act(async () => editor.current!.setSelectionRange(source.length, source.length));
  expect(host.querySelector('img[alt="引用图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/qa/images/a.png",
  );
  const from = source.indexOf("a.png");
  await act(async () =>
    view.dispatch({ changes: { from, to: from + 5, insert: "b.png" }, userEvent: "input" }),
  );
  expect(host.querySelector('img[alt="引用图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/qa/images/b.png",
  );
  await act(async () => {
    undo(view);
  });
  expect(source).toBe(original);
  expect(host.querySelector('img[alt="引用图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/qa/images/a.png",
  );
  vi.unstubAllGlobals();
});

it("混合表格携带外部引用定义，选择单元格展开源码，编辑与撤销后恢复渲染", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  source =
    "前言 😀\n\n| 名称 | 图片 |\n| --- | --- |\n| [文字][site] | ![表格图片][image] |\n\n[site]: https://example.com\n[image]: images/a.png\n\n末尾";
  const original = source;
  await act(async () =>
    root.render(
      <SourceEditor
        content={source}
        editing
        markdown
        presentation="hybrid"
        imageBaseDir="/qa"
        fontSize={14}
        editorRef={editor}
        onChange={(value) => {
          source = value;
        }}
      />,
    ),
  );
  const view = editor.current!.view!;
  const cell = source.indexOf("文字");
  expect(host.querySelector('table a[href="https://example.com"]')).not.toBeNull();
  expect(host.querySelector('table img[alt="表格图片"]')?.getAttribute("src")).toBe(
    "asset://localhost/qa/images/a.png",
  );
  await act(async () => editor.current!.setSelectionRange(cell, cell));
  expect(host.querySelector("table")).toBeNull();
  expect(view.contentDOM.textContent).toContain("[文字][site]");
  await act(async () => editor.current!.insertText("新"));
  expect(source).toBe(original.replace("文字", "新文字"));
  await act(async () => editor.current!.setSelectionRange(source.length, source.length));
  expect(host.querySelector("table")?.textContent).toContain("新文字");
  await act(async () => {
    undo(view);
  });
  expect(source).toBe(original);
  expect(editor.current!.view).toBe(view);
});

it.each([false, true])("混合提示块任务沿用%s只读状态的保存路径，锁定禁用", async (readOnly) => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  source =
    "前言\n\n> [!NOTE]\n> - [ ] 提示任务\n> [引用][site]\n\n[site]: https://example.com\n\n末尾";
  const original = source;
  const onReadTaskToggle = vi.fn();
  const show = (locked = false, callback = onReadTaskToggle) =>
    root.render(
      <SourceEditor
        content={source}
        editing={!readOnly}
        locked={locked}
        markdown
        presentation="hybrid"
        fontSize={14}
        editorRef={editor}
        onReadTaskToggle={callback}
        onChange={(value) => {
          source = value;
        }}
      />,
    );
  await act(async () => show());
  const view = editor.current!.view!;
  await act(async () => {
    expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true);
  });
  expect(host.querySelector('[role="note"] a')?.getAttribute("href")).toBe("https://example.com");
  if (!readOnly)
    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: "新增\n" }, userEvent: "input" });
    });
  const before = source;
  const task = host.querySelector<HTMLInputElement>('[role="note"] input')!;
  expect(task.disabled).toBe(false);
  await act(async () => task.click());
  if (readOnly) {
    expect(onReadTaskToggle).toHaveBeenCalledWith(source.indexOf("[ ]"), true);
    expect(source).toBe(original);
    const replacement = vi.fn();
    await act(async () => show(false, replacement));
    await act(async () => host.querySelector<HTMLInputElement>('[role="note"] input')!.click());
    expect(replacement).toHaveBeenCalledWith(source.indexOf("[ ]"), true);
    expect(onReadTaskToggle).toHaveBeenCalledTimes(1);
  } else {
    expect(source).toBe(before.replace("[ ]", "[x]"));
    expect(onReadTaskToggle).not.toHaveBeenCalled();
    await act(async () => {
      undo(view);
    });
    expect(source).toBe(before);
  }
  await act(async () => show(true));
  expect(host.querySelector<HTMLInputElement>('[role="note"] input')!.disabled).toBe(true);
});
