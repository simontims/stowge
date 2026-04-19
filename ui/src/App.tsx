import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ItemsPage } from "./pages/ItemsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AddPage } from "./pages/AddPage";
import { SystemPage } from "./pages/SystemPage";
import { SettingsCollectionsPage } from "./pages/SettingsCollectionsPage";
import { LoginPage } from "./pages/LoginPage";
import { type CurrentUser, UNAUTHORIZED_EVENT, OFFLINE_EVENT } from "./lib/api";
import { UserContext } from "./lib/UserContext";
import { ConnectionLostOverlay } from "./components/layout/ConnectionLostOverlay";

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

  // Probe the session on mount to determine initial auth state.
  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then(async (res) => {
        if (res.ok) {
          const me = (await res.json()) as CurrentUser;
          setCurrentUser(me);
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
    setCurrentUser(user);
    setAuthChecked(true);
  }

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
          <Route path="/parts/new"  element={<AddPage />} />
          <Route path="/collections" element={<SettingsCollectionsPage />} />
          <Route path="/add"        element={<AddPage />} />
          <Route path="/scan"       element={<Navigate to="/add" replace />} />
          <Route path="/system"     element={<SystemPage />} />
          <Route path="/locations"  element={<Navigate to="/system?tab=locations" replace />} />
          <Route path="*"           element={<PlaceholderPage title="Not found"  description="This page does not exist" />} />
        </Routes>
      </AppShell>
      </BrowserRouter>
    </UserContext.Provider>
  );
}

