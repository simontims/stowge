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
        className="absolute left-3 text-neutral-500 pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-neutral-800 border border-neutral-700 rounded-md pl-8 pr-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-600 transition-colors"
        aria-label={placeholder}
      />
    </div>
  );
}
