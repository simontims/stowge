import { useEffect, useRef, useState } from "react";
import { EVENTS, Joyride, STATUS, type EventData, type Step } from "react-joyride";

interface GuidedTourProps {
  run: boolean;
  steps: Step[];
  onFinish: () => void;
}

/** A guided tour (react-joyride) with the app's settings. The X ends the tour (there is no Skip),
 *  Escape ends it, and every run starts at step 1. Shared by the welcome tour and What's New tours. */
export function GuidedTour({ run, steps, onFinish }: GuidedTourProps) {
  // Joyride keeps its step position after the tour is stopped from outside (Escape, the X, the
  // menu item), so the next run would resume part-way. Give every run a fresh instance instead,
  // so a tour always starts at step 1 however the previous one ended.
  const [instance, setInstance] = useState(0);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !run) setInstance((current) => current + 1);
    wasRunning.current = run;
  }, [run]);

  // Joyride's ESC can only advance a step, not end the tour, so ESC is disabled there and handled here.
  useEffect(() => {
    if (!run) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onFinish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run, onFinish]);

  function handleEvent(data: EventData) {
    if (data.type === EVENTS.TARGET_NOT_FOUND) return;
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) onFinish();
  }

  return (
    <Joyride
      key={instance}
      run={run}
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
        // One control ends the tour: the X. (Joyride's default X advances a step, which is confusing.)
        closeButtonAction: "skip",
        dismissKeyAction: false,
        overlayClickAction: false,
        showProgress: true,
        buttons: ["back", "close", "primary"],
      }}
      locale={{ back: "Back", close: "Close tour", last: "Done", next: "Next" }}
      styles={{
        tooltip: { border: "1px solid #404040", borderRadius: 10, boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)" },
        floater: { transition: "none" },
        tooltipTitle: { fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.4rem" },
        buttonBack: { color: "#d4d4d4" },
        buttonPrimary: { backgroundColor: "#2563eb", color: "#ffffff", fontWeight: 600 },
      }}
    />
  );
}
