import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EVENTS, Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { TOUR_OPEN_ADD_LOCATION_FORM_EVENT } from "../../lib/onboarding";

interface HierarchyIntroTourProps {
  open: boolean;
  isAdmin: boolean;
  onComplete: () => void;
}

export function HierarchyIntroTour({ open, isAdmin, onComplete }: HierarchyIntroTourProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }

    if (!isAdmin) {
      setReady(true);
      return;
    }

    const onLocationsTab = location.pathname === "/system" && new URLSearchParams(location.search).get("tab") === "locations";
    if (!onLocationsTab) {
      navigate("/system?tab=locations", { replace: true });
      return;
    }

    const timer = window.setTimeout(() => {
      setReady(true);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, isAdmin, location.pathname, location.search, navigate]);

  const steps = useMemo<Step[]>(() => {
    if (!isAdmin) {
      return [
        {
          target: "body",
          placement: "center",
          skipBeacon: true,
          title: "New: Sites and Areas hierarchy",
          content: (
            <div className="space-y-2 text-sm leading-6">
              <p>
                Locations now support a 3-level hierarchy: <strong>Site {"->"} Area {"->"} Location</strong>.
              </p>
              <p>
                You will see clearer location labels while adding and viewing items.
              </p>
            </div>
          ),
        },
      ];
    }

    return [
      {
        target: "[data-tour='system-tab-locations']",
        placement: "bottom",
        skipBeacon: true,
        title: "Locations now includes hierarchy",
        content: (
          <p className="text-sm leading-6">
            Use this <strong>Locations</strong> tab to manage Sites, Areas, and Locations.
          </p>
        ),
      },
      {
        target: "[data-tour='locations-hierarchy-toggle']",
        placement: "bottom",
        skipBeacon: true,
        title: "Sites and Areas card",
        content: (
          <div className="space-y-2 text-sm leading-6">
            <p>
              Use this collapsible card to manage your hierarchy.
            </p>
            <p>
              A <strong>Site</strong> is a top-level place like Home or Storage Unit, and an <strong>Area</strong> is a zone within a Site.
            </p>
          </div>
        ),
      },
      {
        target: "[data-tour='locations-add-area']",
        placement: "bottom",
        skipBeacon: true,
        before: async () => {
          const addAreaButton = document.querySelector("[data-tour='locations-add-area']");
          if (!addAreaButton) {
            const toggle = document.querySelector("[data-tour='locations-hierarchy-toggle']") as HTMLElement | null;
            toggle?.click();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 120));
        },
        title: "Add an Area",
        content: (
          <div className="space-y-2 text-sm leading-6">
            <p>
              Add Areas inside each Site, for example <strong>Garage</strong>, <strong>Attic</strong>, or <strong>Shed</strong>.
            </p>
            <p>
              Most users can start with the default Site named <strong>Home</strong>.
            </p>
          </div>
        ),
      },
      {
        target: "[data-tour='locations-add-location-button']",
        placement: "left",
        skipBeacon: true,
        title: "Add Locations",
        content: (
          <p className="text-sm leading-6">
            Add each exact storage <strong>Location</strong> under the correct Area, then assign items there.
          </p>
        ),
      },
      {
        target: "[data-tour='locations-area-select']",
        placement: "left",
        skipBeacon: true,
        before: async () => {
          window.dispatchEvent(new CustomEvent(TOUR_OPEN_ADD_LOCATION_FORM_EVENT));
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        },
        title: "Choose the Area",
        content: (
          <p className="text-sm leading-6">
            Set the <strong>Area</strong> here when creating a Location so it appears in the right Site and Area hierarchy.
          </p>
        ),
      },
      {
        target: "[data-tour='locations-area-filter']",
        placement: "bottom",
        skipBeacon: true,
        title: "Filter your Locations",
        content: (
          <p className="text-sm leading-6">
            Use Site and Area filters to quickly narrow the Locations table.
          </p>
        ),
      },
      {
        target: "[data-tour='locations-add-site']",
        placement: "bottom",
        skipBeacon: true,
        before: async () => {
          const addSiteButton = document.querySelector("[data-tour='locations-add-site']");
          if (!addSiteButton) {
            const toggle = document.querySelector("[data-tour='locations-hierarchy-toggle']") as HTMLElement | null;
            toggle?.click();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 120));
        },
        title: "Optional: Add another Site",
        content: <p className="text-sm leading-6">Add another Site only when you manage storage in multiple places.</p>,
      },
    ];
  }, [isAdmin]);

  function handleEvent(data: EventData) {
    const status = data.status;

    if (data.type === EVENTS.TARGET_NOT_FOUND) {
      return;
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      onComplete();
    }
  }

  return (
    <Joyride
      run={open && ready}
      steps={steps}
      continuous
      onEvent={handleEvent}
      options={{
        zIndex: 2000,
        arrowColor: "#262626",
        backgroundColor: "#262626",
        overlayColor: "rgba(0,0,0,0.55)",
        primaryColor: "#2563eb",
        textColor: "#f5f5f5",
        dismissKeyAction: "close",
        overlayClickAction: false,
        showProgress: true,
        buttons: ["back", "close", "primary", "skip"],
      }}
      locale={{
        back: "Back",
        close: "Close",
        last: "Done",
        next: "Next",
        skip: "Skip",
      }}
      styles={{
        tooltip: {
          border: "1px solid #404040",
          borderRadius: 10,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
        },
        tooltipTitle: {
          fontSize: "0.95rem",
          fontWeight: 600,
          marginBottom: "0.4rem",
        },
        buttonBack: {
          color: "#d4d4d4",
        },
        buttonSkip: {
          color: "#a3a3a3",
        },
        buttonPrimary: {
          backgroundColor: "#2563eb",
          color: "#ffffff",
          fontWeight: 600,
        },
      }}
    />
  );
}
