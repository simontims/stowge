import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App, { resolvePostLoginRoute } from "../src/App";
import { makeUser, mockApi } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }), Toaster: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

describe("post-login route", () => {
  it("opens the last tag's items, URL-encoded", () => {
    expect(resolvePostLoginRoute(makeUser({ last_open_tag: "Tools & Bits" }))).toBe("/items?tag=Tools%20%26%20Bits");
  });

  it("falls back to /items when there is no last tag", () => {
    expect(resolvePostLoginRoute(makeUser({ last_open_tag: null }))).toBe("/items");
    expect(resolvePostLoginRoute(makeUser({ last_open_tag: "  " }))).toBe("/items");
  });
});

describe("routes", () => {
  function boot() {
    mockApi({
      "GET /api/me": makeUser(),
      "GET /healthz": {},
      "GET /api/tags": [],
      "GET /api/items/deleted": [],
    });
  }

  it.each(["/collections", "/tags"])("%s redirects to Settings > Tags and shows the tags list", async (path) => {
    boot();
    window.history.pushState(null, "", path);
    render(<App />);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/settings?tab=tags"));
    expect(await screen.findByRole("button", { name: /Add Tag/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tags" }).getAttribute("aria-selected")).toBe("true");
  });

  it("an old /items?collection= bookmark opens the same list as ?tag=", async () => {
    mockApi({
      "GET /api/me": makeUser(),
      "GET /healthz": {},
      "GET /api/tags": [],
      "GET /api/items": [],
      "GET /api/locations": [],
      "PATCH /api/me": makeUser(),
    });
    window.history.pushState(null, "", "/items?q=usb&collection=Attic");
    render(<App />);
    await waitFor(() => expect(window.location.search).toBe("?q=usb&tag=Attic"));
    expect(window.location.pathname).toBe("/items");
  });

  it("/ goes to the last open tag's items", async () => {
    mockApi({
      "GET /api/me": makeUser({ last_open_tag: "Cables" }),
      "GET /healthz": {},
      "GET /api/tags": [],
      "GET /api/items": [],
      "GET /api/locations": [],
    });
    vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
    window.history.pushState(null, "", "/");
    render(<App />);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/items?tag=Cables"));
    vi.unstubAllGlobals();
  });
});
