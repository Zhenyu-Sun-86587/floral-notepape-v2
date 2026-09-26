import { createContext, useState, useCallback, useContext, useMemo, useRef, memo } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Components } from "react-markdown";
import "katex/dist/katex.min.css";
import remarkAlerts from "./remarkAlerts";
import { resolveMarkdownImageSrc } from "./imageSrc";
import { hideLeadingFrontmatter } from "./frontmatter";
import remarkTaskOffsets from "./remarkTaskOffsets";
import { highlightCode } from "./highlightCode";
import { MermaidBlock } from "./MermaidBlock";
import { rehypeSourcePosition, sourceAttributes } from "./sourcePosition";

function CodeBlock({
  children,
  language,
  node,
}: {
  children: React.ReactNode;
  language?: string;
  node?: { properties?: Record<string, unknown> };
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const source = extractText(children);
  const highlighted = useMemo(() => highlightCode(source, language ?? ""), [source, language]);

  const handleCopy = useCallback(() => {
    const text = extractText(children);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  if (language?.toLowerCase() === "mermaid")
    return (
      <div {...sourceAttributes(node)} data-source-opaque>
        <MermaidBlock source={source} />
      </div>
    );

  return (
    <div {...sourceAttributes(node)} className="markdown-code-block my-3 relative group">
      <pre
        className={`markdown-code-scroll m-0 px-4 rounded bg-paper-warm/80 overflow-x-auto ${
          language ? "pt-8 pb-3" : "py-3"
        }`}
      >
        {highlighted == null ? (
          children
        ) : (
          <code
            className="text-[0.85em] font-mono text-ink-soft leading-[1.8] whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )}
      </pre>
      {language && (
        <span className="absolute top-2 left-3 text-[10px] font-mono text-ink-faint/70 uppercase tracking-wider select-none">
          {language}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-paper-deep/30 text-ink-ghost opacity-0 group-hover:opacity-100 hover:bg-paper-deep/50 hover:text-ink-soft transition-all cursor-pointer"
      >
        {copied
          ? t("markdown.copied", { defaultValue: "已复制" })
          : t("markdown.copy", { defaultValue: "复制" })}
      </button>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

interface MarkdownPreviewProps {
  content: string;
  fontSize?: number;
  renderHtml?: boolean;
  sourceMapping?: boolean;
  imageBaseDir?: string;
  imageRootDir?: string;
  allowRemoteImages?: boolean;
  onTaskToggle?: (offset: number, checked: boolean) => void;
}

const TaskOffsetContext = createContext<number | null>(null);
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "center", "font", "u", "abbr"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
      "data-alert-type",
      "dataAlertType",
      "dataTaskOffset",
    ],
    font: ["color", "size", "face"],
    abbr: ["title"],
  },
};
const rehypePluginsDefault = [rehypeKatex, rehypeSlug];
const rehypePluginsWithHtml = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
] as Parameters<typeof Markdown>[0]["rehypePlugins"];

function AlertIcon({ type }: { type: string }) {
  switch (type) {
    case "note":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    case "tip":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.149-.176.214-.253.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
        </svg>
      );
    case "important":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.396A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.557ZM8.22 2.097a.25.25 0 0 0-.44 0L1.698 13.493a.25.25 0 0 0 .22.382h12.164a.25.25 0 0 0 .22-.382Z" />
          <path d="M8.75 5.75a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    case "caution":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    default:
      return null;
  }
}

function Blockquote({
  children,
  node,
}: {
  children?: React.ReactNode;
  node?: { properties?: Record<string, unknown> };
}) {
  const { t } = useTranslation();
  const alertType =
    ((node?.properties?.dataAlertType || node?.properties?.["data-alert-type"]) as string) ?? "";
  if (alertType) {
    const alertTitleMap: Record<string, string> = {
      note: t("markdown.alert.note", { defaultValue: "备注" }),
      tip: t("markdown.alert.tip", { defaultValue: "提示" }),
      important: t("markdown.alert.important", { defaultValue: "重要" }),
      warning: t("markdown.alert.warning", { defaultValue: "警告" }),
      caution: t("markdown.alert.caution", { defaultValue: "注意" }),
    };

    return (
      <div
        {...sourceAttributes(node)}
        className={`markdown-alert markdown-alert-${alertType}`}
        role="note"
      >
        <p {...sourceAttributes(node)} className="markdown-alert-title">
          <AlertIcon type={alertType} />
          {alertTitleMap[alertType] ?? alertType.toUpperCase()}
        </p>
        {children}
      </div>
    );
  }
  return (
    <blockquote
      {...sourceAttributes(node)}
      className="border-l-2 border-bamboo/40 pl-4 my-3 text-ink-soft italic leading-[1.9]"
    >
      {children}
    </blockquote>
  );
}

const staticComponents: Components = {
  h1: ({ children, id, node }) => (
    <h1
      {...sourceAttributes(node)}
      id={id}
      className="text-[1.57em] font-display font-bold text-ink mt-6 mb-4 tracking-wide"
    >
      {children}
    </h1>
  ),
  h2: ({ children, id, node }) => (
    <h2
      {...sourceAttributes(node)}
      id={id}
      className="text-[1.21em] font-display font-bold text-ink mt-7 mb-3 tracking-wide"
    >
      {children}
    </h2>
  ),
  h3: ({ children, id, node }) => (
    <h3
      {...sourceAttributes(node)}
      id={id}
      className="text-[1.07em] font-display font-bold text-ink mt-5 mb-2 tracking-wide"
    >
      {children}
    </h3>
  ),
  h4: ({ children, id, node }) => (
    <h4
      {...sourceAttributes(node)}
      id={id}
      className="text-[1em] font-display font-semibold text-ink mt-4 mb-2 tracking-wide"
    >
      {children}
    </h4>
  ),
  h5: ({ children, id, node }) => (
    <h5
      {...sourceAttributes(node)}
      id={id}
      className="text-[0.96em] font-display font-semibold text-ink mt-3 mb-2"
    >
      {children}
    </h5>
  ),
  h6: ({ children, id, node }) => (
    <h6
      {...sourceAttributes(node)}
      id={id}
      className="text-[0.92em] font-display font-semibold text-ink mt-3 mb-2"
    >
      {children}
    </h6>
  ),
  p: ({ children, node }) => (
    <p {...sourceAttributes(node)} className="text-ink-soft leading-[1.9]">
      {children}
    </p>
  ),
  strong: ({ children, node }) => (
    <strong {...sourceAttributes(node)} className="font-semibold text-ink">
      {children}
    </strong>
  ),
  em: ({ children, node }) => (
    <em {...sourceAttributes(node)} className="italic text-bamboo-light">
      {children}
    </em>
  ),
  blockquote: Blockquote,
  ul: ({ children, node }) => (
    <ul
      {...sourceAttributes(node)}
      className="ml-4 text-ink-soft leading-[1.9] list-disc list-outside marker:text-bamboo/40"
    >
      {children}
    </ul>
  ),
  ol: ({ children, node, start }) => (
    <ol
      {...sourceAttributes(node)}
      start={start}
      className="ml-4 text-ink-soft leading-[1.9] list-decimal list-outside marker:text-bamboo/50 marker:font-mono marker:text-[0.85em]"
    >
      {children}
    </ol>
  ),
  hr: ({ node }) => (
    <hr
      {...sourceAttributes(node)}
      className="my-6 border-none h-px bg-gradient-to-r from-transparent via-paper-deep to-transparent"
    />
  ),
  code: ({ className, children, node }) => {
    const isBlock = className?.startsWith("language-") || String(children).includes("\n");
    if (isBlock) {
      return (
        <code
          {...sourceAttributes(node)}
          className="text-[0.85em] font-mono text-ink-soft leading-[1.8] whitespace-pre"
        >
          {children}
        </code>
      );
    }
    return (
      <code
        {...sourceAttributes(node)}
        className="px-1.5 py-0.5 text-[0.85em] font-mono bg-paper-warm rounded text-bamboo"
      >
        {children}
      </code>
    );
  },
  pre: ({ children, node }) => {
    // Extract language from the <code> element's className
    let language = "";
    if (
      children != null &&
      typeof children === "object" &&
      "props" in (children as React.ReactElement)
    ) {
      const codeProps = (children as React.ReactElement<{ className?: string }>).props;
      const match = codeProps.className?.match(/language-(\S+)/);
      if (match) language = match[1];
    }

    return (
      <CodeBlock language={language} node={node}>
        {children}
      </CodeBlock>
    );
  },
  a: ({ href, children, node }) => (
    <a
      {...sourceAttributes(node)}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (!href) return;
        if (/^https?:\/\//i.test(href)) {
          openUrl(href);
        } else if (href.startsWith("#")) {
          const id = decodeURIComponent(href.slice(1));
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
        }
      }}
      className="text-bamboo hover:text-bamboo-light underline underline-offset-2 cursor-pointer"
    >
      {children}
    </a>
  ),
  table: ({ children, node }) => (
    <div {...sourceAttributes(node)} className="my-3 overflow-x-auto">
      <table
        {...sourceAttributes(node)}
        className="w-full text-[0.93em] border-collapse border border-paper-deep/50"
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, style, node }) => (
    <th
      {...sourceAttributes(node)}
      style={style}
      className="px-3 py-1.5 border border-paper-deep/40 font-semibold text-ink text-[0.85em] bg-paper-warm/50"
    >
      {children}
    </th>
  ),
  td: ({ children, style, node }) => (
    <td
      {...sourceAttributes(node)}
      style={style}
      className="px-3 py-1.5 border border-paper-deep/35 text-ink-soft"
    >
      {children}
    </td>
  ),
};

function TaskInput({
  checked,
  onTaskToggle,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  onTaskToggle?: (offset: number, checked: boolean) => void;
}) {
  const offset = useContext(TaskOffsetContext);
  return (
    <input
      {...props}
      checked={checked}
      disabled={offset == null || !onTaskToggle}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={() => {
        if (offset != null) onTaskToggle?.(offset, !checked);
      }}
      className="mr-1.5 accent-bamboo"
    />
  );
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  fontSize = 14,
  renderHtml = false,
  sourceMapping = false,
  imageBaseDir,
  imageRootDir,
  allowRemoteImages = false,
  onTaskToggle,
}: MarkdownPreviewProps) {
  const { t } = useTranslation();
  const taskAction = useRef(onTaskToggle);
  taskAction.current = onTaskToggle;
  const handleTaskToggle = useCallback(
    (offset: number, checked: boolean) => taskAction.current?.(offset, checked),
    [],
  );
  const hasTaskAction = !!onTaskToggle;
  const previewContent = useMemo(() => hideLeadingFrontmatter(content), [content]);
  const sourceOffset = content.length - previewContent.length;
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkMath, remarkAlerts, [remarkTaskOffsets, previewContent, sourceOffset]],
    [previewContent, sourceOffset],
  ) as Parameters<typeof Markdown>[0]["remarkPlugins"];
  const rehypePlugins = useMemo(() => {
    const pipeline = renderHtml ? rehypePluginsWithHtml! : rehypePluginsDefault;
    if (!sourceMapping) return pipeline;
    // 在 KaTeX 替换节点前注入位置；HTML 先清洗，防止原文伪造 source 属性。
    const prefix = renderHtml ? pipeline.slice(0, 2) : [];
    const suffix = renderHtml ? pipeline.slice(2) : pipeline;
    return [...prefix, [rehypeSourcePosition, previewContent, sourceOffset], ...suffix];
  }, [renderHtml, sourceMapping, previewContent, sourceOffset]) as Parameters<
    typeof Markdown
  >[0]["rehypePlugins"];
  const components = useMemo<Components>(
    () => ({
      ...staticComponents,
      h1: ({ children, id, node }) => (
        <h1
          id={id}
          {...sourceAttributes(node)}
          data-source-start={sourceOffset + (node?.position?.start.offset ?? 0)}
          className="text-[1.57em] font-display font-bold text-ink mt-6 mb-4 tracking-wide"
        >
          {children}
        </h1>
      ),
      h2: ({ children, id, node }) => (
        <h2
          id={id}
          {...sourceAttributes(node)}
          data-source-start={sourceOffset + (node?.position?.start.offset ?? 0)}
          className="text-[1.21em] font-display font-bold text-ink mt-7 mb-3 tracking-wide"
        >
          {children}
        </h2>
      ),
      h3: ({ children, id, node }) => (
        <h3
          id={id}
          {...sourceAttributes(node)}
          data-source-start={sourceOffset + (node?.position?.start.offset ?? 0)}
          className="text-[1.07em] font-display font-bold text-ink mt-5 mb-2 tracking-wide"
        >
          {children}
        </h3>
      ),
      p: ({ children, node }) => (
        <p
          {...sourceAttributes(node)}
          data-source-start={sourceOffset + (node?.position?.start.offset ?? 0)}
          className="text-ink-soft leading-[1.9]"
        >
          {children}
        </p>
      ),
      li: ({ children, className, node }) => {
        const rawOffset = node?.properties?.dataTaskOffset;
        const offset =
          typeof rawOffset === "number"
            ? rawOffset
            : typeof rawOffset === "string" && /^\d+$/.test(rawOffset)
              ? Number(rawOffset)
              : null;
        return (
          <TaskOffsetContext.Provider value={offset}>
            <li
              {...sourceAttributes(node)}
              data-source-start={sourceOffset + (node?.position?.start.offset ?? 0)}
              className={`text-ink-soft leading-[1.9] ${className?.includes("task-list-item") ? "list-none" : ""}`}
            >
              {children}
            </li>
          </TaskOffsetContext.Provider>
        );
      },
      input: ({ checked, node: _node, ...props }) => (
        <TaskInput
          {...props}
          checked={checked}
          onTaskToggle={hasTaskAction ? handleTaskToggle : undefined}
        />
      ),
      img: ({ src, alt, srcSet: _srcSet, node, ...props }) => {
        const resolvedSrc = resolveMarkdownImageSrc(
          src,
          imageBaseDir,
          convertFileSrc,
          imageRootDir,
          allowRemoteImages,
        );
        if (!resolvedSrc)
          return (
            <span
              className="inline-flex max-w-full flex-col rounded border border-paper-deep px-3 py-2 text-ink-soft"
              {...sourceAttributes(node)}
              role="img"
              aria-label={alt || "图片不可用"}
            >
              <span>🖼 {alt || "图片"}</span>
              <small className="text-ink-faint">
                {/^https?:\/\//i.test(src ?? "") && !allowRemoteImages
                  ? "远程图片加载已关闭"
                  : "图片路径不可用"}
              </small>
            </span>
          );
        return (
          <img
            {...sourceAttributes(node)}
            src={resolvedSrc}
            alt={alt ?? ""}
            loading="lazy"
            className="w-[50%] rounded my-2 mx-auto block"
            {...props}
          />
        );
      },
    }),
    [allowRemoteImages, imageBaseDir, imageRootDir, hasTaskAction, handleTaskToggle, sourceOffset],
  );
  return (
    <div className="font-body markdown-selectable" style={{ fontSize: `${fontSize}px` }}>
      {previewContent.trim() ? (
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {previewContent}
        </Markdown>
      ) : (
        <p className="text-ink-ghost leading-[1.9]">
          {t("markdown.emptyHint", { defaultValue: "预览区会显示当前笔记内容" })}
        </p>
      )}
    </div>
  );
});
