import chroma from "chroma-js";
import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_TILE_COLOR, normalizeTileColor } from "../features/settings/tileColor";
import { MarkdownPreviewLazy as MarkdownPreview } from "../features/markdown/MarkdownPreviewLazy";
import type { SourceEditorHandle } from "../features/markdown/SourceEditor";

// 列表中的只读 Tile 不加载编辑器；独立便签首次打开时才按需加载一次。
const SourceEditor = lazy(() =>
  import("../features/markdown/SourceEditor").then((module) => ({ default: module.SourceEditor })),
);

export interface TileProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "color" | "content" | "title"
> {
  title?: string;
  content: string;
  color?: string;
  width?: number | string;
  rotation?: number;
  fontSize?: number;
  renderMarkdown?: boolean;
  imageBaseDir?: string;
  imageRootDir?: string;
  allowRemoteImages?: boolean;
  onTaskToggle?: (offset: number, checked: boolean) => void;
  editing?: boolean;
  titleEditable?: boolean;
  onTitleChange?: (value: string) => void;
  onContentChange?: (value: string) => void;
  contentEditorRef?: Ref<SourceEditorHandle>;
  onEditorActivate?: () => void;
  onEditorDeactivate?: () => void;
  locked?: boolean;
  scrollContainerRef?: Ref<HTMLDivElement>;
  onEditorPaste?: HTMLAttributes<HTMLDivElement>["onPaste"];
  onEditorDrop?: HTMLAttributes<HTMLDivElement>["onDrop"];
  onEditorDragOver?: HTMLAttributes<HTMLDivElement>["onDragOver"];
}

const MARK_SIZE = 8;
const MARK_OFFSET = 6;

export function textAgainst(background: string, target: string, contrast: number) {
  for (let amount = 0.25; amount <= 1.001; amount += 0.05) {
    const color = chroma.mix(background, target, Math.min(amount, 1)).hex();
    if (chroma.contrast(background, color) >= contrast) return color;
  }
  return target;
}

const cornerPaths = [
  {
    pos: { top: MARK_OFFSET, left: MARK_OFFSET },
    d: `M0,${MARK_SIZE} L0,0 L${MARK_SIZE},0`,
  },
  {
    pos: { top: MARK_OFFSET, right: MARK_OFFSET },
    d: `M0,0 L${MARK_SIZE},0 L${MARK_SIZE},${MARK_SIZE}`,
  },
  {
    pos: { bottom: MARK_OFFSET, left: MARK_OFFSET },
    d: `M0,0 L0,${MARK_SIZE} L${MARK_SIZE},${MARK_SIZE}`,
  },
  {
    pos: { bottom: MARK_OFFSET, right: MARK_OFFSET },
    d: `M${MARK_SIZE},0 L${MARK_SIZE},${MARK_SIZE} L0,${MARK_SIZE}`,
  },
];

