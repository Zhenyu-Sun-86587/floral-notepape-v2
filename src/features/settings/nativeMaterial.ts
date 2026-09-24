import { invoke } from "@tauri-apps/api/core";

export type MaterialStatus = "off" | "active" | "unavailable";
let requested: boolean | null = null;
let status: MaterialStatus = "off";

export function getMaterialStatus(): MaterialStatus {
  return status;
}

export async function applyNativeMaterial(enabled: boolean): Promise<void> {
  document.documentElement.setAttribute("data-native-material", enabled ? "on" : "off");
  if (requested === enabled) return;
  requested = enabled;
  try {
    const active = await invoke<boolean>("set_native_material", { enabled });
    status = active ? "active" : enabled ? "unavailable" : "off";
  } catch {
    status = enabled ? "unavailable" : "off";
    requested = null;
  }
  window.dispatchEvent(new Event("native-material-status"));
}
