import { useCallback, useRef } from "react";
import type { TFunction } from "i18next";
import { saveImage, saveLinkedImage } from "./api";
import type { SourceEditorHandle } from "../markdown/SourceEditor";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

interface UseImagePasteOptions {
  noteId: string | null;
  linkedBindingId?: string;
  pendingRef?: React.RefObject<Promise<void> | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | SourceEditorHandle | null>;
  setContent: (content: string) => void;
  markDirty: () => void;
  onEnsureNoteSaved: () => Promise<string | null>;
  disabled?: boolean;
  onError?: (message: string) => void;
  t?: TFunction;
}

async function processImageFile(
  file: File,
  noteId: string,
  t?: TFunction,
  linked = false,
): Promise<string | null> {
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error(
      t?.("errors.imageTooLarge", { defaultValue: "图片文件过大（上限 20 MB）" }) ??
        "图片文件过大（上限 20 MB）",
    );
  }

  const ext = MIME_TO_EXT[file.type];
  if (!ext) return null;

  const buffer = await file.arrayBuffer();
  return (linked ? saveLinkedImage : saveImage)(noteId, new Uint8Array(buffer), ext);
}

export function insertTextAtCursor(
  textarea: HTMLTextAreaElement | SourceEditorHandle,
  setContent: (value: string) => void,
  text: string,
) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  const insertion = (needsLeadingNewline ? "\n" : "") + text + "\n";

  textarea.focus();
  if ("insertText" in textarea) {
    textarea.insertText(insertion);
    return;
  }
  document.execCommand("insertText", false, insertion);
  setContent(textarea.value);
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i];
    if (item.kind === "file" && item.type in MIME_TO_EXT) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function useImagePaste({
  noteId,
  linkedBindingId,
  pendingRef,
  textareaRef,
  setContent,
  markDirty,
  onEnsureNoteSaved,
  disabled,
  onError,
  t,
}: UseImagePasteOptions) {
  const processingRef = useRef(false);
  const identity = useRef(noteId ?? linkedBindingId);
  identity.current = noteId ?? linkedBindingId;

  const processFiles = useCallback(
    async (files: File[]) => {
      if (processingRef.current || files.length === 0) return;
      processingRef.current = true;

      const targetIdentity = identity.current;
      let insertion: ReturnType<NonNullable<SourceEditorHandle["prepareInsertion"]>> | undefined;
      try {
        let resolvedId = linkedBindingId ?? noteId;
        if (!resolvedId) {
          resolvedId = await onEnsureNoteSaved();
          if (!resolvedId) return;
        }

        const matchesTarget = () =>
          identity.current === targetIdentity ||
          (targetIdentity == null && identity.current === resolvedId);
        const textarea = textareaRef.current;
        if (!textarea || !matchesTarget()) return;
        insertion = "prepareInsertion" in textarea ? textarea.prepareInsertion?.() : undefined;

        const markdownLines: string[] = [];
        for (const file of files) {
          const relativePath = await processImageFile(file, resolvedId, t, !!linkedBindingId);
          if (relativePath) {
            markdownLines.push(`![](${relativePath})`);
          }
        }

        if (markdownLines.length > 0 && matchesTarget() && textareaRef.current === textarea) {
          if (insertion) insertion.insert("\n" + markdownLines.join("\n") + "\n");
          else insertTextAtCursor(textarea, setContent, markdownLines.join("\n"));
          markDirty();
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : (t?.("errors.imagePasteFailed", { defaultValue: "图片粘贴失败" }) ?? "图片粘贴失败");
        onError?.(message);
      } finally {
        insertion?.cancel();
        processingRef.current = false;
      }
    },
    [noteId, linkedBindingId, textareaRef, setContent, markDirty, onEnsureNoteSaved, onError, t],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      if (disabled) return;
      const files = getImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      if (processingRef.current) return;
      const work = processFiles(files);
      if (pendingRef) pendingRef.current = work;
      void work.finally(() => {
        if (pendingRef?.current === work) pendingRef.current = null;
      });
    },
    [disabled, processFiles, pendingRef],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (disabled) return;
      const files = getImageFiles(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      if (processingRef.current) return;
      const work = processFiles(files);
      if (pendingRef) pendingRef.current = work;
      void work.finally(() => {
        if (pendingRef?.current === work) pendingRef.current = null;
      });
    },
    [disabled, processFiles, pendingRef],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (disabled) return;
      const hasImage = Array.from(event.dataTransfer.items).some(
        (item) => item.kind === "file" && item.type in MIME_TO_EXT,
      );
      if (hasImage) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [disabled],
  );

  return { handlePaste, handleDrop, handleDragOver };
}
