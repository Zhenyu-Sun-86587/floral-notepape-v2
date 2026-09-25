import chroma from "chroma-js";
import type { CSSProperties, HTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_TILE_COLOR, normalizeTileColor } from "../features/settings/tileColor";
import { MarkdownPreviewLazy as MarkdownPreview } from "../features/markdown/MarkdownPreviewLazy";

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
  contentEditorRef?: Ref<HTMLTextAreaElement>;
  onEditorPaste?: TextareaHTMLAttributes<HTMLTextAreaElement>["onPaste"];
  onEditorDrop?: TextareaHTMLAttributes<HTMLTextAreaElement>["onDrop"];
  onEditorDragOver?: TextareaHTMLAttributes<HTMLTextAreaElement>["onDragOver"];
}

const MARK_SIZE = 8;
const MARK_OFFSET = 6;

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
  const { borderColor, cornerColor, titleColor, contentColor, emptyColor } = useMemo(() => {
    const isLightBg = chroma(tileColor).luminance() > 0.18;
    const mixTarget = isLightBg ? "#1a1a18" : "#ffffff";
    return {
      borderColor: chroma.mix(tileColor, mixTarget, 0.18).alpha(0.55).css(),
      cornerColor: chroma.mix(tileColor, mixTarget, 0.3).alpha(0.26).css(),
      titleColor: chroma.mix(tileColor, mixTarget, 0.4).alpha(0.5).css(),
      contentColor: chroma.mix(tileColor, mixTarget, 0.65).alpha(0.85).css(),
      emptyColor: chroma.mix(tileColor, mixTarget, 0.25).alpha(0.4).css(),
    };
  }, [tileColor]);
  const mergedStyle: CSSProperties = {
    width,
    backgroundColor: `color-mix(in srgb, ${tileColor} var(--appearance-opacity-percent, 100%), transparent)`,
    borderColor,
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
        className={`px-4 pt-4 pb-4 h-full overflow-y-auto scrollbar-hidden ${editing ? "flex flex-col" : ""}`}
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
        {editing ? (
          <textarea
            ref={contentEditorRef}
            value={content}
            onChange={(event) => onContentChange?.(event.target.value)}
            onPaste={onEditorPaste}
            onDrop={onEditorDrop}
            onDragOver={onEditorDragOver}
            aria-label="便签正文"
            placeholder="写点什么……"
            className="w-full flex-1 min-h-[8rem] bg-transparent border-0 outline-none resize-none font-body select-text p-0"
            style={{
              color: contentColor,
              fontSize: `${fontSize}px`,
              lineHeight: "var(--appearance-line-height)",
            }}
          />
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
