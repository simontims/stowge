import { useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { SettingsShortcutsPage } from "./SettingsShortcutsPage";
import { SettingsHintsPage } from "./SettingsHintsPage";
import { TagsPage } from "./TagsPage";

export type SettingsTab = "shortcuts" | "tags" | "hints";

const DEFAULT_TAB: SettingsTab = "shortcuts";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "shortcuts", label: "Filters" },
  { id: "tags", label: "Tags" },
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
    setSearchParams(next, { replace: true });
  }

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Arrow keys, Home and End move focus to another tab and select it. */
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target = -1;
    if (event.key === "ArrowRight") target = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = TABS.length - 1;
    if (target < 0) return;
    event.preventDefault();
    const tab = TABS[target];
    selectTab(tab.id);
    tabRefs.current[tab.id]?.focus();
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />

      <div className="flex border-b border-border" role="tablist" aria-label="Settings sections">
        {TABS.map((tab, index) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-controls="settings-panel"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              onClick={() => selectTab(tab.id)}
              className={[
                "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-border-inverse text-heading"
                  : "border-transparent text-subtle hover:text-body hover:border-border-hover",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="settings-panel" tabIndex={0} aria-labelledby={`settings-tab-${activeTab}`}>
        {activeTab === "shortcuts" && <SettingsShortcutsPage embedded />}
        {activeTab === "tags" && <TagsPage embedded />}
        {activeTab === "hints" && <SettingsHintsPage />}
      </div>
    </div>
  );
}
