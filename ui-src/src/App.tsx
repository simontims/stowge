import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ItemsPage } from "./pages/ItemsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AddPage } from "./pages/AddPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsCollectionsPage } from "./pages/SettingsCollectionsPage";
import { LoginPage } from "./pages/LoginPage";
import { getToken, saveToken, removeToken, UNAUTHORIZED_EVENT, OFFLINE_EVENT, apiRequest } from "./lib/api";
import { ConnectionLostOverlay } from "./components/layout/ConnectionLostOverlay";

function StartupRedirect() {
  const navigate = useNavigate();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;

    // Only redirect to the last open collection on a genuine fresh navigation
    // (not a browser refresh or back/forward).  This covers all paths: even if
    // the user refreshes on / (Dashboard) they stay there.
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navEntry && navEntry.type !== "navigate") return;

    // Also skip if the user already has a specific destination in the URL.
    if (window.location.pathname !== "/") return;

    void apiRequest<{ last_open_collection?: string | null }>("/api/me")
      .then((me) => {
        if (me.last_open_collection) {
          navigate(
            {
              pathname: "/items",
              search: new URLSearchParams({ collection: me.last_open_collection }).toString(),
            },
            { replace: true }
          );
        }
      })
      .catch(() => {});
  }, [navigate]);

  return null;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [isOffline, setIsOffline] = useState(false);

  // 401 from any apiRequest() call fires this event → show LoginPage
  useEffect(() => {
    const handler = () => setToken(null);
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

  function handleLogin(newToken: string) {
    saveToken(newToken);
    setToken(newToken);
  }

  function handleLogout() {
    removeToken(); // removes from localStorage + fires UNAUTHORIZED_EVENT → setToken(null)
  }

  if (isOffline) {
    return <ConnectionLostOverlay />;
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <BrowserRouter>
      <StartupRedirect />
      <AppShell onLogout={handleLogout}>
        <Routes>
          <Route path="/"           element={<DashboardPage />} />
          <Route path="/items"      element={<ItemsPage />} />
          <Route path="/parts"      element={<ItemsPage />} />
          <Route path="/items/new"  element={<AddPage />} />
          <Route path="/parts/new"  element={<AddPage />} />
          <Route path="/collections" element={<SettingsCollectionsPage />} />
          <Route path="/add"        element={<AddPage />} />
          <Route path="/scan"       element={<Navigate to="/add" replace />} />
          <Route path="/settings"   element={<SettingsPage />} />
          <Route path="/settings/ai"        element={<Navigate to="/settings" replace />} />
          <Route path="/settings/users"     element={<Navigate to="/settings" replace />} />
          <Route path="/settings/locations" element={<Navigate to="/settings" replace />} />
          <Route path="/locations"          element={<Navigate to="/settings" replace />} />
          <Route path="*"           element={<PlaceholderPage title="Not found"  description="This page does not exist" />} />
        </Routes>
      </AppShell>

    </BrowserRouter>
  );
}

