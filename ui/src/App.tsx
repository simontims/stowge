import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "./components/layout/AppShell";
import { ItemsPage } from "./pages/ItemsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AddPage } from "./pages/AddPage";
import { EditPage } from "./pages/EditPage";
import { SystemPage } from "./pages/SystemPage";
import { SettingsCollectionsPage } from "./pages/SettingsCollectionsPage";
import { LoginPage } from "./pages/LoginPage";
import { UNAUTHORIZED_EVENT, OFFLINE_EVENT } from "./lib/api";
import { type CurrentUser } from "./lib/types";
import { UserContext } from "./lib/UserContext";
import { ConnectionLostOverlay } from "./components/layout/ConnectionLostOverlay";
import { HierarchyIntroTour } from "./components/onboarding/HierarchyIntroTour";
import { RERUN_HIERARCHY_INTRO_EVENT } from "./lib/onboarding";

const HIERARCHY_INTRO_STORAGE_KEY_PREFIX = "stowge:hierarchy-intro-seen:v2:";

function hierarchyIntroSeenKey(userId: string): string {
  return `${HIERARCHY_INTRO_STORAGE_KEY_PREFIX}${userId}`;
}

function hasSeenHierarchyIntro(userId: string): boolean {
  try {
    return localStorage.getItem(hierarchyIntroSeenKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markHierarchyIntroSeen(userId: string): void {
  try {
    localStorage.setItem(hierarchyIntroSeenKey(userId), "1");
  } catch {
    // Best-effort persistence only.
  }
}

function resolvePostLoginRoute(user: CurrentUser): string {
  const lastCollection = user.last_open_collection?.trim();
  if (lastCollection) {
    return `/items?collection=${encodeURIComponent(lastCollection)}`;
  }
  return "/collections";
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showHierarchyIntro, setShowHierarchyIntro] = useState(false);
  const [introUserId, setIntroUserId] = useState<string | null>(null);
  const [toastTheme, setToastTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark")
  );
  const [isMobileToastViewport, setIsMobileToastViewport] = useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth < 768 : false)
  );

  function startHierarchyIntroIfNeeded(user: CurrentUser) {
    if (hasSeenHierarchyIntro(user.id)) {
      setShowHierarchyIntro(false);
      setIntroUserId(null);
      return;
    }
    setShowHierarchyIntro(true);
    setIntroUserId(user.id);
  }

  useEffect(() => {
    const root = document.documentElement;
    const syncToastTheme = () => {
      setToastTheme(root.dataset.theme === "light" ? "light" : "dark");
    };

    syncToastTheme();

    const observer = new MutationObserver(syncToastTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsMobileToastViewport(window.innerWidth < 768);
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Probe the session on mount to determine initial auth state.
  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then(async (res) => {
        if (res.ok) {
          const me = (await res.json()) as CurrentUser;
          setCurrentUser(me);
          startHierarchyIntroIfNeeded(me);
        }
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthChecked(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mid-session 401 on any apiRequest() fires this event → show LoginPage
  useEffect(() => {
    const handler = () => setCurrentUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let probeInFlight = false;

    const checkServerHealth = async () => {
      if (cancelled || probeInFlight) {
        return;
      }

      probeInFlight = true;
      try {
        const res = await fetch("/healthz", {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        });

        if (cancelled) {
          return;
        }

        if (res.ok) {
          setIsOffline((current) => {
            if (current) {
              window.location.reload();
              return current;
            }
            return false;
          });
          return;
        }

        setIsOffline(true);
      } catch {
        if (!cancelled) {
          setIsOffline(true);
        }
      } finally {
        probeInFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void checkServerHealth();
    }, 5000);

    const handleOffline = () => {
      setIsOffline(true);
      void checkServerHealth();
    };

    window.addEventListener(OFFLINE_EVENT, handleOffline);
    void checkServerHealth();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener(OFFLINE_EVENT, handleOffline);
    };
  }, []);

  function handleLogin(user: CurrentUser) {
    const destination = resolvePostLoginRoute(user);
    window.history.replaceState(null, "", destination);
    startHierarchyIntroIfNeeded(user);
    setCurrentUser(user);
    setAuthChecked(true);
  }

  function handleHierarchyIntroComplete() {
    if (introUserId) {
      markHierarchyIntroSeen(introUserId);
    }
    setShowHierarchyIntro(false);
    setIntroUserId(null);
  }

  useEffect(() => {
    function handleRerunHierarchyIntro() {
      if (!currentUser) return;
      setShowHierarchyIntro(false);
      setIntroUserId(currentUser.id);
      // Restart from step 1 even if a previous run was already completed.
      window.setTimeout(() => {
        setShowHierarchyIntro(true);
      }, 0);
    }

    window.addEventListener(RERUN_HIERARCHY_INTRO_EVENT, handleRerunHierarchyIntro);
    return () => window.removeEventListener(RERUN_HIERARCHY_INTRO_EVENT, handleRerunHierarchyIntro);
  }, [currentUser]);

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {
      // Best-effort: clear local state regardless.
    }
    setCurrentUser(null);
  }

  if (isOffline) {
    return <ConnectionLostOverlay />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 size={24} className="text-neutral-500 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <UserContext.Provider value={{ currentUser }}>
      <BrowserRouter>
        <AppShell onLogout={handleLogout}>
        <Routes>
          <Route path="/"           element={<Navigate to={resolvePostLoginRoute(currentUser)} replace />} />
          <Route path="/items"      element={<ItemsPage />} />
          <Route path="/parts"      element={<ItemsPage />} />
          <Route path="/items/new"  element={<AddPage />} />
          <Route path="/items/:itemId/edit" element={<EditPage />} />
          <Route path="/parts/new"  element={<AddPage />} />
          <Route path="/parts/:itemId/edit" element={<EditPage />} />
          <Route path="/collections" element={<SettingsCollectionsPage />} />
          <Route path="/add"        element={<AddPage />} />
          <Route path="/scan"       element={<Navigate to="/add" replace />} />
          <Route path="/system"     element={currentUser.role === "admin" ? <SystemPage /> : <Navigate to="/items" replace />} />
          <Route path="/locations"  element={currentUser.role === "admin" ? <Navigate to="/system?tab=locations" replace /> : <Navigate to="/items" replace />} />
          <Route path="*"           element={<PlaceholderPage title="Not found"  description="This page does not exist" />} />
        </Routes>
      </AppShell>
      <Toaster
        position={isMobileToastViewport ? "top-center" : "bottom-right"}
        theme={toastTheme}
        richColors
      />
      <HierarchyIntroTour
        open={showHierarchyIntro}
        isAdmin={currentUser.role === "admin"}
        onComplete={handleHierarchyIntroComplete}
      />
      </BrowserRouter>
    </UserContext.Provider>
  );
}