function CornerMarks({ color }: { color: string }) {
  return (
    <>
      {cornerPaths.map((mark, index) => (
        <svg
          key={index}
          className="absolute pointer-events-none"
          data-tile-corner-mark="true"
          style={mark.pos as CSSProperties}
          width={MARK_SIZE}
          height={MARK_SIZE}
          viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
        >
          <path
            d={mark.d}
            stroke={color}
            strokeWidth="0.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </>
  );
}

export function Tile({
  title,
  content,
  color = DEFAULT_TILE_COLOR,
  width = 260,
  rotation = 0,
  fontSize = 14,
  renderMarkdown = false,
  imageBaseDir,
  imageRootDir,
  allowRemoteImages = false,
  onTaskToggle,
  editing = false,
  titleEditable = false,
  onTitleChange,
  onContentChange,
  contentEditorRef,
  onEditorActivate,
  onEditorDeactivate,
  locked,
  scrollContainerRef,
  onEditorPaste,
  onEditorDrop,
  onEditorDragOver,
  className = "",
  style,
  children,
  ...divProps
}: TileProps) {
  const { t } = useTranslation();
  const tileColor = normalizeTileColor(color);
  const { borderColor, cornerColor, titleColor, contentColor, emptyColor, accentColor } =
    useMemo(() => {
      const isLightBg = chroma(tileColor).luminance() > 0.18;
      const mixTarget = isLightBg ? "#141816" : "#f7f8f4";
      const accentTarget = isLightBg ? "#254f3a" : "#a8d2ae";
      return {
        borderColor: chroma.mix(tileColor, mixTarget, 0.18).alpha(0.55).css(),
        cornerColor: chroma.mix(tileColor, mixTarget, 0.3).alpha(0.26).css(),
        titleColor: textAgainst(tileColor, mixTarget, 7),
        contentColor: textAgainst(tileColor, mixTarget, 4.5),
        emptyColor: textAgainst(tileColor, mixTarget, 3),
        accentColor: textAgainst(tileColor, accentTarget, 4.5),
      };
    }, [tileColor]);
  const mergedStyle: CSSProperties & Record<`--${string}`, string> = {
    width,
    backgroundColor: `color-mix(in srgb, ${tileColor} var(--appearance-opacity-percent, 100%), transparent)`,
    borderColor,
    // 局部语义色同时供 CodeMirror 与 MarkdownPreview 使用，正文不叠透明度。
    "--surface-text-primary": titleColor,
    "--surface-text-secondary": contentColor,
    "--surface-text-muted": emptyColor,
    "--surface-accent": accentColor,
    "--color-ink": titleColor,
    "--color-ink-soft": contentColor,
    "--color-ink-faint": emptyColor,
    "--color-bamboo": accentColor,
    "--color-bamboo-light": accentColor,
    "--color-accent": accentColor,
    transition: "box-shadow 0.3s ease",
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
    ...style,
  };

  return (
    <div
      {...divProps}
      className={`app-surface-frame relative border overflow-hidden select-none shadow-[0_1px_8px_rgba(26,26,24,0.04)] hover:shadow-[0_6px_24px_rgba(26,26,24,0.07)] ${className}`}
      style={mergedStyle}
    >
      <div
        ref={scrollContainerRef}
        className="px-4 pt-4 pb-4 h-full overflow-y-auto scrollbar-hidden"
      >
        {editing && titleEditable ? (
          <input
            value={title ?? ""}
            onChange={(event) => onTitleChange?.(event.target.value)}
            aria-label="便签标题"
            className="font-display tracking-wide mb-3 leading-snug bg-transparent border-0 outline-none w-full pl-0 pr-24 py-0 select-text"
            style={{ color: titleColor, fontSize: `${fontSize + 1}px` }}
          />
        ) : title ? (
          <div
            data-tile-selectable="true"
            className="font-display tracking-wide mb-3 leading-snug pr-24 select-text"
            style={{ color: titleColor, fontSize: `${fontSize + 1}px` }}
          >
            {title}
          </div>
        ) : null}
        {contentEditorRef ? (
          <div style={{ color: contentColor }}>
            <Suspense fallback={<div className="min-h-[8rem]" />}>
              <SourceEditor
                content={content}
                editing={editing}
                locked={locked}
                markdown={renderMarkdown}
                fontSize={fontSize}
                editorRef={contentEditorRef}
                onChange={onContentChange}
                onActivate={onEditorActivate}
                onDeactivate={onEditorDeactivate}
                onTaskToggle={onTaskToggle}
                imageBaseDir={imageBaseDir}
                imageRootDir={imageRootDir}
                allowRemoteImages={allowRemoteImages}
                onPaste={onEditorPaste}
                onDrop={onEditorDrop}
                onDragOver={onEditorDragOver}
              />
            </Suspense>
          </div>
        ) : content ? (
          renderMarkdown ? (
            <div
              data-tile-selectable="true"
              className="select-text"
              style={{ color: contentColor }}
            >
              <MarkdownPreview
                content={content}
                fontSize={fontSize}
                renderHtml={false}
                imageBaseDir={imageBaseDir}
                imageRootDir={imageRootDir}
                allowRemoteImages={allowRemoteImages}
                onTaskToggle={onTaskToggle}
              />
            </div>
          ) : (
            <div
              data-tile-selectable="true"
              className="leading-[1.8] whitespace-pre-wrap font-body select-text"
              style={{
                color: contentColor,
                fontSize: `${fontSize}px`,
                lineHeight: "var(--appearance-line-height)",
              }}
            >
              {content}
            </div>
          )
        ) : (
          <div
            className="font-body text-center py-6"
            style={{ color: emptyColor, fontSize: `${fontSize}px` }}
          >
            {t("tile.empty", { defaultValue: "空" })}
          </div>
        )}
      </div>

      <CornerMarks color={cornerColor} />
      {children}
    </div>
  );
}
