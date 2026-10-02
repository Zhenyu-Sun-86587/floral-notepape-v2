import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { reportError } from "./types";

export function useMaterial() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const receive = ({ kind: material, opacity }: { kind: string; opacity: number }) => {
      if (active) {
        document.documentElement.dataset.material = material;
        document.documentElement.style.setProperty("--mac-tint", `${opacity * 0.12}`);
        setReady(true);
      }
    };
    const listener = listen<{ kind: string; opacity: number }>(
      "mac-material-changed",
      ({ payload }) => receive(payload),
    );
    void invoke<{ kind: string; opacity: number }>("surface_capsule_material")
      .then(receive)
      .catch((error: unknown) => {
        reportError(error);
        if (active) setReady(true);
      });
    return () => {
      active = false;
      void listener.then((dispose) => dispose());
    };
  }, []);
  return ready;
}
