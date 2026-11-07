import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Step } from "react-joyride";
import { GuidedTour, isTargetVisible, resolveSteps } from "../src/components/onboarding/GuidedTour";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const SIZED = () => ({ width: 100, height: 20 });
const EMPTY = () => ({ width: 0, height: 0 });

function stepFor(target: string): Step {
  return { target, placement: "right", title: "T", content: "C" };
}

describe("isTargetVisible", () => {
  it("is false for a missing element and for one with no size", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(isTargetVisible(null)).toBe(false);
    expect(isTargetVisible(el, EMPTY)).toBe(false);
    expect(isTargetVisible(el, SIZED)).toBe(true);
  });

  it("is false for display:none and visibility:hidden even when a size is reported", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.style.display = "none";
    expect(isTargetVisible(el, SIZED)).toBe(false);
    el.style.display = "";
    el.style.visibility = "hidden";
    expect(isTargetVisible(el, SIZED)).toBe(false);
  });
});

describe("resolveSteps", () => {
  it("keeps visible targets, and centres missing and invisible ones with the same copy", () => {
    document.body.innerHTML = `<a data-tour="here"></a><a data-tour="hidden" style="display:none"></a>`;
    const steps = [stepFor("[data-tour='here']"), stepFor("[data-tour='hidden']"), stepFor("[data-tour='gone']"), { ...stepFor("body"), placement: "center" as const }];
    const out = resolveSteps(steps, document, SIZED);
    expect(out[0]).toBe(steps[0]);
    for (const i of [1, 2]) {
      expect(out[i].target).toBe("body");
      expect(out[i].placement).toBe("center");
      expect(out[i].title).toBe("T");
      expect(out[i].content).toBe("C");
    }
    expect(out[3]).toBe(steps[3]);
    expect(out).toHaveLength(4);
  });

  it("centres a step whose target has no layout (zero size)", () => {
    document.body.innerHTML = `<a data-tour="here"></a>`;
    expect(resolveSteps([stepFor("[data-tour='here']")], document, EMPTY)[0].target).toBe("body");
  });
});

describe("GuidedTour with a missing target", () => {
  it("shows the step centred instead of dropping it", async () => {
    render(<GuidedTour run steps={[{ ...stepFor("[data-tour='gone']"), title: "Lost step" }]} onFinish={() => {}} />);
    expect(await screen.findByText("Lost step")).toBeTruthy();
  });
});

describe("one menu-filters target", () => {
  const tags = [makeTag("t1", "Cables")];
  function setup() {
    const user = makeUser({ shortcut_filters: [makeFilter("f1", "Cables", { tag_id: "t1" })] as never });
    mockApi({ "GET /api/tags": tags, "GET /api/me": user });
    return user;
  }

  it("the mobile drawer renders no data-tour='menu-filters'", async () => {
    const user = setup();
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user);
    await screen.findByRole("list", { name: "Filters" });
    expect(document.querySelectorAll("[data-tour='menu-filters']")).toHaveLength(0);
  });

  it("the collapsed sidebar renders none, the expanded one exactly one", async () => {
    const user = setup();
    const { unmount } = renderWithUser(<Sidebar collapsed onToggleCollapse={() => {}} />, user);
    expect(document.querySelectorAll("[data-tour='menu-filters']")).toHaveLength(0);
    unmount();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Filters" });
    expect(document.querySelectorAll("[data-tour='menu-filters']")).toHaveLength(1);
  });

  it("sidebar and drawer together still give exactly one", async () => {
    const user = setup();
    renderWithUser(
      <>
        <Sidebar collapsed={false} onToggleCollapse={() => {}} />
        <MobileNavDrawer open onClose={() => {}} />
      </>,
      user,
    );
    await screen.findAllByRole("list", { name: "Filters" });
    expect(document.querySelectorAll("[data-tour='menu-filters']")).toHaveLength(1);
  });
});
