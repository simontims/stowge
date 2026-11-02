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

  it("falls back to /tags when there is no last tag", () => {
    expect(resolvePostLoginRoute(makeUser({ last_open_tag: null }))).toBe("/tags");
    expect(resolvePostLoginRoute(makeUser({ last_open_tag: "  " }))).toBe("/tags");
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

  it("/collections redirects to /tags and shows the Tags page", async () => {
    boot();
    window.history.pushState(null, "", "/collections");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/tags"));
    expect(await screen.findByText("Group items with tags. An item can have several.")).toBeTruthy();
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
