import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Menu, Moon, Sparkles, Sun, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { chooseTheme, setTheme, useTheme, type ThemeMode } from "../../lib/theme";
import { ThemeSelector } from "../ui/ThemeSelector";
import { useCurrentUser } from "../../lib/UserContext";
import { UnreadDot } from "../ui/UnreadDot";
import { START_WELCOME_TOUR_EVENT } from "../../lib/onboarding";

interface TopbarProps {
  onMenuClick: () => void;
  onLogout: () => void;
}

export function Topbar({ onMenuClick, onLogout }: TopbarProps) {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const hasUnseenNotes = (currentUser.whats_new?.unseen.length ?? 0) > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const themeMode = useTheme();
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
    if (serverTheme) setTheme(serverTheme);
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
    chooseTheme(nextTheme);
  }

  return (
    <>
      <header className="h-14 border-b border-border bg-surface flex items-center gap-3 px-4 shrink-0">
        {/* Mobile menu button — visible only on small screens */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-md text-muted hover:text-heading hover:bg-surface-2 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => handleThemeChange(themeMode === "dark" ? "light" : "dark")}
          className="shrink-0 p-1.5 rounded-md text-muted hover:text-heading hover:bg-surface-2 transition-colors"
          aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex items-center gap-2 h-8 px-2.5 rounded-full bg-surface-3 text-secondary hover:bg-surface-4 hover:text-heading transition-colors"
            aria-label="User menu"
            data-tour="user-menu"
            aria-expanded={menuOpen}
          >
            <span className="relative inline-flex">
              <User size={14} />
              {hasUnseenNotes && <UnreadDot className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5" />}
            </span>
            <span className="hidden sm:inline max-w-[10rem] truncate text-xs font-medium">
              {displayName}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-border-strong bg-surface shadow-lg z-20 overflow-hidden">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  window.dispatchEvent(new Event(START_WELCOME_TOUR_EVENT));
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-body hover:bg-surface-2 transition-colors"
              >
                <Compass size={14} className="shrink-0 text-muted" />
                Welcome tour
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/release-notes");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-body hover:bg-surface-2 transition-colors"
              >
                <Sparkles size={14} className="shrink-0 text-muted" />
                Release notes
                {hasUnseenNotes && (
                  <>
                    <UnreadDot className="ml-auto" />
                    <span className="sr-only">(new)</span>
                  </>
                )}
              </button>
              <div className="border-t border-border px-3 py-3">
                <ThemeSelector idPrefix="menu" />
              </div>
              <button
                onClick={logout}
                className="w-full border-t border-border text-left px-3 py-2 text-sm text-danger-300 hover:bg-surface-2 transition-colors"
              >
                Logout
              </button>
              <div className="border-t border-border px-3 py-2 text-xs text-subtle">
                Version {version || "-"}
              </div>
            </div>
          )}
        </div>
      </header>

    </>
  );
}
