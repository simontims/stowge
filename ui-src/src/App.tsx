import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { CommandPalette } from "./components/command/CommandPalette";
import { ItemsPage } from "./pages/ItemsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { AddPage } from "./pages/AddPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsUsersPage } from "./pages/SettingsUsersPage";
import { SettingsAiPage } from "./pages/SettingsAiPage";
import { LocationsPage } from "./pages/LocationsPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { LoginPage } from "./pages/LoginPage";
import { getToken, saveToken, removeToken, UNAUTHORIZED_EVENT, apiRequest } from "./lib/api";

function StartupRedirect() {
  const navigate = useNavigate();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => getToken());

  // 401 from any apiRequest() call fires this event → show LoginPage
  useEffect(() => {
    const handler = () => setToken(null);
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  // Global Ctrl+K opens the command palette from anywhere
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function handleLogin(newToken: string) {
    saveToken(newToken);
    setToken(newToken);
  }

  function handleLogout() {
    removeToken(); // removes from localStorage + fires UNAUTHORIZED_EVENT → setToken(null)
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <BrowserRouter>
      <StartupRedirect />
      <AppShell onCommandOpen={() => setCommandOpen(true)} onLogout={handleLogout}>
        <Routes>
          <Route path="/"           element={<DashboardPage />} />
          <Route path="/items"      element={<ItemsPage />} />
          <Route path="/parts"      element={<ItemsPage />} />
          <Route path="/items/new"  element={<AddPage />} />
          <Route path="/parts/new"  element={<AddPage />} />
          <Route path="/locations"  element={<LocationsPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/suppliers"  element={<PlaceholderPage title="Suppliers"  description="Track your parts suppliers" />} />
          <Route path="/projects"   element={<PlaceholderPage title="Projects"   description="Link parts and stock to projects" />} />
          <Route path="/add"       element={<AddPage />} />
          <Route path="/scan"      element={<Navigate to="/add" replace />} />
          <Route path="/settings"   element={<SettingsPage />} />
          <Route path="/settings/ai" element={<SettingsAiPage />} />
          <Route path="/settings/users" element={<SettingsUsersPage />} />
          <Route path="*"           element={<PlaceholderPage title="Not found"  description="This page does not exist" />} />
        </Routes>
      </AppShell>

      {/* Command palette lives outside AppShell so it overlays everything */}
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
      />
    </BrowserRouter>
  );
}

