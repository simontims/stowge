import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagPicker } from "../src/components/ui/TagPicker";
import { TagChips } from "../src/components/ui/TagChips";
import { makeTag } from "./testUtils";

afterEach(cleanup);

const TAGS = [makeTag("t1", "Cables"), makeTag("t2", "Camping"), makeTag("t3", "Tools")];

function Harness({ initial = [], onChange = () => {} }: { initial?: string[]; onChange?: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>(initial);
  return (
    <TagPicker
      tags={TAGS}
      selectedIds={ids}
      onChange={(next) => {
        setIds(next);
        onChange(next);
      }}
    />
  );
}

describe("TagPicker", () => {
  it("shows the selected tags as chips", () => {
    render(<Harness initial={["t1", "t3"]} />);
    expect(screen.getAllByTestId("tag-chip").map((el) => el.textContent)).toEqual(["Cables×", "Tools×"]);
  });

  it("type-ahead filters the list and picking adds a chip (several allowed)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Tags" });

    await userEvent.type(input, "ca");
    expect(screen.getByRole("option", { name: "Cables" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Camping" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Tools" })).toBeNull();

    await userEvent.click(screen.getByRole("option", { name: "Camping" }));
    expect(onChange).toHaveBeenLastCalledWith(["t2"]);

    await userEvent.type(input, "tool");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["t2", "t3"]);
    expect(screen.getAllByTestId("tag-chip")).toHaveLength(2);
  });

  it("already picked tags are not offered again", async () => {
    render(<Harness initial={["t1"]} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    expect(screen.queryByRole("option", { name: "Cables" })).toBeNull();
    expect(screen.getByRole("option", { name: "Tools" })).toBeTruthy();
  });

  it("the x on a chip removes that tag, and Backspace removes the last", async () => {
    const onChange = vi.fn();
    render(<Harness initial={["t1", "t2"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove tag Cables" }));
    expect(onChange).toHaveBeenLastCalledWith(["t2"]);
    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    await userEvent.keyboard("{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("cannot create a tag: an unmatched search offers nothing to add", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox", { name: "Tags" }), "zzz");
    expect(screen.getByText("No matching tags.")).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TagChips", () => {
  it("lists tags read-only and shows the empty label otherwise", () => {
    const { rerender } = render(<TagChips tags={[{ id: "t1", name: "Cables", icon: null, color: null }]} />);
    expect(screen.getByText("Cables")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<TagChips tags={[]} emptyLabel="No tags" />);
    expect(screen.getByText("No tags")).toBeTruthy();
  });
});
