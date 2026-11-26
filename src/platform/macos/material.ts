import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./material.css";
let epoch = 0;
function receive({ kind, opacity }: { kind: string; opacity: number }) {
  document.documentElement.style.setProperty("--mac-tint", `${Math.round(opacity * 12)}%`);
  document.documentElement.dataset.macMaterial = kind;
  document.documentElement.dataset.nativeMaterial = ["glass", "frosted"].includes(kind)
    ? "on"
    : "off";
}
// One subscription per WebView lifetime, including windows already open while
// the settings window switches material or changes a surface's concentration.
void listen<{ kind: string; opacity: number }>("mac-material-changed", ({ payload }) =>
  receive(payload),
).catch(console.error);
export async function applyNativeMaterial(_enabled: boolean, radius: number, _force = false) {
  const request = ++epoch;
  try {
    const { kind, opacity } = await invoke<{ kind: string; opacity: number }>(
      "surface_apply_material",
      { radius },
    );
    if (request !== epoch) return;
    receive({ kind, opacity });
  } catch (cause) {
    if (request !== epoch) return;
    delete document.documentElement.dataset.macMaterial;
    console.error("Mac material", cause);
  }
}
