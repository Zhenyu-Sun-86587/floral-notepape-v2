import type { MarkdownDisplayMode } from "../features/markdown/displayMode";
export interface NoteShellProps {
  title: string;
  tile: boolean;
  editing: boolean;
  locked: boolean;
  colors?: { background: string; foreground: string; muted: string };
  displayMode?: MarkdownDisplayMode;
  displayModePending?: boolean;
  noteKey?: string;
  onContentChanged?: () => unknown;
  onError?: (error: unknown) => void;
  actions: Record<string, () => unknown>;
}
