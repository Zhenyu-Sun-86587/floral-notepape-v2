import { invoke } from "@tauri-apps/api/core";

export interface LinkedBinding {
  id: string;
  path: string;
}

export interface LinkedContent {
  binding: LinkedBinding;
  content: string;
  revision: string;
  imageRoot: string;
}

export interface LinkedDraft {
  content: string | null;
  baseRevision: string;
}

export interface LinkedRoot {
  id: string;
  path: string;
  recursive: boolean;
}

export function bindLinkedFile(path: string): Promise<LinkedBinding> {
  return invoke("linked_bind", { path });
}

export function listLinkedFiles(): Promise<LinkedBinding[]> {
  return invoke("linked_list");
}

export function listLinkedRoots(): Promise<LinkedRoot[]> {
  return invoke("linked_roots");
}

export function bindLinkedRoot(path: string, recursive = false): Promise<LinkedRoot> {
  return invoke("linked_bind_root", { path, recursive });
}

export function unbindLinkedFile(id: string): Promise<void> {
  return invoke("linked_unbind", { id });
}

export function unbindLinkedRoot(id: string): Promise<void> {
  return invoke("linked_unbind_root", { id });
}

export function createLinkedFile(rootId: string, name: string): Promise<LinkedBinding> {
  return invoke("linked_create_in_root", { rootId, name });
}

export function scanLinkedRoots(): Promise<LinkedBinding[]> {
  return invoke("linked_scan_roots");
}

export function readLinkedFile(id: string): Promise<LinkedContent> {
  return invoke("linked_read", { id });
}

export function readLinkedDraft(id: string): Promise<LinkedDraft | null> {
  return invoke("linked_read_draft", { id });
}

const draftWrites = new Map<string, Promise<void>>();

export function writeLinkedDraft(
  id: string,
  content: string | null,
  baseRevision: string,
  discardedContent?: string,
): Promise<void> {
  // Keep a window's edits and save-completion clears in submission order even
  // when native storage work runs on different blocking-pool threads.
  const write = (draftWrites.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      invoke<void>("linked_write_draft", { id, content, baseRevision, discardedContent }),
    );
  draftWrites.set(id, write);
  const release = () => {
    if (draftWrites.get(id) === write) draftWrites.delete(id);
  };
  void write.then(release, release);
  return write;
}

export function saveLinkedFile(
  id: string,
  content: string,
  expectedRevision: string,
  overwrite = false,
): Promise<string> {
  return invoke("linked_save", { id, content, expectedRevision, overwrite });
}

export function toggleLinkedTileWindow(bindingId: string): Promise<boolean> {
  return invoke("toggle_linked_tile_window", { bindingId, bounds: null });
}
