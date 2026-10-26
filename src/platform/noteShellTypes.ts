import type { MarkdownDisplayMode } from "../features/markdown/displayMode";
export interface NoteShellProps {
  title: string;
  tile: boolean;
  editing: boolean;
  locked: boolean;
  displayMode?: MarkdownDisplayMode;
  displayModePending?: boolean;
  noteKey?: string;
  onContentChanged?: () => unknown;
  actions: Record<string, () => unknown>;
}
