import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { UserContext } from "../src/lib/UserContext";
import { TagsPage } from "../src/pages/TagsPage";
import { SettingsHintsPage } from "../src/pages/SettingsHintsPage";
import { SettingsShortcutsPage } from "../src/pages/SettingsShortcutsPage";
import { SettingsAiPage } from "../src/pages/SettingsAiPage";
import { SettingsImagesPage } from "../src/pages/SettingsImagesPage";
import { SettingsApiKeysPage } from "../src/pages/SettingsApiKeysPage";
import { SettingsUsersPage } from "../src/pages/SettingsUsersPage";
import { SettingsLocationsPage } from "../src/pages/SettingsLocationsPage";
import { RecycleBinPage } from "../src/pages/RecycleBinPage";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { TagPicker } from "../src/components/ui/TagPicker";
import { makeUser } from "./testUtils";

/** useEffect runs after the browser has painted, so the first render is on screen for a frame before any
 *  request starts. Server rendering shows exactly that render. It must say Loading, never "none found". */
function firstPaint(ui: ReactElement): string {
  return renderToString(
    <UserContext.Provider value={{ currentUser: makeUser({ role: "admin" }), setCurrentUser: () => {} }}>
      <MemoryRouter initialEntries={["/settings"]}>{ui}</MemoryRouter>
    </UserContext.Provider>,
  );
}

const EMPTY_CLAIMS = [
  /No tags yet/,
  /No tags match/,
  /No hints yet/,
  /No hints match/,
  /No filters yet/,
  /No filters match/,
  /No AI models configured/,
  /No API keys found/,
  /No users found/,
  /No locations found/,
  /No locations match/,
  /Recycle bin is empty/,
  /No filters yet/,
];

const PAGES: Array<[string, ReactElement, RegExp]> = [
  ["Tags", <TagsPage embedded />, /Loading tags/],
  ["AI hints", <SettingsHintsPage />, /Loading AI hints/],
  ["Filters", <SettingsShortcutsPage embedded />, /Loading filters/],
  ["AI models", <SettingsAiPage embedded />, /Loading AI models/],
  ["API keys", <SettingsApiKeysPage embedded />, /Loading API keys/],
  ["Users", <SettingsUsersPage embedded />, /Loading users/],
  ["Locations", <SettingsLocationsPage embedded />, /Loading locations/],
  ["Recycle Bin", <RecycleBinPage />, /Loading/],
  ["Image settings", <SettingsImagesPage embedded />, /Loading/],
];

describe("list pages say Loading, not 'none found', on the first paint", () => {
  it.each(PAGES)("%s", (_name, ui, loadingText) => {
    const html = firstPaint(ui);
    for (const claim of EMPTY_CLAIMS) expect(html).not.toMatch(claim);
    expect(html).toMatch(loadingText);
  });
});

describe("the menu says nothing about missing filters until they have loaded", () => {
  it("sidebar", () => {
    const html = firstPaint(<Sidebar collapsed={false} onToggleCollapse={() => {}} />);
    expect(html).toContain("Filters"); // the heading is there
    expect(html).not.toMatch(/No filters yet/);
  });

  it("mobile drawer", () => {
    const html = firstPaint(<MobileNavDrawer open onClose={() => {}} />);
    expect(html).not.toMatch(/No filters yet/);
  });
});

describe("the tag picker", () => {
  it("says Loading, not 'No tags yet', while its tags load", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    render(<TagPicker tags={[]} selectedIds={[]} onChange={() => {}} loading />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByText(/No tags yet/)).toBeNull();
    expect(screen.getByText("Loading tags...")).toBeTruthy();
    cleanup();
    render(<TagPicker tags={[]} selectedIds={[]} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText(/No tags yet/)).toBeTruthy();
    cleanup();
  });
});
