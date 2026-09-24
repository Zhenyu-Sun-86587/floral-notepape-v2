import { invoke } from "@tauri-apps/api/core";

export type StartupBehavior = "hidden" | "restoreLast" | "expanded";
export type Presentation = "hidden" | "expanded" | "stored";
export type CapsuleSide = "left" | "right" | "top";
export type WindowMode = "normal" | "alwaysOnTop" | "desktopAttached";

export interface SurfaceSession {
  key: string;
  startupBehavior: StartupBehavior;
  presentation: Presentation;
  shortcut: string;
  windowMode: WindowMode;
  locked: boolean;
  capsuleSide: CapsuleSide;
  capsuleMonitor?: string | null;
  capsuleOffset?: number | null;
  expandedBounds: {
    monitorName: string | null;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    savedScale: number;
  } | null;
}

export function getSurfaceSession(key: string): Promise<SurfaceSession> {
  return invoke("surface_session_get", { key });
}

export function saveSurfaceSession(session: SurfaceSession): Promise<void> {
  return invoke("surface_session_save", { session });
}
