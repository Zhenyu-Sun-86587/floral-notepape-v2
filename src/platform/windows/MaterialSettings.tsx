import { useEffect, useState } from "react";
import { getMaterialStatus } from "../../features/settings/nativeMaterial";
import type { AppConfig } from "../../features/settings/types";

export function MaterialSettings({
  config,
  onChange,
  label = "Windows Acrylic 原生磨砂",
}: {
  label?: string;
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}) {
  const [materialStatus, setMaterialStatus] = useState(getMaterialStatus);
  useEffect(() => {
    const update = () => setMaterialStatus(getMaterialStatus());
    window.addEventListener("native-material-status", update);
    return () => window.removeEventListener("native-material-status", update);
  }, []);
  return (
    <>
      <label className="flex items-center gap-2 text-[11px] text-ink-faint">
        <input
          type="checkbox"
          checked={config.appearance?.nativeMaterial ?? false}
          onChange={(event) =>
            onChange({
              ...config,
              appearance: {
                ...config.appearance,
                version: 1,
                nativeMaterial: event.target.checked,
              },
            })
          }
        />
        {label}
      </label>
      <p className="text-[10px] text-ink-ghost">
        {materialStatus === "active"
          ? "系统已接受原生材质请求；实际磨砂效果以桌面观察为准"
          : materialStatus === "unavailable"
            ? "当前环境不可用，已降级为半透明背景"
            : "原生材质未启用"}
      </p>
    </>
  );
}
