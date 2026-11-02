import { vi } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UserContext } from "../src/lib/UserContext";
import type { AiHint, CurrentUser, Tag } from "../src/lib/types";

export function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "u1",
    email: "a@example.com",
    firstname: "A",
    lastname: "B",
    role: "admin",
    theme: "dark",
    preferred_add_hint_id: null,
    preferred_add_tag_ids: [],
    preferred_add_location_id: null,
    last_open_tag: null,
    shortcut_filters: [],
    whats_new: { latest_seq: 3, unseen: [], unseen_interrupt_count: 0, welcome_pending: false },
    created_at: null,
    last_login_at: null,
    ...overrides,
  };
}

export function makeTag(id: string, name: string, extra: Partial<Tag> = {}): Tag {
  return { id, name, icon: null, color: null, description: null, item_count: 0, ...extra };
}

export const DEFAULT_HINT: AiHint = { id: "h-default", name: "Default", text: "General stuff", is_default: true };

export function makeFilter(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    query: "",
    tag_id: null,
    statuses: [],
    status: null,
    site_id: null,
    area_id: null,
    location_id: null,
    quantity_min: null,
    quantity_max: null,
    pinned: true,
    icon: null,
    color: null,
    ...extra,
  };
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

type Handler = unknown | ((call: RecordedCall) => unknown);

/** Mock fetch by "METHOD /path" (query string ignored in the key, kept in `path`). A handler can be a
 *  value (JSON) or a function of the call. Unknown routes answer 404 so a stray request is visible. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { method, path: url, body };
    calls.push(call);
    const key = `${method} ${url.split("?")[0]}`;
    if (!(key in routes)) {
      return new Response(JSON.stringify({ detail: `unmocked ${key}` }), { status: 404 });
    }
    const handler = routes[key];
    const value = typeof handler === "function" ? (handler as (c: RecordedCall) => unknown)(call) : handler;
    return new Response(JSON.stringify(value), { status: 200 });
  });
  return { calls, spy, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path.split("?")[0] === path) };
}

export function renderWithUser(ui: ReactElement, user: CurrentUser = makeUser(), initialEntries: string[] = ["/"]) {
  return render(
    <UserContext.Provider value={{ currentUser: user, setCurrentUser: () => {} }}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </UserContext.Provider>,
  );
}
