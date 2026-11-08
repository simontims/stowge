import { useEffect, useRef, useState } from "react";
import { EVENTS, Joyride, STATUS, type EventData, type Step } from "react-joyride";

/** Size of an element as the browser lays it out. Injected in tests, since jsdom has no layout. */
export type MeasureFn = (el: Element) => { width: number; height: number };

const defaultMeasure: MeasureFn = (el) => el.getBoundingClientRect();

/** True when the element can actually be pointed at: it has a size and is not display:none or
 *  visibility:hidden. */
export function isTargetVisible(el: Element | null | undefined, measure: MeasureFn = defaultMeasure): boolean {
  if (!el) return false;
  const rect = measure(el);
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const view = el.ownerDocument.defaultView;
  const style = view ? view.getComputedStyle(el) : null;
  return !(style && (style.display === "none" || style.visibility === "hidden"));
}

/** Turns every step whose target is missing or invisible (collapsed sidebar, mobile layout) into a
 *  centred step with the same title and content, so it is still shown rather than skipped. */
export function resolveSteps(steps: Step[], doc: Document, measure: MeasureFn = defaultMeasure): Step[] {
  return steps.map((step) => {
    if (typeof step.target !== "string" || step.target === "body") return step;
    let el: Element | null = null;
    try {
      el = doc.querySelector(step.target);
    } catch {
      el = null;
    }
    if (isTargetVisible(el, measure)) return step;
    return { ...step, target: "body", placement: "center" };
  });
}

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

  // Targets are re-checked when the tour starts and after every step, since the menu loads its
  // filters asynchronously and the layout can change while the tour is open.
  const [resolved, setResolved] = useState<Step[]>(() => resolveSteps(steps, document));
  function refreshSteps() {
    const next = resolveSteps(steps, document);
    setResolved((current) =>
      current.length === next.length && current.every((s, i) => s.target === next[i].target && s.placement === next[i].placement)
        ? current
        : next,
    );
  }
  useEffect(() => {
    if (run) refreshSteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, steps, instance]);

  function handleEvent(data: EventData) {
    if (data.type === EVENTS.TARGET_NOT_FOUND || data.type === EVENTS.STEP_AFTER) {
      refreshSteps();
      return;
    }
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) onFinish();
  }

  // The tour's colours come from the same roles as the rest of the UI, so it follows the theme.
  const role = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const tooltipBg = role("surface-2");
  const accent = role("info-600");

  return (
    <Joyride
      key={instance}
      run={run}
      steps={resolved}
      continuous
      onEvent={handleEvent}
      options={{
        zIndex: 2000,
        arrowColor: tooltipBg,
        backgroundColor: tooltipBg,
        overlayColor: "rgba(0,0,0,0.55)",
        primaryColor: accent,
        textColor: role("heading"),
        // One control ends the tour: the X. (Joyride's default X advances a step, which is confusing.)
        closeButtonAction: "skip",
        dismissKeyAction: false,
        overlayClickAction: false,
        showProgress: true,
        buttons: ["back", "close", "primary"],
      }}
      locale={{ back: "Back", close: "Close tour", last: "Done", next: "Next" }}
      styles={{
        tooltip: { border: `1px solid ${role("border-strong")}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)" },
        floater: { transition: "none" },
        tooltipTitle: { fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.4rem" },
        buttonBack: { color: role("secondary") },
        buttonPrimary: { backgroundColor: accent, color: role("on-solid"), fontWeight: 600 },
      }}
    />
  );
}
