export interface NoteShellProps {
  title: string;
  tile: boolean;
  editing: boolean;
  locked: boolean;
  noteKey?: string;
  onContentChanged?: () => unknown;
  actions: Record<string, () => unknown>;
}
