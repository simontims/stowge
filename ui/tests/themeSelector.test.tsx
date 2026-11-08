import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeModal } from "../src/components/onboarding/welcome/WelcomeModal";
import { ThemeSelector } from "../src/components/ui/ThemeSelector";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.documentElement.dataset.theme = "dark";
  localStorage.clear();
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeSelector", () => {
  it("is a Light / Dark radio group that shows the current theme", () => {
    render(<ThemeSelector idPrefix="t" />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(false);
  });

  it("choosing Light applies it at once, remembers it, and saves it to the account", async () => {
    render(<ThemeSelector idPrefix="t" />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("stowge_theme")).toBe("light");
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/me"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ theme: "light" });
    });
    expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
  });

  it("two selectors on a page stay in step (shared theme state)", async () => {
    render(<><ThemeSelector idPrefix="a" /><ThemeSelector idPrefix="b" /></>);
    await userEvent.click(screen.getAllByRole("radio", { name: "Light" })[0]);
    await waitFor(() => {
      for (const r of screen.getAllByRole("radio", { name: "Light" })) expect((r as HTMLInputElement).checked).toBe(true);
    });
  });
});

describe("WelcomeModal appearance choice", () => {
  it("offers Light and Dark between the text and the buttons, with a hint about the top bar", () => {
    render(<WelcomeModal onTakeTour={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("radio", { name: "Light" })).toBeTruthy();
    expect(screen.getByText(/sun or moon button in the top bar/)).toBeTruthy();
  });

  it("choosing a theme in the modal switches the page behind it immediately", async () => {
    render(<WelcomeModal onTakeTour={() => {}} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("the choice survives Close and Take the tour (it is already saved)", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal onTakeTour={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("moves focus to the heading, closes on Escape, and keeps Tab inside the dialog", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal onTakeTour={() => {}} onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Welcome to Stowge" }));

    const tour = screen.getByText("Take the tour");
    tour.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Dark" })); // the checked radio is the first tab stop

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus back to the heading when the parent re-renders with a new onClose", async () => {
    const { rerender } = render(<WelcomeModal onTakeTour={() => {}} onClose={() => {}} />);
    const dark = screen.getByRole("radio", { name: "Dark" });
    dark.focus();
    rerender(<WelcomeModal onTakeTour={() => {}} onClose={() => {}} />);
    expect(document.activeElement).toBe(dark);
  });

  it("Shift+Tab from the checked radio does not leave the dialog (only the checked radio is a tab stop)", () => {
    render(<WelcomeModal onTakeTour={() => {}} onClose={() => {}} />);
    const dark = screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement; // checked
    dark.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Take the tour"));
  });
});
