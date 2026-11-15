import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ListToolbar } from "../src/components/ui/ListToolbar";
import { solidActionButtonClasses } from "../src/components/ui/buttonStyles";

afterEach(cleanup);

describe("list toolbar on a narrow phone", () => {
  it("wraps, and the search box gets its own full-width row instead of being squeezed to nothing", () => {
    const { container } = render(<ListToolbar search="" onSearchChange={() => {}} placeholder="Find" action={<button>Add Item</button>} />);
    expect(container.firstElementChild!.className).toContain("flex-wrap");
    const box = screen.getByLabelText("Find").parentElement!;
    expect(box.className).toContain("w-full");
    expect(box.className).toContain("sm:flex-1");
  });

  it("solid action buttons never break their label onto two lines", () => {
    const cls = solidActionButtonClasses("positive");
    expect(cls).toContain("whitespace-nowrap");
    expect(cls).toContain("shrink-0");
  });
});
