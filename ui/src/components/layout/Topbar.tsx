import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, Moon, Sun, User } from "lucide-react";
import { getStoredTheme, setTheme, type ThemeMode } from "../../lib/theme";
import { apiRequest } from "../../lib/api";
import { useCurrentUser } from "../../lib/UserContext";

interface TopbarProps {
  onMenuClick: () => void;
  onLogout: () => void;
}

export function Topbar({ onMenuClick, onLogout }: TopbarProps) {
  const currentUser = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [version, setVersion] = useState<string>("");
  const menuRef = useRef<HTMLDivElement>(null);

  const displayName = useMemo(() => {
    const first = currentUser.firstname.trim();
    const last = currentUser.lastname.trim();
    const fullName = [first, last].filter(Boolean).join(" ");
    if (fullName) return fullName;
    return currentUser.email.trim() || "Guest";
  }, [currentUser]);

  // Sync theme once from the user object already in context — no extra fetch needed.
  useEffect(() => {
    const serverTheme = currentUser.theme === "light" || currentUser.theme === "dark"
      ? currentUser.theme
      : null;
    if (serverTheme) {
      setThemeMode(serverTheme);
      setTheme(serverTheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function logout() {
    setMenuOpen(false);
    onLogout();
  }

  function handleThemeChange(nextTheme: ThemeMode) {
    setThemeMode(nextTheme);
    setTheme(nextTheme);
    void apiRequest("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ theme: nextTheme }),
    }).catch(() => {
      // Best-effort.
    });
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

        <div className="flex-1" />

        <button
          onClick={() => handleThemeChange(themeMode === "dark" ? "light" : "dark")}
          className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex items-center gap-2 h-8 px-2.5 rounded-full bg-neutral-700 text-neutral-300 hover:bg-neutral-600 hover:text-neutral-100 transition-colors"
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            <User size={14} />
            <span className="hidden sm:inline max-w-[10rem] truncate text-xs font-medium">
              {displayName}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-44 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg z-20 overflow-hidden">
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

    </>
  );
}
