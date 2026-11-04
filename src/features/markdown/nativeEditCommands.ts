export const NATIVE_HISTORY_EVENT = "folio-native-history";
const historyTargets = new WeakMap<Document, HTMLElement>();
export function rememberHistoryTarget(editor: HTMLElement) {
  historyTargets.set(editor.ownerDocument, editor);
}

// AppKit consumes Cmd+Z before WKWebView's DOM keymap. Route both the menu
// and its accelerator to the same editor; ordinary text fields retain WebKit undo.
export function installNativeEditCommands() {
  const remember = (event: FocusEvent) => {
    const target = event.target;
    const editor =
      target instanceof HTMLElement ? target.closest<HTMLElement>("[data-source-editor]") : null;
    if (editor) rememberHistoryTarget(editor);
  };
  document.addEventListener("focusin", remember);
  return {
    cleanup: () => document.removeEventListener("focusin", remember),
    run(action: "undo" | "redo") {
      if (document.body.inert || !["undo", "redo"].includes(action)) return;
      const focused = document.activeElement;
      const editor =
        focused instanceof HTMLElement
          ? focused.closest<HTMLElement>("[data-source-editor]")
          : null;
      const target =
        editor ??
        (focused instanceof HTMLInputElement && focused.type === "checkbox"
          ? focused.closest(".markdown-surface")?.querySelector<HTMLElement>("[data-source-editor]")
          : focused === document.body
            ? historyTargets.get(document)
            : null);
      if (target?.isConnected) {
        target.dispatchEvent(new CustomEvent(NATIVE_HISTORY_EVENT, { detail: action }));
      } else if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) {
        document.execCommand(action);
      }
    },
  };
}
