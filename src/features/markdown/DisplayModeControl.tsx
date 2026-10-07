import { displayModes, type MarkdownDisplayMode } from "./displayMode";
import "./displayMode.css";

export function DisplayModeControl({
  value,
  onChange,
  onReset,
  followingDefault,
  disabled,
}: {
  value: MarkdownDisplayMode;
  onChange: (mode: MarkdownDisplayMode) => void;
  onReset?: () => void;
  followingDefault?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className="display-mode-control"
      role="group"
      aria-label="Markdown 显示方式"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {displayModes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          aria-pressed={value === mode.value}
          title={mode.description}
          disabled={disabled}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      ))}
      {onReset && (
        <button
          type="button"
          aria-label="跟随默认显示方式"
          title={followingDefault ? "正在跟随设置中的默认方式" : "恢复跟随默认显示方式"}
          aria-pressed={followingDefault}
          disabled={disabled}
          onClick={onReset}
        >
          ↺
        </button>
      )}
    </div>
  );
}
