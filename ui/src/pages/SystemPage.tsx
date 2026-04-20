import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog";
import { DashboardPage } from "./DashboardPage";
import { SettingsCollectionsPage } from "./SettingsCollectionsPage";
import { SettingsAiPage } from "./SettingsAiPage";
import { SettingsImagesPage } from "./SettingsImagesPage";
import { SettingsLocationsPage } from "./SettingsLocationsPage";
import { SettingsUsersPage } from "./SettingsUsersPage";
import { useBeforeUnload } from "../lib/useBeforeUnload";

type Tab = "status" | "collections" | "ai" | "images" | "locations" | "users";

const DEFAULT_TAB: Tab = "status";

const TABS: Array<{ id: Tab; label: string; description: string }> = [
  { id: "status",      label: "Status",      description: "System health and inventory metrics" },
  { id: "collections", label: "Collections", description: "Manage inventory collections and AI hints" },
  { id: "ai",          label: "AI",          description: "Configure LLM providers and models" },
  { id: "images",      label: "Images",      description: "Image storage quality and format" },
  { id: "locations",   label: "Locations",   description: "Manage storage locations" },
  { id: "users",       label: "Users",       description: "Manage user accounts and access" },
];

type SaveRef = { current: (() => Promise<void>) | null };

function parseTab(raw: string | null): Tab {
  const match = TABS.find((tab) => tab.id === raw);
  return match?.id ?? DEFAULT_TAB;
}

export function SystemPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);

  const [activeTab, setActiveTab] = useState<Tab>(requestedTab);
  const [dirtySection, setDirtySection] = useState<Exclude<Tab, "status"> | null>(null);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const [savingFromDialog, setSavingFromDialog] = useState(false);

  const collectionsSaveFnRef = useRef<(() => Promise<void>) | null>(null);
  const aiSaveFnRef = useRef<(() => Promise<void>) | null>(null);
  const imagesSaveFnRef = useRef<(() => Promise<void>) | null>(null);
  const locationsSaveFnRef = useRef<(() => Promise<void>) | null>(null);
  const usersSaveFnRef = useRef<(() => Promise<void>) | null>(null);

  const saveFnRefMap: Record<Exclude<Tab, "status">, SaveRef> = {
    collections: collectionsSaveFnRef,
    ai: aiSaveFnRef,
    images: imagesSaveFnRef,
    locations: locationsSaveFnRef,
    users: usersSaveFnRef,
  };

  const isDirty = dirtySection !== null;
  useBeforeUnload(isDirty);
  const dialogOpen = pendingTab !== null;

  useEffect(() => {
    if (activeTab === requestedTab) {
      return;
    }
    if (isDirty) {
      const rollback = new URLSearchParams(searchParams);
      if (activeTab === DEFAULT_TAB) {
        rollback.delete("tab");
      } else {
        rollback.set("tab", activeTab);
      }
      setSearchParams(rollback, { replace: true });
      setPendingTab(requestedTab);
      return;
    }
    setActiveTab(requestedTab);
  }, [requestedTab, activeTab, isDirty, searchParams, setSearchParams]);

  function navigateToTab(tab: Tab) {
    const next = new URLSearchParams(searchParams);
    if (tab === DEFAULT_TAB) {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: false });
    setActiveTab(tab);
  }

  function handleDirtyChange(tab: Exclude<Tab, "status">, dirty: boolean) {
    setDirtySection((current) => (dirty ? tab : current === tab ? null : current));
  }

  function handleTabClick(tab: Tab) {
    if (tab === activeTab) return;
    if (isDirty) {
      setPendingTab(tab);
      return;
    }
    navigateToTab(tab);
  }

  async function handleDialogSave() {
    const fn = dirtySection ? saveFnRefMap[dirtySection].current : null;
    if (!fn) {
      handleDialogDiscard();
      return;
    }
    setSavingFromDialog(true);
    try {
      await fn();
      setDirtySection(null);
      proceedAction();
    } catch {
      // Save failed: keep current tab so user can retry.
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
      navigateToTab(pendingTab);
      setPendingTab(null);
    }
  }

  const dirtyTabLabel = dirtySection
    ? (TABS.find((tab) => tab.id === dirtySection)?.label ?? dirtySection)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader title="System" />

      <div className="flex border-b border-neutral-800">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
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

      {activeTab === "status" && <DashboardPage embedded />}
      {activeTab === "collections" && (
        <SettingsCollectionsPage
          embedded
          onDirtyChange={(dirty) => handleDirtyChange("collections", dirty)}
          saveFnRef={collectionsSaveFnRef}
        />
      )}
      {activeTab === "ai" && (
        <SettingsAiPage
          embedded
          onDirtyChange={(dirty) => handleDirtyChange("ai", dirty)}
          saveFnRef={aiSaveFnRef}
        />
      )}
      {activeTab === "images" && (
        <SettingsImagesPage
          embedded
          onDirtyChange={(dirty) => handleDirtyChange("images", dirty)}
          saveFnRef={imagesSaveFnRef}
        />
      )}
      {activeTab === "locations" && (
        <SettingsLocationsPage
          embedded
          onDirtyChange={(dirty) => handleDirtyChange("locations", dirty)}
          saveFnRef={locationsSaveFnRef}
        />
      )}
      {activeTab === "users" && (
        <SettingsUsersPage
          embedded
          onDirtyChange={(dirty) => handleDirtyChange("users", dirty)}
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
