import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, Search, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface TopbarProps {
  onMenuClick: () => void;
  onCommandOpen: () => void;
}

export function Topbar({ onMenuClick, onCommandOpen }: TopbarProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [version, setVersion] = useState<string>("");
  const menuRef = useRef<HTMLDivElement>(null);

  const username = useMemo(() => {
    const token = localStorage.getItem("stowge_token");
    if (!token) return "Guest";

    try {
      const payloadPart = token.split(".")[1];
      if (!payloadPart) return "Guest";
      const b64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const decoded = atob(padded);
      const payload = JSON.parse(decoded) as { username?: unknown };
      return typeof payload.username === "string" && payload.username.trim()
        ? payload.username
        : "Guest";
    } catch {
      return "Guest";
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    let active = true;

    async function loadVersion() {
      try {
        const res = await fetch("/api/version");
        if (!res.ok) return;
        const data = (await res.json()) as { version?: unknown };
        if (active && typeof data.version === "string") {
          setVersion(data.version);
        }
      } catch {
        // Best-effort display only.
      }
    }

    void loadVersion();
    return () => {
      active = false;
    };
  }, []);

  function goPreferences() {
    setMenuOpen(false);
    setPreferencesOpen(true);
  }

  function logout() {
    localStorage.removeItem("stowge_token");
    setMenuOpen(false);
    navigate("/", { replace: true });
  }

  return (
    <>
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

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex items-center gap-2 h-8 px-2.5 rounded-full bg-neutral-700 text-neutral-300 hover:bg-neutral-600 hover:text-neutral-100 transition-colors"
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            <User size={14} />
            <span className="hidden sm:inline max-w-[10rem] truncate text-xs font-medium">
              {username}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-44 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg z-20 overflow-hidden">
              <button
                onClick={goPreferences}
                className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                Preferences
              </button>
              <button
                onClick={logout}
                className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-neutral-800 transition-colors"
              >
                Logout
              </button>
              <div className="border-t border-neutral-800 px-3 py-2 text-xs text-neutral-500">
                Version {version || "-"}
              </div>
            </div>
          )}
        </div>
      </header>

      {preferencesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            onClick={() => setPreferencesOpen(false)}
            className="absolute inset-0 bg-black/60"
            aria-label="Close preferences"
          />
          <div className="relative w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
            <div className="px-4 py-3 border-b border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-100">User Preferences</h3>
              <p className="text-xs text-neutral-500 mt-1">Personal settings for your account.</p>
            </div>
            <div className="px-4 py-4 space-y-3">
              <div className="text-sm text-neutral-300">
                Signed in as <span className="font-medium text-neutral-100">{username}</span>
              </div>
              <p className="text-sm text-neutral-500">
                User-level preferences will appear here.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setPreferencesOpen(false)}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-sm text-neutral-200 hover:border-neutral-600 hover:text-neutral-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
