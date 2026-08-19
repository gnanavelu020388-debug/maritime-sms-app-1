import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface ScrollSelectOption {
  value: string;
  label: string;
}

/**
 * Dropdown that looks and behaves like a native `<select>` but caps its
 * open panel to `maxVisible` rows and scrolls the rest — native selects
 * don't let CSS constrain the popup height consistently across browsers.
 */
export function ScrollSelect({
  value,
  onChange,
  options,
  placeholder,
  title,
  className = "",
  maxVisible = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ScrollSelectOption[];
  placeholder: string;
  title?: string;
  className?: string;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between gap-2 text-left"
        title={title}
      >
        <span className={`truncate ${value ? "" : "text-ink-400"}`}>{selectedLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-full min-w-max overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-800"
          style={{ maxHeight: `${maxVisible * 2.25}rem` }}
        >
          <button
            type="button"
            role="option"
            aria-selected={value === ""}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-primary-50 dark:hover:bg-ink-700 ${
              value === ""
                ? "font-semibold text-primary-600 dark:text-primary-400"
                : "text-ink-700 dark:text-ink-200"
            }`}
          >
            {placeholder}
          </button>

          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={value === o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-primary-50 dark:hover:bg-ink-700 ${
                value === o.value
                  ? "font-semibold text-primary-600 dark:text-primary-400"
                  : "text-ink-700 dark:text-ink-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
