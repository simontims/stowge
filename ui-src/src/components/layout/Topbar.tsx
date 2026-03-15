import { Menu, Search, User } from "lucide-react";

interface TopbarProps {
  onMenuClick: () => void;
  onCommandOpen: () => void;
}

export function Topbar({ onMenuClick, onCommandOpen }: TopbarProps) {
  return (
    <header className="h-14 border-b border-neutral-800 bg-neutral-900 flex items-center gap-3 px-4 shrink-0">
      {/* Mobile menu button — visible only on small screens */}
      <button
        onClick={onMenuClick}
        className="md:hidden p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu size={18} />
      </button>

      {/* Global search — styled button that opens the command palette */}
      <button
        onClick={onCommandOpen}
        className="flex items-center gap-2 flex-1 max-w-xl bg-neutral-800 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:border-neutral-600 hover:text-neutral-400 transition-colors text-left"
        aria-label="Search (Ctrl+K)"
      >
        <Search size={14} className="shrink-0" />
        <span className="flex-1 truncate">
          Search parts, locations, suppliers…
        </span>
        <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5 shrink-0 font-mono">
          Ctrl K
        </kbd>
      </button>

      <div className="flex-1 hidden md:block" />

      {/* User avatar placeholder */}
      <button
        className="flex items-center justify-center w-8 h-8 rounded-full bg-neutral-700 text-neutral-300 hover:bg-neutral-600 hover:text-neutral-100 transition-colors shrink-0"
        aria-label="User menu"
      >
        <User size={14} />
      </button>
    </header>
  );
}
