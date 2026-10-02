import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { reportError } from "./types";

export function useMaterial() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void invoke<string>("surface_capsule_material")
      .then((material) => {
        if (active) {
          document.documentElement.dataset.material = material;
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        reportError(error);
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return ready;
}
