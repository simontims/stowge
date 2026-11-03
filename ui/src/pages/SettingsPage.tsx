import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { SettingsShortcutsPage } from "./SettingsShortcutsPage";
import { SettingsHintsPage } from "./SettingsHintsPage";

export type SettingsTab = "shortcuts" | "hints";

const DEFAULT_TAB: SettingsTab = "shortcuts";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "shortcuts", label: "Filters" },
  { id: "hints", label: "AI hints" },
];

/** Reads `?tab=`; anything unknown (or missing) is the Filters tab. */
export function parseSettingsTab(raw: string | null): SettingsTab {
  return TABS.find((tab) => tab.id === raw)?.id ?? DEFAULT_TAB;
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseSettingsTab(searchParams.get("tab"));

  function selectTab(tab: SettingsTab) {
    const next = new URLSearchParams(searchParams);
    if (tab === DEFAULT_TAB) next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Create reusable item filter shortcuts, pin the important ones to the menu, and manage AI hints."
      />

      <div className="flex border-b border-neutral-800" role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
              className={[
                "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-neutral-100 text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-200 hover:border-neutral-600",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "shortcuts" && <SettingsShortcutsPage embedded />}
      {activeTab === "hints" && <SettingsHintsPage />}
    </div>
  );
}
