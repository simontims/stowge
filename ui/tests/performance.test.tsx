import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import { apiGetShared } from "../src/lib/api";
import { TablerIcon } from "../src/components/ui/TablerIcon";
import { WelcomeTour } from "../src/components/onboarding/welcome/WelcomeTour";
import { makeUser, mockApi } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }), Toaster: () => null }));

// Evaluated only when something actually loads these heavy modules.
const loaded = vi.hoisted(() => ({ catalogue: 0, joyride: 0 }));
vi.mock("../src/lib/tablerIconCatalogue", () => {
  loaded.catalogue += 1;
  return { TABLER_CATALOGUE: [] };
});
vi.mock("react-joyride", () => {
  loaded.joyride += 1;
  return { EVENTS: {}, STATUS: {}, Joyride: () => null };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/");
});

describe("first load requests", () => {
  it("asks for the tag list and the user once, not once per component", async () => {
    const api = mockApi({
      "GET /api/me": makeUser(),
      "GET /healthz": {},
      "GET /api/tags": [],
      "GET /api/items": [],
      "GET /api/locations": [],
    });
    vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
    window.history.pushState(null, "", "/items");
    render(<App />);
    await waitFor(() => expect(api.find("GET", "/api/items").length).toBe(1));
    await waitFor(() => expect(api.find("GET", "/api/locations").length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    // Sidebar, mobile drawer and Items page each want the tags; /api/me is the auth probe + one shared load.
    expect(api.find("GET", "/api/tags").length).toBe(1);
    expect(api.find("GET", "/api/me").length).toBe(2);
  });

  it("shares only simultaneous requests: a later call fetches fresh data", async () => {
    let n = 0;
    const api = mockApi({ "GET /api/x": () => ({ n: ++n }) });
    const [a, b] = await Promise.all([apiGetShared<{ n: number }>("/api/x"), apiGetShared<{ n: number }>("/api/x")]);
    expect(api.find("GET", "/api/x").length).toBe(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // separate copies
    expect((await apiGetShared<{ n: number }>("/api/x")).n).toBe(2);
  });
});

describe("lazy loading", () => {
  it("shows a tag icon from a small shard without loading the 2.6 MB catalogue", async () => {
    const { container } = render(<TablerIcon name="arrow-left" size={16} />);
    await waitFor(() => expect(container.querySelector(".tabler-icon-arrow-left")).toBeTruthy());
    expect(loaded.catalogue).toBe(0);
  });

  it("keeps the fallback icon for an unknown icon name", async () => {
    const { container } = render(<TablerIcon name="no-such-icon" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector(".tabler-icon-no-such-icon")).toBeNull();
  });

  it("does not load the tour library until the tour runs", async () => {
    const { rerender } = render(<WelcomeTour run={false} isAdmin={false} onFinish={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(loaded.joyride).toBe(0);
    rerender(<WelcomeTour run isAdmin={false} onFinish={() => {}} />);
    await waitFor(() => expect(loaded.joyride).toBe(1));
    expect(screen).toBeTruthy();
  });
});
