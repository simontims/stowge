import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { CommandPalette } from "./components/command/CommandPalette";
import { PartsPage } from "./pages/PartsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ScanAddPage } from "./pages/ScanAddPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsUsersPage } from "./pages/SettingsUsersPage";
import { SettingsAiPage } from "./pages/SettingsAiPage";
import { LocationsPage } from "./pages/LocationsPage";
import { LoginPage } from "./pages/LoginPage";
import { getToken, saveToken, removeToken, UNAUTHORIZED_EVENT } from "./lib/api";

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
      <AppShell onCommandOpen={() => setCommandOpen(true)} onLogout={handleLogout}>
        <Routes>
          <Route path="/"           element={<PlaceholderPage title="Dashboard"  description="Overview of your inventory at a glance." />} />
          <Route path="/items"      element={<PartsPage />} />
          <Route path="/parts"      element={<PartsPage />} />
          <Route path="/items/new"  element={<ScanAddPage />} />
          <Route path="/parts/new"  element={<ScanAddPage />} />
          <Route path="/locations"  element={<LocationsPage />} />
          <Route path="/categories" element={<PlaceholderPage title="Categories" description="Organise parts into categories." />} />
          <Route path="/suppliers"  element={<PlaceholderPage title="Suppliers"  description="Track your parts suppliers." />} />
          <Route path="/projects"   element={<PlaceholderPage title="Projects"   description="Link parts and stock to projects." />} />
          <Route path="/add"       element={<ScanAddPage />} />
          <Route path="/scan"      element={<ScanAddPage />} />
          <Route path="/imports"    element={<PlaceholderPage title="Imports"    description="Bulk-import parts from a CSV file." />} />
          <Route path="/reports"    element={<PlaceholderPage title="Reports"    description="Inventory reports and export tools." />} />
          <Route path="/settings"   element={<SettingsPage />} />
          <Route path="/settings/ai" element={<SettingsAiPage />} />
          <Route path="/settings/users" element={<SettingsUsersPage />} />
          <Route path="*"           element={<PlaceholderPage title="Not found"  description="This page does not exist." />} />
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
