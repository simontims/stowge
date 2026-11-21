import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DataTable } from "../src/components/ui/DataTable";

afterEach(() => cleanup());

describe("DataTable layout", () => {
  const rows = [{ id: "a", name: "A" }];
  const columns = [{ key: "name" as const, header: "Name" }];

  it("keeps the content-sized layout by default, so other tables are unchanged", () => {
    const { container } = render(<DataTable columns={columns} rows={rows} keyField="id" />);
    const table = container.querySelector("table") as HTMLElement;
    expect(table.className).toContain("min-w-max");
    expect(table.className).not.toContain("table-fixed");
    expect(table.style.minWidth).toBe("");
  });

  it("fixedLayout uses table-fixed and applies minTableWidth", () => {
    const { container } = render(<DataTable columns={columns} rows={rows} keyField="id" fixedLayout minTableWidth="52rem" />);
    const table = container.querySelector("table") as HTMLElement;
    expect(table.className).toContain("table-fixed");
    expect(table.className).not.toContain("min-w-max");
    expect(table.style.minWidth).toBe("52rem");
  });
});
