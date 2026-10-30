import type { NoteShellProps } from "../noteShellTypes";
export const singleClickToEdit = true;
export const displayTitleSelection = {
  attributes: { "data-tile-selectable": "true" },
  className: "select-text",
};
export function useNativeNoteShell(_: NoteShellProps) {}
export function useNativeEditCommands() {}

export const liveMarkdownEditing = false;
