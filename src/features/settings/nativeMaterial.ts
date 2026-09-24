import { invoke } from "@tauri-apps/api/core";

export type MaterialStatus = "off" | "active" | "unavailable";
let requested: boolean | null = null;
let requestedRadius: number | null = null;
let status: MaterialStatus = "off";

export function getMaterialStatus(): MaterialStatus {
  return status;
}

export async function applyNativeMaterial(enabled: boolean, radius: number): Promise<void> {
  document.documentElement.setAttribute("data-native-material", enabled ? "on" : "off");
  if (requested === enabled && requestedRadius === radius) return;
  requested = enabled;
  requestedRadius = radius;
  try {
    const active = await invoke<boolean>("set_native_material", { enabled, radius });
    status = active ? "active" : enabled ? "unavailable" : "off";
  } catch {
    status = enabled ? "unavailable" : "off";
    requested = null;
    requestedRadius = null;
  }
  window.dispatchEvent(new Event("native-material-status"));
}
