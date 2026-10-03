import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NoteShellProps } from "../noteShellTypes";
export const displayTitleSelection = {
  attributes: { "data-note-display-title": "true" },
  className: "select-none",
};
export const singleClickToEdit = false;
export function useNativeNoteShell(props: NoteShellProps) {
  const state = useRef(props);
  state.current = props;
  const actions = useRef(props.actions);
  actions.current = props.actions;
  useEffect(() => {
    const off = listen<string>("native-note-action", ({ payload }) => {
      void Promise.resolve(actions.current[payload]?.()).catch(console.error);
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
      state: { title: props.title, tile: props.tile, editing: props.editing, locked: props.locked },
    })
      .then((ready) => {
        if (active) document.documentElement.dataset.nativeNoteShell = String(ready);
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [props.title, props.tile, props.editing, props.locked]);
}
