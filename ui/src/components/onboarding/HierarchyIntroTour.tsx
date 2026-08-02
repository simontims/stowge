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
          title: "New: Site and Area hierarchy",
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
        title: "Locations now include hierarchy",
        content: (
          <p className="text-sm leading-6">
            Use this <strong>Locations</strong> tab to manage the new Site / Area / Location structure.
          </p>
        ),
      },
      {
        target: "[data-tour='locations-sites-section']",
        placement: "bottom",
        skipBeacon: true,
        title: "Step 1: Create Sites",
        content: (
          <div className="space-y-2 text-sm leading-6">
            <p>
              A <strong>Site</strong> is a top-level place like Home, Storage Unit, My Other House.
            </p>
            <p>
              A default first site has been created for you named, <strong>'Home'</strong>.
            </p>
          </div>
        ),
      },
      {
        target: "[data-tour='locations-areas-section']",
        placement: "bottom",
        skipBeacon: true,
        title: "Step 2: Create Areas",
        content: (
          <div className="space-y-2 text-sm leading-6">
            <p>
              An <strong>Area</strong> is a zone inside a Site, such as Attic, Garage, Shed, etc.
            </p>
            <p>
              A default first area has been created for you named, <strong>'General'</strong>.
            </p>
          </div>
        ),
      },
      {
        target: "[data-tour='locations-add-location-button']",
        placement: "left",
        skipBeacon: true,
        title: "Step 3: Add Locations",
        content: (
          <p className="text-sm leading-6">
            Add each exact storage <strong>Location</strong> under the right Area, then assign items there.
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
            Set the <strong>Area</strong> here when creating a Location so it lands in the correct Site hierarchy.
          </p>
        ),
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
        primaryColor: "#84cc16",
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
          backgroundColor: "#84cc16",
          color: "#172554",
          fontWeight: 600,
        },
      }}
    />
  );
}
