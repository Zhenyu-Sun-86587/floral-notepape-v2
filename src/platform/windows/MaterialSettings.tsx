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
  return (
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
  );
}
