import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface SlidingButtonGroupProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
}

export function SlidingButtonGroup<T extends string>({
  options,
  value,
  onChange,
  className = "",
  buttonClassName = "h-7",
}: SlidingButtonGroupProps<T>) {
  const buttonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const btn = buttonsRef.current.get(value);
    if (!btn) return;
    const update = () => {
      const next = {
        left: btn.offsetLeft,
        top: btn.offsetTop,
        width: btn.offsetWidth,
        height: btn.offsetHeight,
      };
      setPos((prev) =>
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    // A sibling's width changes the selected button's offset even if its own
    // size stays the same, for example when a translated label or font loads.
    const observer = new ResizeObserver(update);
    for (const button of buttonsRef.current.values()) {
      observer.observe(button, { box: "border-box" });
    }
    return () => observer.disconnect();
  }, [options, value]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const transition = animated
    ? "left 0.25s cubic-bezier(0.22,1,0.36,1), top 0.25s cubic-bezier(0.22,1,0.36,1), width 0.25s cubic-bezier(0.22,1,0.36,1), height 0.25s cubic-bezier(0.22,1,0.36,1)"
    : "none";

  return (
    <div
      className={`relative flex items-center gap-1 bg-paper-warm/60 rounded-lg p-[2px] border border-paper-deep/30 ${className}`}
    >
      <div
        className="absolute rounded-md bg-cloud shadow-[0_1px_2px_rgba(0,0,0,0.04)] pointer-events-none sliding-highlight"
        style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height, transition }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          ref={(el) => {
            if (el) buttonsRef.current.set(option.value, el);
            else buttonsRef.current.delete(option.value);
          }}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`relative z-[1] flex flex-1 items-center justify-center rounded-md text-center text-[11px] leading-normal transition-colors duration-200 cursor-pointer ${buttonClassName} ${
            value === option.value
              ? "text-bamboo font-medium"
              : "text-ink-ghost hover:text-ink-faint"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
