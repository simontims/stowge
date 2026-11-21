import { Search } from "lucide-react";
import clsx from "clsx";

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({
  placeholder = "Search…",
  value,
  onChange,
  className,
  autoFocus,
}: SearchInputProps) {
  return (
    <div className={clsx("relative flex items-center", className)}>
      <Search
        size={14}
        className="absolute left-3 text-subtle pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-surface-2 border border-border-strong rounded-md pl-8 pr-3 py-1.5 text-sm text-body placeholder:text-subtle outline-none focus:border-border-focus focus:ring-1 focus:ring-border-hover transition-colors"
        aria-label={placeholder}
      />
    </div>
  );
}
