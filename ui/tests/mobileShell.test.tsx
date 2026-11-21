import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../src/components/layout/AppShell";
import { UserContext } from "../src/lib/UserContext";
import { makeUser } from "./testUtils";

afterEach(cleanup);

describe("mobile shell", () => {
  it("fills the dynamic viewport (not 100vh), so the top bar cannot be scrolled away on a phone", () => {
    const { container } = render(
      <UserContext.Provider value={{ currentUser: makeUser(), setCurrentUser: () => {} }}>
        <MemoryRouter><AppShell onLogout={() => {}}>x</AppShell></MemoryRouter>
      </UserContext.Provider>,
    );
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("h-dvh");
    expect(shell.className).not.toContain("h-screen");
    expect(shell.className).toContain("overflow-hidden");
    // 16px padding on a phone, so the Add page's full-width action bar (-mx-4) reaches the screen edges
    expect(container.querySelector("main")!.className).toMatch(/\bp-4\b/);
  });

  it("the page itself is not allowed to rubber-band or scroll", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/);
  });
});
