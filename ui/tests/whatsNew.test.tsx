import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WhatsNewHost } from "../src/components/onboarding/whatsNew/WhatsNewHost";
import { WHATS_NEW_TOURS } from "../src/components/onboarding/whatsNew/registry";
import { WhatsNewPage } from "../src/pages/WhatsNewPage";
import { UserContext } from "../src/lib/UserContext";
import { buildDigest, digestHeading, groupByVersion, type WhatsNewTour } from "../src/lib/whatsNew";
import type { CurrentUser, WhatsNewNote } from "../src/lib/types";

function makeNote(id: string, severity: "interrupt" | "dot" = "interrupt", seq = 1): WhatsNewNote {
  return { id, seq, severity, version: "0.11.0", title: `Title ${id}`, summary: `Summary ${id}`, date: null, supersedes: [] };
}

function makeUser(unseen: WhatsNewNote[] = []): CurrentUser {
  return {
    id: "u1",
    email: "a@example.com",
    firstname: "A",
    lastname: "B",
    role: "user",
    theme: "dark",
    preferred_add_hint_id: null,
    preferred_add_tag_ids: [],
    preferred_add_location_id: null,
    last_open_tag: null,
    shortcut_filters: [],
    whats_new: {
      latest_seq: unseen.length,
      unseen,
      unseen_interrupt_count: unseen.filter((n) => n.severity === "interrupt").length,
      welcome_pending: false,
    },
    created_at: null,
    last_login_at: null,
  } as CurrentUser;
}

function renderHost(user: CurrentUser, props: Partial<React.ComponentProps<typeof WhatsNewHost>> = {}) {
  const onUserChange = props.onUserChange ?? vi.fn();
  const view = render(
    <MemoryRouter initialEntries={["/items"]}>
      <Routes>
        <Route path="/items" element={<WhatsNewHost user={user} onUserChange={onUserChange} {...props} />} />
        <Route path="/release-notes" element={<p>history page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, onUserChange };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("buildDigest", () => {
  it("splits interrupting notes from smaller ones", () => {
    const digest = buildDigest([makeNote("a"), makeNote("b", "dot"), makeNote("c")]);
    expect(digest.interrupts.map((n) => n.id)).toEqual(["a", "c"]);
    expect(digest.smaller.map((n) => n.id)).toEqual(["b"]);
  });

  it("words the heading for one or several", () => {
    expect(digestHeading(buildDigest([makeNote("a")]))).toBe("1 thing changed since you were last here");
    expect(digestHeading(buildDigest([makeNote("a"), makeNote("b")]))).toBe("2 things changed since you were last here");
  });
});

describe("groupByVersion", () => {
  it("keeps the input order for groups and for notes inside them", () => {
    const rows = [
      { id: "a", version: "0.11.0" },
      { id: "b", version: "0.9.0" },
      { id: "c", version: "0.11.0" },
    ];
    expect(groupByVersion(rows).map((g) => [g.version, g.notes.map((n) => n.id)])).toEqual([
      ["0.11.0", ["a", "c"]],
      ["0.9.0", ["b"]],
    ]);
  });
});

describe("tours registry", () => {
  it("only notes with a registered tour get a Show me; release 2 registers tags-and-hints", () => {
    expect(Object.keys(WHATS_NEW_TOURS)).toEqual(["tags-and-hints"]);
  });
});

describe("WhatsNewHost", () => {
  it("renders nothing when there is nothing unseen", () => {
    const { container } = renderHost(makeUser());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for smaller (dot) notes: they only light the menu dot", () => {
    const { container } = renderHost(makeUser([makeNote("a", "dot")]));
    expect(container.innerHTML).toBe("");
  });

  it("waits while the welcome flow is on screen", () => {
    const { container } = renderHost(makeUser([makeNote("a")]), { suppress: true });
    expect(container.innerHTML).toBe("");
  });

  it("shows ONE card however many were missed, with a one-line summary each", () => {
    renderHost(makeUser([makeNote("a", "interrupt", 1), makeNote("b", "dot", 2), makeNote("c", "interrupt", 3)]));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "What's new" })).toBeTruthy();
    expect(screen.getByText("2 things changed since you were last here")).toBeTruthy();
    expect(screen.getByText("Title a")).toBeTruthy();
    expect(screen.getByText("Summary c")).toBeTruthy();
    expect(screen.queryByText("Title b")).toBeNull();
    expect(screen.getByText(/Plus 1 smaller change/)).toBeTruthy();
  });

  it("offers 'Show me' only where there is a tour, and a tour is on request, not forced", async () => {
    const Tour: WhatsNewTour = ({ onDone }) => <button onClick={onDone}>tour for a</button>;
    renderHost(makeUser([makeNote("a"), makeNote("b", "interrupt", 2)]), { tours: { a: Tour } });
    expect(screen.getAllByText("Show me")).toHaveLength(1);
    expect(screen.queryByText("tour for a")).toBeNull();

    await userEvent.click(screen.getByText("Show me"));
    expect(screen.getByText("tour for a")).toBeTruthy();

    await userEvent.click(screen.getByText("tour for a"));
    expect(screen.getByText("2 things changed since you were last here")).toBeTruthy();
  });

  it("'Got it' hides the card, records everything as seen and passes the updated user up", async () => {
    const updated = makeUser();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const { onUserChange } = renderHost(makeUser([makeNote("a")]));

    await userEvent.click(screen.getByText("Got it"));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(onUserChange).toHaveBeenCalledWith(updated));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/me/whats-new/seen");
    expect(init?.method).toBe("POST");
  });

  it("hides the card even when recording it fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderHost(makeUser([makeNote("a")]));
    await userEvent.click(screen.getByText("Got it"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("'View release notes' goes to the history page without marking anything seen (the page does that, so its New badges show)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderHost(makeUser([makeNote("a")]));
    await userEvent.click(screen.getByText("View release notes"));
    expect(screen.getByText("history page")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WhatsNewPage", () => {
  function renderPage(user: CurrentUser) {
    const setCurrentUser = vi.fn();
    render(
      <UserContext.Provider value={{ currentUser: user, setCurrentUser }}>
        <MemoryRouter>
          <WhatsNewPage />
        </MemoryRouter>
      </UserContext.Provider>,
    );
    return { setCurrentUser };
  }

  it("lists history as a list grouped by version, with New badges, then clears the unread state", async () => {
    const history = {
      notes: [
        { ...makeNote("new", "interrupt", 3), version: "0.11.0", unread: true },
        { ...makeNote("mid", "dot", 2), version: "0.11.0", unread: false },
        { ...makeNote("old", "interrupt", 1), version: "0.9.0", unread: false },
      ],
    };
    const cleared = makeUser();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      new Response(JSON.stringify(String(input) === "/api/whats-new" ? history : cleared), { status: 200 }),
    );
    const { setCurrentUser } = renderPage(makeUser([makeNote("new", "interrupt", 3)]));

    await screen.findByText("Title new");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Version 0.11.0", "Version 0.9.0"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText("New")).toHaveLength(1);
    expect(screen.queryByText(/replaced/i)).toBeNull();
    await waitFor(() => expect(setCurrentUser).toHaveBeenCalledWith(cleared));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/whats-new", "/api/me/whats-new/seen"]);
  });

  it("does not call the seen endpoint when there is nothing unseen", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ notes: [] }), { status: 200 }));
    renderPage(makeUser());
    await screen.findByText("No release notes yet.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
