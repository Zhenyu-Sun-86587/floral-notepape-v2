import {
  nextDisplayMode,
  displayModes,
  displayModeCycleLabel,
  type MarkdownDisplayMode,
} from "./displayMode";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div
      className="display-mode-control"
      role="group"
      aria-label={t("markdown.displayMode.label")}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {displayModes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          aria-pressed={value === mode.value}
          title={t(`markdown.displayMode.${mode.value}Description`)}
          disabled={disabled}
          onClick={() => onChange(mode.value)}
        >
          {t(`markdown.displayMode.${mode.value}`)}
        </button>
      ))}
      {onReset && (
        <button
          type="button"
          aria-label={t("markdown.displayMode.followDefault")}
          title={t(
            followingDefault
              ? "markdown.displayMode.followingDefault"
              : "markdown.displayMode.reset",
          )}
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

/** Compact surface toolbar control; Settings keeps the explicit three-way choice. */
export function DisplayModeCycleButton({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: MarkdownDisplayMode;
  onChange: (mode: MarkdownDisplayMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const next = displayModes.find((mode) => mode.value === nextDisplayMode(value))!;
  const label = displayModeCycleLabel(value, t);
  return (
    <button
      type="button"
      className={`display-mode-cycle ${className}`}
      data-display-mode={value}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={() => onChange(next.value)}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {value === "source" ? (
          <path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16" />
        ) : value === "hybrid" ? (
          <path d="m3 18 5-12 5 12M5 14h6m4-7h6m-6 5h6m-6 5h6" />
        ) : (
          <>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}
