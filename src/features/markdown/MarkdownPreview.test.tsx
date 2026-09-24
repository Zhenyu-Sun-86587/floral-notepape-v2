import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownPreview", () => {
  test("marks rendered Markdown content as selectable", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="# 花笺\n\n正文" />);

    expect(markup).toContain("markdown-selectable");
    expect(markup).toContain("<h1");
    expect(markup).toContain("花笺");
    expect(markup).toContain("正文");
  });

  test("keeps code block controls outside the horizontally scrollable pre", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```text\nvery long code line\n```"} />,
    );

    const preCloseIndex = markup.indexOf("</pre>");
    const buttonIndex = markup.indexOf("<button");

    expect(markup).toContain("markdown-code-block");
    expect(markup).toContain("markdown-code-scroll");
    expect(preCloseIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeGreaterThan(preCloseIndex);
  });

  test("highlights a known code language without changing code text", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```js\nconst value = 1;\n```"} />,
    );

    expect(markup).toContain("hljs-keyword");
    expect(markup).toContain("value");
    expect(markup).toContain("复制");
  });

  test("keeps allowed HTML details and strips event handlers", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview
        content={
          '<details open onclick="alert(1)"><summary>摘要</summary>下标<sub>2</sub><br />正文</details>'
        }
        renderHtml
      />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("<summary>摘要</summary>");
    expect(markup).toContain("<sub>2</sub>");
    expect(markup).not.toContain("onclick");
  });

  test("hides the list marker only for Markdown task items", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"- [ ] 待办\n- 普通列表"} />);

    expect(markup).toMatch(/<li class="[^"]*list-none[^"]*"><input/);
    expect(markup).toMatch(/<li class="text-ink-soft leading-\[1\.9\] ">普通列表<\/li>/);
  });

  test("hides only a complete leading frontmatter block in preview", () => {
    const content = "\uFEFF---\r\ntitle: 私有标题\r\n---\r\n# 正文\r\n\r\n---\r\n后续正文";
    const markup = renderToStaticMarkup(<MarkdownPreview content={content} />);

    expect(markup).not.toContain("私有标题");
    expect(markup).toContain("正文");
    expect(markup).toContain("<hr");
    expect(renderToStaticMarkup(<MarkdownPreview content={"---\n正文"} />)).toContain("正文");
  });

  test("enables checkboxes only when task writes are available", () => {
    const content = "- [ ] 重复\n- [x] 重复";
    const interactive = renderToStaticMarkup(
      <MarkdownPreview content={content} onTaskToggle={() => undefined} />,
    );
    const passive = renderToStaticMarkup(<MarkdownPreview content={content} />);

    expect(interactive).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
    expect(interactive).not.toMatch(/<input[^>]*disabled/);
    expect(passive).toMatch(/<input[^>]*disabled/);
  });
});
