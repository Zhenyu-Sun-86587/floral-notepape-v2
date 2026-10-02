export interface PlatformConfig {}
export function PlatformSettings(_: { config: unknown; onChange: unknown }) {
  return null;
}
export const desktopLayerHint =
  "桌面层位于普通应用下方；编辑时临时回到普通层。需要悬浮时请选择置顶模式。";
export const materialLabel = "原生磨砂";

export const desktopLayerLabel = "桌面层";
export const supportsDesktopLayer = false;

import { MaterialSettings as SharedMaterialSettings } from "../windows/MaterialSettings";
import type { AppConfig } from "../../features/settings/types";
export function MaterialSettings(props: {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}) {
  return <SharedMaterialSettings {...props} label={materialLabel} />;
}
