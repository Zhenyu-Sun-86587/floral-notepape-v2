import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { reportError } from "./types";

export function useMaterial() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const receive = (material: string) => {
      if (active) {
        document.documentElement.dataset.material = material;
        setReady(true);
      }
    };
    const listener = listen<string>("mac-material-changed", ({ payload }) => receive(payload));
    void invoke<string>("surface_capsule_material")
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
