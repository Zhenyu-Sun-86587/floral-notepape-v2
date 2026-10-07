import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { getNote, updateNote, getErrorMessage } from "../../../features/notes/api";
import {
  readLinkedFile,
  readLinkedDraft,
  saveLinkedFile,
  writeLinkedDraft,
  type LinkedContent,
} from "../../../features/linked/api";
import { getConfig } from "../../../features/settings/api";
import type { AppConfig } from "../../../features/settings/types";
import type { Note } from "../../../features/notes/types";
import type { SourceEditorHandle } from "../../../features/markdown/SourceEditor";
import { reportInstallPreparation } from "../../../features/update/api";
import type { Preview } from "./useCapsulePreview";

interface Session {
  key: string;
  generation: number;
  target: Note | LinkedContent;
  content: string;
  saved: string;
  sequence: number;
  config: AppConfig;
}
interface LeaveRequest {
  key: string;
  generation: number;
  requestId: number;
}
export function useCapsuleEditing(
  preview: Preview | null,
  occupied: RefObject<boolean>,
  editor: RefObject<SourceEditorHandle | null>,
  pendingImages: RefObject<Promise<void> | null>,
) {
  const session = useRef<Session | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [snapshot, setSnapshot] = useState<Session | null>(null);
  const [phase, setPhase] = useState<"reading" | "loading" | "editing" | "leaving">("reading");
  const [status, setStatus] = useState<"clean" | "dirty" | "saving" | "error">("clean");
  const [error, setError] = useState("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loading = useRef<Promise<void> | null>(null);
  const leaving = useRef(false);
  const finishing = useRef(false);
  const pendingLeave = useRef<LeaveRequest | undefined>(undefined);
  const [inputBlocked, setInputBlocked] = useState(false);
  const frozen = useRef(false);
  const current = useRef(preview);
  current.current = preview;
  const publish = () => setSnapshot(session.current ? { ...session.current } : null);
  const autoSave = (s: Session) =>
    "binding" in s.target ? s.config.externalFileAutoSave : s.config.noteSurfaceAutoSave;
  const fail = (cause: unknown) => {
    setError(getErrorMessage(cause));
    setStatus("error");
  };
  const save = (): Promise<void> => {
    const requestedSession = session.current;
    const operation = queue.current
      .catch(() => undefined)
      .then(async () => {
        const s = session.current;
        if (!s || s !== requestedSession || s.content === s.saved) return;
        setStatus("saving");
        const content = s.content;
        if ("binding" in s.target) {
          const revision = await saveLinkedFile(s.target.binding.id, content, s.target.revision);
          s.target = { ...s.target, content, revision };
          // The clear is submitted only after checking the latest draft, in the same ordered queue.
          await writeLinkedDraft(
            s.target.binding.id,
            s.content === content ? null : s.content,
            revision,
          );
        } else {
          s.target = await updateNote(
            s.target.id,
            { title: s.target.title, category: s.target.category, content },
            s.target.updatedAt,
          );
        }
        s.saved = content;
        setStatus(s.content === content ? "clean" : "dirty");
        setError("");
        publish();
      });
    queue.current = operation;
    return operation;
  };
  const change = (content: string) => {
    const s = session.current;
    if (!s || leaving.current || inputBlocked) return;
    s.content = content;
    s.sequence++;
    publish();
    setStatus(content === s.saved ? "clean" : "dirty");
    if ("binding" in s.target)
      void writeLinkedDraft(s.target.binding.id, content, s.target.revision).catch(fail);
  };
  const begin = () => {
    if (occupied.current || !current.current || current.current.entry.locked || frozen.current)
      return;
    const selected = current.current;
    occupied.current = true;
    setPhase("loading");
    setError("");
    const work = async () => {
      let acquired = false;
      try {
        await invoke("surface_capsule_begin_edit", {
          key: selected.entry.key,
          generation: selected.generation,
        });
        acquired = true;
        const config = await getConfig();
        setConfig(config);
        if (!config.inlineEditing) throw new Error("原位编辑已关闭，请使用展开编辑入口");
        const linked = selected.entry.key.startsWith("linked:");
        const id = selected.entry.key.slice(linked ? 7 : 5);
        const target = linked ? await readLinkedFile(id) : await getNote(id);
        const draft = linked ? await readLinkedDraft(id) : null;
        if (
          current.current?.entry.key !== selected.entry.key ||
          current.current?.generation !== selected.generation
        )
          throw new Error("预览已切换，请重新点击编辑");
        let content = target.content;
        if (draft?.content != null && "revision" in target) {
          content = draft.content;
          if (draft.baseRevision !== target.revision) {
            // Preserve the draft's base so a normal save detects the conflict.
            target.revision = draft.baseRevision;
            setError("原文件已变化，保留了未保存草稿。可复制草稿或重新加载原文件。");
          }
        }
        session.current = {
          key: selected.entry.key,
          generation: selected.generation,
          target,
          content,
          saved: target.content,
          sequence: 0,
          config,
        };
        publish();
        setStatus(content === target.content ? "clean" : "dirty");
        setPhase("editing");
      } catch (cause) {
        fail(cause);
        if (acquired)
          await invoke("surface_capsule_abort_edit", {
            key: selected.entry.key,
            generation: selected.generation,
          }).catch(fail);
        pendingLeave.current = undefined;
        occupied.current = false;
        setPhase("reading");
      }
    };
    loading.current = work().finally(() => {
      loading.current = null;
    });
  };
  const settleInput = async () => {
    // Do not hide or replace the editor until the real composition has ended.
    const started = Date.now();
    while (editor.current?.composing) {
      if (Date.now() - started > 10000) throw new Error("请先完成输入法候选，再重试");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await pendingImages.current;
  };
  const finish = async (request?: LeaveRequest, implicit = false) => {
    if (finishing.current || frozen.current) return;
    finishing.current = true;
    await loading.current;
    const s = session.current;
    if (!s || (request && (request.key !== s.key || request.generation !== s.generation))) {
      finishing.current = false;
      return;
    }
    if (implicit && (!autoSave(s) || error) && !pendingLeave.current) {
      finishing.current = false;
      return;
    }
    // Keep input enabled while IME/image work is settling, then freeze for the decision.
    try {
      await settleInput();
      leaving.current = true;
      setPhase("leaving");
      await queue.current.catch(() => undefined);
      let discard = false;
      if (s.content !== s.saved && !autoSave(s)) {
        const choice = await message("当前便签有未保存的修改。", {
          title: "保存修改",
          kind: "warning",
          buttons: { yes: "保存", no: "放弃修改", cancel: "取消" },
        });
        if (choice === "取消") {
          if (pendingLeave.current ?? request)
            await invoke("surface_capsule_finish_edit", {
              key: s.key,
              generation: s.generation,
              requestId: (pendingLeave.current ?? request)?.requestId,
              ready: false,
            });
          return;
        }
        discard = choice === "放弃修改";
      }
      if (discard) {
        if ("binding" in s.target)
          await writeLinkedDraft(s.target.binding.id, null, s.target.revision, s.content);
      } else await save();
      const accepted = await invoke<boolean>("surface_capsule_finish_edit", {
        key: s.key,
        generation: s.generation,
        requestId: (pendingLeave.current ?? request)?.requestId,
        ready: true,
      });
      if (!accepted) throw new Error("离开请求已变化，请重试；当前草稿仍保留");
      session.current = null;
      occupied.current = false;
      publish();
      setPhase("reading");
      setStatus("clean");
      setError("");
    } catch (cause) {
      fail(cause);
      if (pendingLeave.current ?? request)
        await invoke("surface_capsule_finish_edit", {
          key: s.key,
          generation: s.generation,
          requestId: (pendingLeave.current ?? request)?.requestId,
          ready: false,
        }).catch(fail);
    } finally {
      leaving.current = false;
      finishing.current = false;
      pendingLeave.current = undefined;
      if (session.current) setPhase("editing");
    }
  };
  // Explicit reload is the conflict recovery path; never silently overwrite local text.
  const reload = async () => {
    const s = session.current;
    if (!s || leaving.current || frozen.current) return;
    const confirmed = await message("重新加载会放弃当前未保存修改。", {
      title: "重新加载",
      kind: "warning",
      buttons: { ok: "重新加载", cancel: "取消" },
    });
    if (confirmed !== "重新加载") return;
    try {
      await settleInput();
      leaving.current = true;
      await queue.current.catch(() => undefined);
      s.target =
        "binding" in s.target
          ? await readLinkedFile(s.target.binding.id)
          : await getNote(s.target.id);
      if ("binding" in s.target)
        await writeLinkedDraft(s.target.binding.id, null, s.target.revision, s.content);
      s.content = s.saved = s.target.content;
      s.sequence++;
      publish();
      setError("");
      setStatus("clean");
    } catch (cause) {
      fail(cause);
    } finally {
      leaving.current = false;
    }
  };
  const refreshClean = async () => {
    const s = session.current;
    if (!s || s.content !== s.saved || editor.current?.composing || leaving.current) return;
    const sequence = s.sequence;
    await queue.current.catch(() => undefined);
    const target =
      "binding" in s.target
        ? await readLinkedFile(s.target.binding.id)
        : await getNote(s.target.id);
    if (
      session.current !== s ||
      sequence !== s.sequence ||
      s.content !== s.saved ||
      editor.current?.composing
    )
      return;
    s.target = target;
    s.content = s.saved = target.content;
    publish();
  };
  useEffect(() => {
    let disposed = false;
    let changed = false;
    const off = listen<AppConfig>("config-changed", ({ payload }) => {
      changed = true;
      if (!disposed) setConfig(payload);
    });
    void getConfig()
      .then((value) => {
        if (!disposed && !changed) setConfig(value);
      })
      .catch(fail);
    return () => {
      disposed = true;
      void off.then((stop) => stop());
    };
  }, []);
  const actions = useRef({ finish, save, fail, settleInput, refreshClean });
  actions.current = { finish, save, fail, settleInput, refreshClean };
  useEffect(() => {
    if (!snapshot || status !== "dirty" || !autoSave(snapshot)) return;
    const timer = setTimeout(() => {
      if (!editor.current?.composing && !leaving.current)
        void actions.current.save().catch(actions.current.fail);
    }, 600);
    return () => clearTimeout(timer);
  }, [snapshot?.content, status, phase]);
  useEffect(() => {
    const subscriptions = [
      listen("notes-changed", () => {
        if (session.current?.key.startsWith("note:"))
          void actions.current.refreshClean().catch(actions.current.fail);
      }),
      listen<{ bindingId: string }>("linked-content-changed", ({ payload }) => {
        if (session.current?.key === `linked:${payload.bindingId}`)
          void actions.current.refreshClean().catch(actions.current.fail);
      }),
      listen<LeaveRequest>("capsule-prepare-leave", ({ payload }) => {
        pendingLeave.current = payload;
        void actions.current.finish(payload);
      }),
      listen<boolean>("app://exit-freeze", ({ payload }) => {
        frozen.current = payload;
        if (!payload) setInputBlocked(false);
      }),
      listen<{ requestId: string }>("update://prepare-install", ({ payload }) => {
        void (async () => {
          try {
            await loading.current;
            await actions.current.settleInput();
            setInputBlocked(true);
            await queue.current.catch(() => undefined);
            await actions.current.save();
            await reportInstallPreparation(payload.requestId, "capsule-preview", "ready");
          } catch (cause) {
            actions.current.fail(cause);
            await reportInstallPreparation(
              payload.requestId,
              "capsule-preview",
              "failed",
              getErrorMessage(cause),
            );
          }
        })().catch(actions.current.fail);
      }),
    ];
    const keydown = (event: KeyboardEvent) => {
      if (!session.current || event.isComposing || editor.current?.composing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void actions.current.save().catch(actions.current.fail);
      } else if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"],[role="menu"]')
      ) {
        event.preventDefault();
        void actions.current.finish();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      subscriptions.forEach((p) => void p.then((off) => off()));
      window.removeEventListener("keydown", keydown);
    };
  }, []);
  return {
    snapshot,
    config,
    phase,
    status,
    error,
    inputBlocked,
    begin,
    change,
    finish,
    reload,
    save: () => save().catch(fail),
    reportError: fail,
  };
}
