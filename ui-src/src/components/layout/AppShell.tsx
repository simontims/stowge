import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { Topbar } from "./Topbar";

interface AppShellProps {
  children: React.ReactNode;
  onCommandOpen: () => void;
  onLogout: () => void;
}

export function AppShell({ children, onCommandOpen, onLogout }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      {/* Mobile slide-out drawer */}
      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Right side: topbar + scrollable content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          onMenuClick={() => setDrawerOpen(true)}
          onCommandOpen={onCommandOpen}
          onLogout={onLogout}
        />
        <main className="flex-1 overflow-y-auto p-6 focus:outline-none" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
