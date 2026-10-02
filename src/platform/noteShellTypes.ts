export interface NoteShellProps {
  title: string;
  tile: boolean;
  editing: boolean;
  locked: boolean;
  actions: Record<string, () => unknown>;
}
