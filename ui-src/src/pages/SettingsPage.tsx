import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog";
import { SettingsCollectionsPage } from "./SettingsCollectionsPage";
import { SettingsAiPage } from "./SettingsAiPage";
import { SettingsLocationsPage } from "./SettingsLocationsPage";
import { SettingsUsersPage } from "./SettingsUsersPage";

type Tab = "collections" | "ai" | "locations" | "users";

const TABS: Array<{ id: Tab; label: string; description: string }> = [
  { id: "collections", label: "Collections", description: "Manage inventory collections and AI hints" },
  { id: "ai",          label: "AI",          description: "Configure LLM providers and models" },
  { id: "locations",   label: "Locations",   description: "Manage storage locations" },
  { id: "users",       label: "Users",       description: "Manage user accounts and access" },
];

type SaveRef = { current: (() => Promise<void>) | null };

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("collections");
  const [dirtySection, setDirtySection] = useState<Tab | null>(null);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const [savingFromDialog, setSavingFromDialog] = useState(false); // used by dialog

  const collectionsSaveFnRef = useRef<(() => Promise<void>) | null>(null);
  const aiSaveFnRef          = useRef<(() => Promise<void>) | null>(null);
  const locationsSaveFnRef   = useRef<(() => Promise<void>) | null>(null);
  const usersSaveFnRef       = useRef<(() => Promise<void>) | null>(null);

  const saveFnRefMap: Record<Tab, SaveRef> = {
    collections: collectionsSaveFnRef,
    ai:          aiSaveFnRef,
    locations:   locationsSaveFnRef,
    users:       usersSaveFnRef,
  };

  const isDirty   = dirtySection !== null;
  const dialogOpen = pendingTab !== null;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function handleDirtyChange(tab: Tab, dirty: boolean) {
    setDirtySection((current) => (dirty ? tab : current === tab ? null : current));
  }

  function handleTabClick(tab: Tab) {
    if (tab === activeTab) return;
    if (isDirty) { setPendingTab(tab); return; }
    setActiveTab(tab);
  }

  async function handleDialogSave() {
    const fn = dirtySection ? saveFnRefMap[dirtySection].current : null;
    if (!fn) { handleDialogDiscard(); return; }
    setSavingFromDialog(true);
    try {
      await fn();
      setDirtySection(null);
      proceedAction();
    } catch {
      /* save failed — stay and let user retry */
    } finally {
      setSavingFromDialog(false);
    }
  }

  function handleDialogDiscard() {
    setDirtySection(null);
    proceedAction();
  }

  function handleDialogCancel() {
    setPendingTab(null);
  }

  function proceedAction() {
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  }

  const dirtyTabLabel  = dirtySection
    ? (TABS.find((t) => t.id === dirtySection)?.label ?? dirtySection)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />

      {/* Tab bar */}
      <div className="flex border-b border-neutral-800">
        {TABS.map((tab) => {
          const isActive   = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
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

      {/* Section content — remounts per tab switch (clean state, API re-fetches) */}
      {activeTab === "collections" && (
        <SettingsCollectionsPage
          embedded
          onDirtyChange={(d) => handleDirtyChange("collections", d)}
          saveFnRef={collectionsSaveFnRef}
        />
      )}
      {activeTab === "ai" && (
        <SettingsAiPage
          embedded
          onDirtyChange={(d) => handleDirtyChange("ai", d)}
          saveFnRef={aiSaveFnRef}
        />
      )}
      {activeTab === "locations" && (
        <SettingsLocationsPage
          embedded
          onDirtyChange={(d) => handleDirtyChange("locations", d)}
          saveFnRef={locationsSaveFnRef}
        />
      )}
      {activeTab === "users" && (
        <SettingsUsersPage
          embedded
          onDirtyChange={(d) => handleDirtyChange("users", d)}
          saveFnRef={usersSaveFnRef}
        />
      )}

      <UnsavedChangesDialog
        open={dialogOpen}
        message={`You have unsaved changes in ${dirtyTabLabel ?? "this section"}. Save before continuing?`}
        saving={savingFromDialog}
        onCancel={handleDialogCancel}
        onDiscard={handleDialogDiscard}
        onSave={() => void handleDialogSave()}
      />
    </div>
  );
}
