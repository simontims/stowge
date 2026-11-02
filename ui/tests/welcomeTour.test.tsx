import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeTour } from "../src/components/onboarding/welcome/WelcomeTour";

afterEach(cleanup);

describe("WelcomeTour", () => {
  it("ends when Escape is pressed while running", () => {
    const onFinish = vi.fn();
    render(<WelcomeTour run isAdmin={false} onFinish={onFinish} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when not running", () => {
    const onFinish = vi.fn();
    render(<WelcomeTour run={false} isAdmin={false} onFinish={onFinish} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("WelcomeTour restart", () => {
  it("shows the first step again every time it is started", async () => {
    const { rerender } = render(<WelcomeTour run isAdmin={false} onFinish={() => {}} />);
    await screen.findByText("Add items fast");
    await userEvent.click(screen.getByText(/^Next/));
    await screen.findByText("Collections").catch(() => undefined);

    rerender(<WelcomeTour run={false} isAdmin={false} onFinish={() => {}} />);
    rerender(<WelcomeTour run isAdmin={false} onFinish={() => {}} />);

    await screen.findByText("Add items fast");
  });
});
