import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "./components/layout/AppShell";
import { ItemsPage } from "./pages/ItemsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AddPage } from "./pages/AddPage";
import { EditPage } from "./pages/EditPage";
import { SystemPage } from "./pages/SystemPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WhatsNewPage } from "./pages/WhatsNewPage";
import { LoginPage } from "./pages/LoginPage";
import { UNAUTHORIZED_EVENT, OFFLINE_EVENT, apiRequest } from "./lib/api";
import { useTheme } from "./lib/theme";
import { type CurrentUser } from "./lib/types";
import { UserContext } from "./lib/UserContext";
import { ConnectionLostOverlay } from "./components/layout/ConnectionLostOverlay";
import { WelcomeModal } from "./components/onboarding/welcome/WelcomeModal";
import { WelcomeTour } from "./components/onboarding/welcome/WelcomeTour";
import { WhatsNewHost } from "./components/onboarding/whatsNew/WhatsNewHost";
import { START_WELCOME_TOUR_EVENT } from "./lib/onboarding";
import { upgradeLegacyCollectionLink } from "./lib/legacyLinks";

/** The welcome flow is tracked on the user (not per browser), so it doesn't repeat on a new
 *  browser or address. */
function needsWelcome(user: CurrentUser): boolean {
  return Boolean(user.whats_new?.welcome_pending);
}

/** Old `?collection=` links on the item list and the Add page become `?tag=` links. */
export function LegacyLinkUpgrade({ children }: { children: ReactNode }) {
  const location = useLocation();
  const upgraded = ["/items", "/parts", "/add", "/items/new", "/parts/new"].includes(location.pathname)
    ? upgradeLegacyCollectionLink(location.search)
    : null;
  if (upgraded !== null) return <Navigate to={{ pathname: location.pathname, search: upgraded, hash: location.hash }} state={location.state} replace />;
  return <>{children}</>;
}

export function resolvePostLoginRoute(user: CurrentUser): string {
  const lastTag = user.last_open_tag?.trim();
  if (lastTag) {
    return `/items?tag=${encodeURIComponent(lastTag)}`;
  }
  return "/items";
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [tourRunning, setTourRunning] = useState(false);
  const toastTheme = useTheme();
  const [isMobileToastViewport, setIsMobileToastViewport] = useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth < 768 : false)
  );

  function startWelcomeIfNeeded(user: CurrentUser) {
    if (!needsWelcome(user)) {
      setShowWelcome(false);
      return;
    }
    setShowWelcome(true);
  }

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
          startWelcomeIfNeeded(me);
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
    startWelcomeIfNeeded(user);
    setCurrentUser(user);
    setAuthChecked(true);
  }

  /** Record the welcome flow as seen. Hidden locally first, so a failed request can't trap anyone behind it. */
  function markWelcomeSeen() {
    void apiRequest<CurrentUser>("/api/me/welcome/seen", { method: "POST" })
      .then((updated) => setCurrentUser((current) => (current && current.id === updated.id ? updated : current)))
      .catch(() => {
        // Best effort: the welcome shows again next session if this failed.
      });
  }

  function handleWelcomeClose() {
    setShowWelcome(false);
    markWelcomeSeen();
  }

  function handleWelcomeTakeTour() {
    setShowWelcome(false);
    markWelcomeSeen();
    setTourRunning(true);
  }

  // "Welcome tour" in the user menu starts the tour directly.
  useEffect(() => {
    function handleStartTour() {
      if (!currentUser) return;
      setShowWelcome(false);
      setTourRunning(false);
      // Restart from step 1 even if the tour was already run.
      window.setTimeout(() => setTourRunning(true), 0);
    }

    window.addEventListener(START_WELCOME_TOUR_EVENT, handleStartTour);
    return () => window.removeEventListener(START_WELCOME_TOUR_EVENT, handleStartTour);
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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Loader2 size={24} className="text-subtle animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser }}>
      <BrowserRouter>
        <AppShell onLogout={handleLogout}>
        <LegacyLinkUpgrade>
        <Routes>
          <Route path="/"           element={<Navigate to={resolvePostLoginRoute(currentUser)} replace />} />
          <Route path="/items"      element={<ItemsPage />} />
          <Route path="/parts"      element={<ItemsPage />} />
          <Route path="/items/new"  element={<AddPage />} />
          <Route path="/items/:itemId/edit" element={<EditPage />} />
          <Route path="/parts/new"  element={<AddPage />} />
          <Route path="/parts/:itemId/edit" element={<EditPage />} />
          <Route path="/tags" element={<Navigate to="/settings?tab=tags" replace />} />
          <Route path="/collections" element={<Navigate to="/settings?tab=tags" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/release-notes" element={<WhatsNewPage />} />
          <Route path="/whats-new" element={<Navigate to="/release-notes" replace />} />
          <Route path="/add"        element={<AddPage />} />
          <Route path="/scan"       element={<Navigate to="/add" replace />} />
          <Route path="/system"     element={currentUser.role === "admin" ? <SystemPage /> : <Navigate to="/items" replace />} />
          <Route path="/locations"  element={currentUser.role === "admin" ? <Navigate to="/system?tab=locations" replace /> : <Navigate to="/items" replace />} />
          <Route path="*"           element={<PlaceholderPage title="Not found"  description="This page does not exist" />} />
        </Routes>
        </LegacyLinkUpgrade>
      </AppShell>
      <Toaster
        position={isMobileToastViewport ? "top-center" : "bottom-right"}
        theme={toastTheme}
        richColors
      />
      {showWelcome && <WelcomeModal onTakeTour={handleWelcomeTakeTour} onClose={handleWelcomeClose} />}
      <WelcomeTour
        run={tourRunning}
        isAdmin={currentUser.role === "admin"}
        onFinish={() => setTourRunning(false)}
      />
      <WhatsNewHost
        user={currentUser}
        onUserChange={setCurrentUser}
        suppress={showWelcome || tourRunning}
      />
      </BrowserRouter>
    </UserContext.Provider>
  );
}

