import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, lazy } from "react";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { WelcomeTour } from "../src/components/onboarding/welcome/WelcomeTour";
import { RELOAD_WINDOW_MS, installChunkRecovery } from "../src/lib/chunkRecovery";
import { apiGetShared, apiRequest } from "../src/lib/api";
import { TablerIcon } from "../src/components/ui/TablerIcon";
import * as shardLoader from "../src/components/ui/TablerIcon";
import { SettingsLocationsPage } from "../src/pages/SettingsLocationsPage";
import { ItemsPage } from "../src/pages/ItemsPage";
import { TABLER_CATALOGUE } from "../src/lib/tablerIconCatalogue";
import { loadTablerIcon } from "../src/components/ui/TablerIcon";
import { makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }), Toaster: () => null }));
vi.mock("react-joyride", () => ({ EVENTS: {}, STATUS: {}, Joyride: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("chunk load failure", () => {
  it("shows a message and a Reload button when a lazy route fails to load, not an empty page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    const { container } = render(
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Broken />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(await screen.findByText("Something went wrong loading this page.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(container.textContent).not.toBe("");
  });

  it("the Reload button reloads the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    function Boom(): never {
      throw new Error("boom");
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a tour whose chunk fails to load does not crash the app and ends the tour", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("../src/components/onboarding/GuidedTour", () => {
      throw new Error("chunk gone");
    });
    const { WelcomeTour: Fresh } = await import("../src/components/onboarding/welcome/WelcomeTour");
    const onFinish = vi.fn();
    render(
      <div data-testid="app">
        <Fresh run isAdmin={false} onFinish={onFinish} />
      </div>,
    );
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(screen.getByTestId("app")).toBeTruthy();
    vi.doUnmock("../src/components/onboarding/GuidedTour");
    expect(WelcomeTour).toBeTruthy();
  });

  it("vite:preloadError reloads once per minute, never in a loop, and survives unavailable storage", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const remove = installChunkRecovery();
    const fire = () => {
      const ev = new Event("vite:preloadError", { cancelable: true });
      window.dispatchEvent(ev);
      return ev;
    };
    expect(fire().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELOAD_WINDOW_MS - 1000); // a slow second failure is still inside the window
    fire();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    fire();
    expect(reload).toHaveBeenCalledTimes(2);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.advanceTimersByTime(RELOAD_WINDOW_MS * 2);
    expect(() => fire()).not.toThrow();
    expect(reload).toHaveBeenCalledTimes(2);
    remove();
    vi.useRealTimers();
  });

  it("the error screen clears when the user navigates to another page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error("chunk gone")));
    function Harness({ path }: { path: string }) {
      return (
        <ErrorBoundary resetKey={path}>
          <Suspense fallback={null}>{path === "/broken" ? <Broken /> : <p>Fine page</p>}</Suspense>
        </ErrorBoundary>
      );
    }
    const { rerender } = render(<Harness path="/broken" />);
    expect(await screen.findByText("Something went wrong loading this page.")).toBeTruthy();
    rerender(<Harness path="/ok" />);
    expect(await screen.findByText("Fine page")).toBeTruthy();
  });
});

describe("tabler icon shards", () => {
  it("resolves every catalogue name (aliases included) and an alias is its target's component", async () => {
    const unresolved: string[] = [];
    for (const entry of TABLER_CATALOGUE) {
      const c = await loadTablerIcon(entry.name);
      if (!c) unresolved.push(entry.name);
      else expect((c as { displayName?: string }).displayName).toBe((entry.component as { displayName?: string }).displayName);
    }
    expect(unresolved).toEqual([]);
    expect(await loadTablerIcon("123")).toBe(await loadTablerIcon("number-123"));
    expect(await loadTablerIcon("box-seam")).toBeTruthy();
    expect(await loadTablerIcon("definitely-not-an-icon")).toBeNull();
  }, 120_000);

  it("does not cache a failed load: a transient failure then success shows the icon", async () => {
    const real = (await import("virtual:tabler-shards")).default as Record<string, () => Promise<unknown>>;
    expect(real.ar).toBeTruthy();
    vi.resetModules();
    let fail = true;
    vi.doMock("virtual:tabler-shards", () => ({
      default: new Proxy(real, {
        get(target, key: string) {
          if (key === "ar" && fail) return () => Promise.reject(new Error("network"));
          return target[key];
        },
      }),
    }));
    const { TablerIcon: Fresh } = await import("../src/components/ui/TablerIcon");
    const first = render(<Fresh name="arrow-left" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(first.container.querySelector(".tabler-icon-arrow-left")).toBeNull();
    first.unmount();
    fail = false;
    const second = render(<Fresh name="arrow-left" />);
    await waitFor(() => expect(second.container.querySelector(".tabler-icon-arrow-left")).toBeTruthy());
    vi.doUnmock("virtual:tabler-shards");
    expect(TablerIcon).toBeTruthy();
    expect(shardLoader).toBeTruthy();
  });
});

describe("apiGetShared after a mutation", () => {
  it("a GET started after a PATCH does not join an older in-flight GET", async () => {
    let name = "before";
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseFirst = r));
    let getCount = 0;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(method);
      if (method === "PATCH") {
        name = "after";
        return new Response(JSON.stringify({ name }), { status: 200 });
      }
      const snapshot = name;
      if (++getCount === 1) await gate; // the first GET is slow and carries pre-PATCH data
      return new Response(JSON.stringify({ name: snapshot }), { status: 200 });
    });
    const first = apiGetShared<{ name: string }>("/api/me");
    await apiRequest("/api/me", { method: "PATCH", body: JSON.stringify({ x: 1 }) });
    const third = await apiGetShared<{ name: string }>("/api/me");
    releaseFirst();
    await first;
    expect(calls).toEqual(["GET", "PATCH", "GET"]);
    expect(third.name).toBe("after");
  });
});

describe("thumbnails", () => {
  function expectLazy(img: HTMLImageElement | null, size: number) {
    expect(img).toBeTruthy();
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
    expect(img!.getAttribute("width")).toBe(String(size));
    expect(img!.getAttribute("height")).toBe(String(size));
  }

  it("Items list thumbnails are lazy, async-decoded and sized", async () => {
    vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
    mockApi({
      "GET /api/items": [
        { id: "i1", name: "Hammer", description: null, tags: [], location: null, status: "draft", quantity: 1, created_at: "2026-01-01", thumb: "/t/i1.jpg" },
      ],
      "GET /api/locations": [],
      "GET /api/tags": [],
      "PATCH /api/me": makeUser(),
    });
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    await screen.findByText("Hammer");
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src="/t/i1.jpg"]'));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expectLazy(img, Number(img.getAttribute("width")));
    expect(imgs.map((i) => i.getAttribute("width"))).toContain("40");
  });

  it("Locations thumbnail is lazy, async-decoded and sized", async () => {
    mockApi({
      "GET /api/locations": [
        { id: "l1", name: "Shed", description: null, area_id: null, area_name: null, site_id: null, site_name: null, icon: null, color: null, item_count: 0, photo_url: "/p/l1.jpg", created_at: null, updated_at: null },
      ],
      "GET /api/sites": [],
      "GET /api/areas": [],
    });
    renderWithUser(<SettingsLocationsPage embedded />, makeUser(), ["/settings"]);
    await screen.findByText("Shed");
    expectLazy(document.querySelector<HTMLImageElement>('img[src="/p/l1.jpg"]'), 32);
  });
});
