import { invoke } from "@tauri-apps/api/core";
import "./material.css";
export type MaterialStatus = "off" | "active" | "unavailable";
let status: MaterialStatus = "off";
let epoch = 0;
export const getMaterialStatus = () => status;
export async function applyNativeMaterial(_enabled: boolean, radius: number, _force = false) {
  const request = ++epoch;
  try {
    const kind = await invoke<string>("surface_apply_material", { radius });
    if (request !== epoch) return;
    document.documentElement.dataset.macMaterial = kind;
    document.documentElement.dataset.nativeMaterial = ["glass", "frosted"].includes(kind)
      ? "on"
      : "off";
    status = kind === "off" ? "off" : "active";
  } catch (cause) {
    if (request !== epoch) return;
    status = "unavailable";
    delete document.documentElement.dataset.macMaterial;
    console.error("Mac material", cause);
  }
  window.dispatchEvent(new Event("native-material-status"));
}
