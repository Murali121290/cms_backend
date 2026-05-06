import { useRef, type ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/utils/cn";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  shortcutHint?: string;
  onClear?: () => void;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  shortcutHint,
  onClear,
  className,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const hasValue = value.length > 0;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  function handleClear() {
    onChange("");
    onClear?.();
    inputRef.current?.focus();
  }

  return (
    <div
      className={cn(
        "relative flex items-center group",
        className
      )}
    >
      {/* Search icon */}
      <Search
        className="absolute left-3 size-4 text-navy-400 pointer-events-none"
        aria-hidden="true"
      />

      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "w-full h-9 pl-9 pr-3 text-sm",
          "bg-white border border-surface-400 rounded-md",
          "text-navy-900 placeholder:text-navy-400",
          "transition-all duration-150",
          "hover:border-navy-300",
          "focus:outline-none focus:border-navy-900 focus:ring-1 focus:ring-navy-900/10",
          // make room for right-side elements
          (hasValue || shortcutHint) && "pr-9"
        )}
      />

      {/* Right side: clear button OR shortcut hint */}
      {hasValue ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2.5 flex items-center justify-center size-5 rounded-sm text-navy-400 hover:text-navy-900 hover:bg-surface-200 transition-colors duration-100"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : shortcutHint ? (
        <span className="absolute right-2.5 inline-flex items-center px-1 py-0.5 text-[10px] font-medium text-navy-400 bg-surface-200 border border-surface-400 rounded-xs pointer-events-none select-none leading-none">
          {shortcutHint}
        </span>
      ) : null}
    </div>
  );
}
