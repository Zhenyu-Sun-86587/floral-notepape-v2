import { invoke } from "@tauri-apps/api/core";

export type MaterialStatus = "off" | "active" | "unavailable";
let requested: boolean | null = null;
let requestedRadius: number | null = null;
let status: MaterialStatus = "off";

export function getMaterialStatus(): MaterialStatus {
  return status;
}

export async function applyNativeMaterial(
  enabled: boolean,
  radius: number,
  force = false,
): Promise<void> {
  const root = document.documentElement;
  const material = enabled ? "on" : "off";
  if (root.getAttribute("data-native-material") !== material) {
    root.setAttribute("data-native-material", material);
  }
  const isWindows = navigator.userAgent.includes("Windows");
  const corner =
    !enabled || !isWindows ? null : radius <= 0 ? "none" : radius < 7 ? "small" : "round";
  if (corner === null) {
    if (root.hasAttribute("data-native-corner")) root.removeAttribute("data-native-corner");
  } else if (root.getAttribute("data-native-corner") !== corner) {
    root.setAttribute("data-native-corner", corner);
  }
  if (!force && requested === enabled && requestedRadius === radius) return;
  requested = enabled;
  requestedRadius = radius;
  try {
    const active = await invoke<boolean>("set_native_material", { enabled, radius });
    status = active ? "active" : enabled ? "unavailable" : "off";
    if (enabled && !active) {
      root.setAttribute("data-native-material", "off");
      root.removeAttribute("data-native-corner");
    }
  } catch {
    status = enabled ? "unavailable" : "off";
    requested = null;
    requestedRadius = null;
    root.setAttribute("data-native-material", "off");
    root.removeAttribute("data-native-corner");
  }
  window.dispatchEvent(new Event("native-material-status"));
}
