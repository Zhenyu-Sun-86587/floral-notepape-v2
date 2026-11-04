export const NATIVE_HISTORY_EVENT = "folio-native-history";

// AppKit consumes Cmd+Z before WKWebView's DOM keymap. Route both the menu
// and its accelerator to the same editor; ordinary text fields retain WebKit undo.
export function installNativeEditCommands() {
  let lastEditor: HTMLElement | null = null;
  const remember = (event: FocusEvent) => {
    const target = event.target;
    lastEditor =
      target instanceof HTMLElement ? target.closest<HTMLElement>("[data-source-editor]") : null;
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
        editor ?? (focused === document.body && lastEditor?.isConnected ? lastEditor : null);
      if (target) {
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
