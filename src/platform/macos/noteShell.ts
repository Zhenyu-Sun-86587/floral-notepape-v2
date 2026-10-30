import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NoteShellProps } from "../noteShellTypes";
import { useTranslation } from "react-i18next";
import { displayModeCycleLabel } from "../../features/markdown/displayMode";
import { installNativeEditCommands } from "../../features/markdown/nativeEditCommands";
export function useNativeEditCommands() {
  useEffect(() => {
    const dispose = installNativeEditCommands();
    const off = listen<"undo" | "redo">("native-edit-action", ({ payload }) =>
      dispose.run(payload),
    );
    return () => {
      dispose.cleanup();
      void off.then((fn) => fn());
    };
  }, []);
}
export const displayTitleSelection = {
  attributes: { "data-note-display-title": "true" },
  className: "select-none",
};
export const singleClickToEdit = true;
export function useNativeNoteShell(props: NoteShellProps) {
  const { t } = useTranslation();
  const displayModeLabel = props.displayMode
    ? displayModeCycleLabel(props.displayMode, t)
    : undefined;
  const state = useRef(props);
  state.current = props;
  const actions = useRef(props.actions);
  actions.current = props.actions;
  useEffect(() => {
    const off = listen<string>("native-note-action", ({ payload }) => {
      if (document.body.inert) return;
      void Promise.resolve()
        .then(() => actions.current[payload]?.())
        .catch((error) => (state.current.onError ?? console.error)(error));
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    const off = listen<string>("widget-note-updated", ({ payload }) => {
      if (payload === state.current.noteKey) {
        void Promise.resolve(state.current.onContentChanged?.()).catch(console.error);
      }
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    let active = true;
    void invoke<boolean>("surface_native_note_state", {
      state: {
        title: props.title,
        tile: props.tile,
        editing: props.editing,
        locked: props.locked,
        colors: props.colors,
        displayMode: props.displayMode,
        displayModeLabel,
        displayModePending: props.displayModePending ?? false,
      },
    })
      .then((ready) => {
        if (active) document.documentElement.dataset.nativeNoteShell = String(ready);
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [
    props.title,
    props.tile,
    props.editing,
    props.locked,
    props.colors?.background,
    props.colors?.foreground,
    props.colors?.muted,
    props.displayMode,
    displayModeLabel,
    props.displayModePending,
  ]);
}

export const liveMarkdownEditing = true;
